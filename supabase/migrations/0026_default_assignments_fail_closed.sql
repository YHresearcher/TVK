-- 0026: P2 — Gán mặc định ngành Phụ tùng cho 5 tài khoản hiện có + siết
-- fail-closed (chưa gán = không thấy gì) + chứng từ mới bắt buộc có ngành.
--
-- QUYẾT ĐỊNH CỦA CHỦ (23/11/2026, đã chốt): 5 tài khoản hiện có đều thấy
-- Phụ tùng (AUTO_PARTS), rồi siết lại. OWNER/CEO thấy tất cả mọi ngành.
--   thanhphan (OWNER), banhang (SALES), kho (WAREHOUSE),
--   ketoan (ACCOUNTING), ceo (CEO).
--
-- THỨ TỰ TRONG MIGRATION NÀY LÀ BẮT BUỘC — seed trước, siết sau:
--   1. Seed gán mặc định (tìm user theo username — username là duy nhất,
--      đã có unique index lower(username) từ 0004; idempotent).
--   2. Kiểm tra: đủ 5/5 tài khoản mới được siết. Thiếu bất kỳ ai -> RAISE
--      EXCEPTION, migration fail, KHÔNG đổi gì (không bao giờ khóa nhầm
--      tài khoản hiện có vì username sai/thiếu).
--   3. Siết user_can_access_business_line() thành fail-closed.
--   4. Siết guard dòng-chứng từ: sản phẩm chưa phân loại không được vào
--      chứng từ đã có ngành.
--   5. Chứng từ mới bắt buộc có business_line_id (trigger INSERT/UPDATE).
--   6. View tồn kho v_batch_stock lọc theo ngành (BL-001): trang Tồn kho
--      và Dashboard L2 không còn lộ lô ngành khác; 6b thêm business_line_id
--      vào v_product_stock cho xuất Excel theo ngành (§18.6).
--      của user chỉ-dầu không còn thấy lô phụ tùng (và ngược lại).
--      2 cột business_line_id / business_line_code thêm vào CUỐI danh
--      sách cột (không chen giữa — bài học 42P16). Giữ
--      security_invoker = true như 0018.
--
-- KHÔNG đổi số liệu tài chính, KHÔNG đụng sổ cái kho, KHÔNG đổi mã chứng từ.
-- Chạy sau 0025. Idempotent: chạy lại không tạo trùng gán, không đổi hàm
-- đã siết.
BEGIN;

-- ---------------------------------------------------------------------
-- 1. Seed gán mặc định: 5 tài khoản -> AUTO_PARTS (theo username).
-- ---------------------------------------------------------------------
INSERT INTO public.user_business_lines (user_id, business_line_id)
SELECT p.id, bl.id
FROM public.profiles p
CROSS JOIN public.business_lines bl
WHERE bl.code = 'AUTO_PARTS'
  AND p.username IN ('thanhphan', 'banhang', 'kho', 'ketoan', 'ceo')
  AND p.is_active = true
ON CONFLICT (user_id, business_line_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Guard: đủ 5/5 mới được siết. Thiếu ai -> fail migration, liệt kê
--    rõ username thiếu để chủ kiểm tra (username sai / tài khoản chưa
--    có username / tài khoản bị tắt).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_expected text[] := ARRAY['thanhphan', 'banhang', 'kho', 'ketoan', 'ceo'];
  v_missing  text[];
  v_count    integer;
BEGIN
  SELECT array_agg(u)
    INTO v_missing
    FROM unnest(v_expected) AS u
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.user_business_lines ubl
       JOIN public.profiles p ON p.id = ubl.user_id
       JOIN public.business_lines bl ON bl.id = ubl.business_line_id
      WHERE p.username = u AND bl.code = 'AUTO_PARTS'
   );
  v_count := 5 - coalesce(array_length(v_missing, 1), 0);
  RAISE NOTICE 'P2 SEED: %/5 tài khoản hiện có đã gán Phụ tùng (AUTO_PARTS)', v_count;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'P2 SEED THIẾU: chưa gán được Phụ tùng cho username: %. Kiểm tra username/tình trạng tài khoản rồi chạy lại — KHÔNG siết fail-closed khi còn tài khoản chưa gán.',
      array_to_string(v_missing, ', ');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Siết user_can_access_business_line() thành fail-closed (P2).
--    - Profile không active -> false.
--    - OWNER / CEO -> mọi ngành.
--    - Sản phẩm/chứng từ CHƯA phân loại (NULL) -> true (hành vi cũ, để
--      xử lý thủ công ở hàng đợi; không tự ẩn dữ liệu chưa phân loại).
--    - User chưa được gán ngành nào -> FALSE (khác P1: P1 cho qua toàn
--      bộ để tương thích; P2 siết sau khi đã gán xong 5 tài khoản).
--    - Ngược lại: chỉ true khi user được gán đúng ngành đó.
--    (v_batches_for_sales dùng hàm này nên view tự siết theo.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_access_business_line(
    p_user_id uuid,
    p_business_line_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p_business_line_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = p_user_id
        AND p.is_active
        AND (
          p.role IN ('OWNER', 'CEO')
          OR EXISTS (
            SELECT 1 FROM public.user_business_lines u
            WHERE u.user_id = p_user_id AND u.business_line_id = p_business_line_id
          )
        )
    );
$$;
REVOKE ALL ON FUNCTION public.user_can_access_business_line(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_business_line(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.user_can_access_business_line(uuid, uuid) IS
  'P2 fail-closed: kiểm tra user có được xem/làm việc trên một ngành hàng không. NULL = chưa phân loại -> cho qua (hàng đợi). User chưa được gán ngành nào -> KHÔNG thấy gì (trừ OWNER/CEO thấy tất cả).';

-- ---------------------------------------------------------------------
-- 4. Siết guard dòng-chứng từ (P2): sản phẩm chưa phân loại (NULL) không
--    được đưa vào chứng từ đã có ngành. Trước đây P1 cho qua (NULL-tolerant)
--    để tương thích; từ P2, chứng từ có ngành chỉ nhận dòng cùng ngành.
--    Trộn ngành (khác ngành) vẫn bị chặn như cũ. Trigger cũ giữ nguyên
--    tên/hàm nên không cần tạo lại trigger (CREATE OR REPLACE giữ OID).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_guard_line_business_line()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_header_table text := TG_ARGV[0];
  v_header_fk    text := TG_ARGV[1];
  v_via_batch    boolean := coalesce(TG_ARGV[2], '') = 'batch';
  v_header_id    uuid;
  v_product_id   uuid;
  v_header_line  uuid;
  v_product_line uuid;
  v_header_code  text;
  v_product_code text;
  v_product_sku  text;
BEGIN
  EXECUTE format('SELECT ($1).%I', v_header_fk) USING NEW INTO v_header_id;
  IF v_via_batch THEN
    SELECT b.product_id INTO v_product_id
      FROM public.stock_batches b WHERE b.id = NEW.batch_id;
  ELSE
    EXECUTE format('SELECT ($1).%I', 'product_id') USING NEW INTO v_product_id;
  END IF;
  IF v_header_id IS NULL OR v_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT business_line_id FROM %I WHERE id = $1', v_header_table)
    USING v_header_id INTO v_header_line;
  IF v_header_line IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT business_line_id, sku INTO v_product_line, v_product_sku
    FROM public.products WHERE id = v_product_id;
  -- P2: sản phẩm chưa phân loại không được vào chứng từ đã có ngành.
  IF v_product_line IS NULL THEN
    SELECT code INTO v_header_code FROM public.business_lines WHERE id = v_header_line;
    RAISE EXCEPTION 'Sản phẩm % chưa phân loại ngành hàng — hãy phân loại trước khi đưa vào chứng từ thuộc ngành % (một chứng từ chỉ thuộc một ngành).',
      coalesce(v_product_sku, '?'), coalesce(v_header_code, '?');
  END IF;

  IF v_header_line IS DISTINCT FROM v_product_line THEN
    SELECT code INTO v_header_code FROM public.business_lines WHERE id = v_header_line;
    SELECT code INTO v_product_code FROM public.business_lines WHERE id = v_product_line;
    RAISE EXCEPTION 'Không được trộn ngành hàng trong một chứng từ (dòng hàng thuộc %, chứng từ thuộc %). Một chứng từ chỉ thuộc một ngành.',
      coalesce(v_product_code, '?'), coalesce(v_header_code, '?');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tvk_guard_line_business_line() FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 5. Chứng từ mới bắt buộc có business_line_id (P2 — enforce, theo
--    §15.1 Expand–Backfill–Validate–Enforce–Contract).
--    - INSERT với business_line_id NULL -> chặn (chứng từ mới phải thuộc
--      một ngành; app luôn ghi ngành từ ngữ cảnh phiên làm việc).
--    - UPDATE bỏ ngành (về NULL) khi chứng từ còn dòng -> chặn (P1 cho
--      phép bỏ ngành; P2 siết). Bỏ ngành khi chưa có dòng nào vẫn cho
--      (chứng từ trống, chưa phát sinh nghiệp vụ).
--    Chứng từ lịch sử đã có (kể cả hỗn hợp NULL từ P1) không bị đụng:
--    trigger chỉ kiểm tra dòng MỚI chèn/cập nhật, không quét lại dữ liệu cũ.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_require_header_business_line()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lines integer := 0;
BEGIN
  IF NEW.business_line_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Chứng từ mới phải thuộc một ngành hàng (Dầu nhớt hoặc Phụ tùng). Tạo chứng từ từ giao diện hoặc import đã chọn ngành — nếu thấy lỗi này, hãy báo chủ cửa hàng.';
  END IF;
  -- UPDATE: chỉ chặn bỏ ngành khi chứng từ còn dòng hàng.
  IF TG_TABLE_NAME = 'purchase_receipts' THEN
    SELECT count(*) INTO v_lines FROM public.purchase_receipt_items WHERE receipt_id = NEW.id;
  ELSIF TG_TABLE_NAME = 'consignment_receipts' THEN
    SELECT count(*) INTO v_lines FROM public.consignment_receipt_items WHERE receipt_id = NEW.id;
  ELSIF TG_TABLE_NAME = 'consignment_out_slips' THEN
    SELECT count(*) INTO v_lines FROM public.consignment_out_items WHERE slip_id = NEW.id;
  ELSIF TG_TABLE_NAME = 'consumption_reports' THEN
    SELECT count(*) INTO v_lines FROM public.consumption_report_items WHERE report_id = NEW.id;
  ELSIF TG_TABLE_NAME = 'allocation_slips' THEN
    SELECT count(*) INTO v_lines FROM public.allocation_lines WHERE allocation_id = NEW.id;
  ELSIF TG_TABLE_NAME = 'sales_documents' THEN
    SELECT count(*) INTO v_lines FROM public.sales_document_lines WHERE document_id = NEW.id;
  ELSIF TG_TABLE_NAME = 'return_documents' THEN
    SELECT count(*) INTO v_lines FROM public.return_items WHERE return_id = NEW.id;
  END IF;
  IF v_lines > 0 THEN
    RAISE EXCEPTION 'Không được bỏ ngành hàng của chứng từ % khi còn % dòng hàng.',
      TG_TABLE_NAME, v_lines;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tvk_require_header_business_line() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_require_header_bl ON public.purchase_receipts;
CREATE TRIGGER trg_require_header_bl
BEFORE INSERT OR UPDATE ON public.purchase_receipts
FOR EACH ROW EXECUTE FUNCTION public.tvk_require_header_business_line();
DROP TRIGGER IF EXISTS trg_require_header_bl ON public.consignment_receipts;
CREATE TRIGGER trg_require_header_bl
BEFORE INSERT OR UPDATE ON public.consignment_receipts
FOR EACH ROW EXECUTE FUNCTION public.tvk_require_header_business_line();
DROP TRIGGER IF EXISTS trg_require_header_bl ON public.consignment_out_slips;
CREATE TRIGGER trg_require_header_bl
BEFORE INSERT OR UPDATE ON public.consignment_out_slips
FOR EACH ROW EXECUTE FUNCTION public.tvk_require_header_business_line();
DROP TRIGGER IF EXISTS trg_require_header_bl ON public.consumption_reports;
CREATE TRIGGER trg_require_header_bl
BEFORE INSERT OR UPDATE ON public.consumption_reports
FOR EACH ROW EXECUTE FUNCTION public.tvk_require_header_business_line();
DROP TRIGGER IF EXISTS trg_require_header_bl ON public.allocation_slips;
CREATE TRIGGER trg_require_header_bl
BEFORE INSERT OR UPDATE ON public.allocation_slips
FOR EACH ROW EXECUTE FUNCTION public.tvk_require_header_business_line();
DROP TRIGGER IF EXISTS trg_require_header_bl ON public.sales_documents;
CREATE TRIGGER trg_require_header_bl
BEFORE INSERT OR UPDATE ON public.sales_documents
FOR EACH ROW EXECUTE FUNCTION public.tvk_require_header_business_line();
DROP TRIGGER IF EXISTS trg_require_header_bl ON public.return_documents;
CREATE TRIGGER trg_require_header_bl
BEFORE INSERT OR UPDATE ON public.return_documents
FOR EACH ROW EXECUTE FUNCTION public.tvk_require_header_business_line();

-- ---------------------------------------------------------------------
-- 6. v_batch_stock lọc theo ngành (BL-001, Prompt §6.4–§6.5).
--    Trang Tồn kho (vai trò khác SALES) và Dashboard L2 đọc view này;
--    trước P2 view không biết ngành nên user chỉ-dầu vẫn thấy lô phụ
--    tùng (kèm giá vốn). Định nghĩa gốc từ 0016, chỉ thêm:
--      - join business_lines để lấy mã ngành (2 cột thêm vào CUỐI);
--      - WHERE user_can_access_business_line(auth.uid(), p.business_line_id)
--        (hàm đã siết fail-closed ở §3; SECURITY DEFINER nên đọc được
--        profiles/user_business_lines bất kể RLS).
--    Giữ security_invoker = true (0018) + grant select như cũ.
--    View v_batches_for_sales (dành cho SALES) đã được P1 siết tương tự.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_batch_stock AS
SELECT b.id AS batch_id, b.batch_code, b.product_id, p.sku, p.name AS product_name,
       b.ownership, b.supplier_id, coalesce(s.name, ps.name) AS supplier_name, b.unit_cost,
       bl.location_id, l.name AS location_name, l.location_kind, l.partner_id,
       bl.qty, b.received_date, b.return_by_date, b.status, b.expiry_date,
       p.business_line_id, bl2.code AS business_line_code
FROM stock_batches b
JOIN products p ON p.id = b.product_id
LEFT JOIN business_lines bl2 ON bl2.id = p.business_line_id
LEFT JOIN suppliers s ON s.id = b.supplier_id
LEFT JOIN purchase_receipts pr
  ON pr.id = b.source_doc_id AND b.source_doc_type = 'PURCHASE_RECEIPT'
LEFT JOIN suppliers ps ON ps.id = pr.supplier_id
JOIN batch_locations bl ON bl.batch_id = b.id
JOIN locations l ON l.id = bl.location_id
WHERE public.user_can_access_business_line((SELECT auth.uid()), p.business_line_id);
ALTER VIEW public.v_batch_stock SET (security_invoker = true);
GRANT SELECT ON public.v_batch_stock TO authenticated;

-- ---------------------------------------------------------------------
-- 6b. v_product_stock thêm cột business_line_id (P2 §18.6 — xuất Excel
--     theo ngành). Định nghĩa gốc từ 0001, chỉ thêm p.business_line_id
--     vào CUỐI select + GROUP BY (p.id là PK nên nhóm không đổi).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_product_stock AS
SELECT p.id AS product_id, p.sku, p.name,
       coalesce(sum(bl.qty) filter (where b.ownership = 'OWNED'     and l.location_kind = 'OWN_WAREHOUSE'), 0) as owned_at_own_wh,
       coalesce(sum(bl.qty) filter (where b.ownership = 'CONSIGNED' and l.location_kind = 'OWN_WAREHOUSE'), 0) as consigned_at_own_wh,
       coalesce(sum(bl.qty) filter (where b.ownership = 'OWNED'     and l.location_kind = 'PARTNER_VIRTUAL'), 0) as owned_at_partners,
       coalesce(sum(bl.qty) filter (where b.ownership = 'CONSIGNED' and l.location_kind = 'PARTNER_VIRTUAL'), 0) as consigned_at_partners,
       coalesce(sum(bl.qty), 0) as total_qty,
       p.business_line_id
FROM products p
LEFT JOIN stock_batches b ON b.product_id = p.id
LEFT JOIN batch_locations bl ON bl.batch_id = b.id
LEFT JOIN locations l ON l.id = bl.location_id
GROUP BY p.id, p.sku, p.name, p.business_line_id;

-- ---------------------------------------------------------------------
-- 7. Kiểm chứng cuối migration (chỉ NOTICE — không fail deploy vì dữ
--    liệu lạ; bất biến tài chính phải bằng trước 0026).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_payables    integer;
  v_receivables integer;
  v_payments    integer;
  v_movements   integer;
  v_assigned    integer;
BEGIN
  SELECT count(*) INTO v_payables FROM public.supplier_payables;
  SELECT count(*) INTO v_receivables FROM public.partner_receivables;
  SELECT count(*) INTO v_payments FROM public.payments;
  SELECT count(*) INTO v_movements FROM public.stock_movements;
  SELECT count(*) INTO v_assigned FROM public.user_business_lines ubl
    JOIN public.business_lines bl ON bl.id = ubl.business_line_id
   WHERE bl.code = 'AUTO_PARTS';
  RAISE NOTICE 'P2 FINANCIAL INVARIANT (post-0026 counts, must equal pre-0026): supplier_payables=% partner_receivables=% payments=% stock_movements=%', v_payables, v_receivables, v_payments, v_movements;
  RAISE NOTICE 'P2 DONE: 5 tài khoản đã gán Phụ tùng (% dòng gán AUTO_PARTS) + fail-closed + chứng từ mới bắt buộc có ngành.', v_assigned;
END $$;

COMMIT;
