-- ======================================================================
-- TVK V2.0 — P4b: Finance + VAT per business line (§12–§16)
-- ----------------------------------------------------------------------
-- 1. Phải thu / phải trả tách theo ngành (§12): thêm business_line_id
--    (nullable) vào partner_receivables + supplier_payables, backfill
--    từ chứng từ gốc (phải thu <- sales_documents; phải trả mua hàng
--    <- purchase_receipts; phải trả ký gửi đã bán <- sales_documents).
--    Chứng từ gốc hỗn hợp hoặc chưa phân loại -> giữ NULL (không tự
--    chia — xem BL-014 và view v_unattributed_balances bên dưới).
--    Trigger BEFORE INSERT/UPDATE tự điền từ chứng từ gốc; guard chặn
--    đổi ngành khi đã chốt (NULL -> có giá trị thì được).
-- 2. Hoá đơn GTGT tách theo ngành (§13): vat_invoices.business_line_id
--    + total_before_tax/total_vat; vat_invoice_lines: vat_rate,
--    discount_amount, amount_before_tax, vat_amount,
--    amount_including_tax. Giá đã gồm VAT, thuế suất 8% cả hai ngành
--    (quyết định của chủ 21/11/2026). create_vat_invoice viết lại:
--    khóa dòng FOR UPDATE, phân giải ngành qua sản phẩm, chặn trộn
--    ngành, kiểm tra quyền ngành, chia giảm giá đầu chứng từ xuống
--    từng dòng (tỷ lệ, làm tròn xuống, phần dư về dòng lớn nhất),
--    tách VAT theo công thức trước-thuế = ROUND(cơ-sở/1.08, 2).
--    Tổng header = SUM các dòng đã tách (SỬA tổng cũ: bản 0020 lấy
--    SUM(line_total) nên bỏ qua giảm giá và tính thừa cơ sở thuế).
--    Backfill hoá đơn cũ GIỮ NGUYÊN total_amount (không đổi số liệu):
--    tách VAT trên số đã ghi, discount_amount = 0.
-- 3. BL-015 (§13.8 + PAYMENT-REVERSAL.md §6): reverse_payment chặn
--    đảo khi chứng từ gốc của phiếu đã có hoá đơn GTGT còn hiệu lực
--    (ISSUED + dòng active) — phải huỷ bản ghi hoá đơn trước.
--    (BL-015 thứ hai trong bảng §21.2 — "Mixed-line VAT invoice |
--    Rejected" — được thực hiện bằng bước chặn trộn ngành ở mục 2.)
-- 4. Đối chiếu (§15–§16): reconciliation_snapshots bất biến — trigger
--    chặn mọi UPDATE/DELETE, FK period_id đổi CASCADE -> RESTRICT
--    (0023:356 CÓ ON DELETE CASCADE — ghi chú §15.6 nói "không tìm
--    thấy CASCADE" là SAI), bỏ policy UPDATE/DELETE của OWNER.
--    Tạo bản chụp mới vẫn được (INSERT); sửa sai bằng bản chụp hiệu
--    chỉnh mới, không sửa bản cũ.
-- 5. Quỹ tiền (§11.5, mô hình quỹ CHƯA chốt — hỗ trợ cả hai):
--    cash_funds.business_line_id (NULL = quỹ chung Model A; có giá
--    trị = quỹ riêng ngành Model B) + view v_cash_flow_by_line
--    (dòng tiền thu/chi theo quỹ × ngành, từ payment_allocations).
--    Không thêm UI gán quỹ theo ngành trong P4 (chờ chủ chốt mô hình).
-- 6. BL-014: khoản công nợ lịch sử đã trả một phần mà chứng từ gốc
--    hỗn hợp thì KHÔNG tự chia tỷ lệ (chờ chủ duyệt) — liệt kê trong
--    view v_unattributed_balances để chủ rà soát.
--
-- Không đổi số liệu tài chính hiện có: backfill chỉ điền ngành và
-- tách VAT trên số đã ghi; total_amount của hoá đơn cũ giữ nguyên.
-- ======================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1a. business_line_id trên hai bảng công nợ + backfill từ chứng từ gốc.
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_receivables
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);
ALTER TABLE public.supplier_payables
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);
CREATE INDEX IF NOT EXISTS idx_partner_receivables_business_line ON public.partner_receivables(business_line_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payables_business_line ON public.supplier_payables(business_line_id);

UPDATE public.partner_receivables r
   SET business_line_id = d.business_line_id
  FROM public.sales_documents d
 WHERE r.source_document_id = d.id
   AND d.business_line_id IS NOT NULL;

UPDATE public.supplier_payables p
   SET business_line_id = d.business_line_id
  FROM public.purchase_receipts d
 WHERE p.source_kind = 'PURCHASE'
   AND p.purchase_receipt_id = d.id
   AND d.business_line_id IS NOT NULL;

UPDATE public.supplier_payables p
   SET business_line_id = d.business_line_id
  FROM public.sales_documents d
 WHERE p.source_kind = 'CONSIGNMENT_SALE'
   AND p.source_document_id = d.id
   AND d.business_line_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 1b. Tự điền ngành từ chứng từ gốc khi tạo khoản công nợ mới.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_fill_obligation_business_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line uuid;
BEGIN
  IF NEW.business_line_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'partner_receivables' THEN
    IF NEW.source_document_id IS NOT NULL THEN
      SELECT business_line_id INTO v_line
        FROM public.sales_documents WHERE id = NEW.source_document_id;
      NEW.business_line_id := v_line;
    END IF;
  ELSIF TG_TABLE_NAME = 'supplier_payables' THEN
    IF NEW.source_kind = 'PURCHASE' AND NEW.purchase_receipt_id IS NOT NULL THEN
      SELECT business_line_id INTO v_line
        FROM public.purchase_receipts WHERE id = NEW.purchase_receipt_id;
      NEW.business_line_id := v_line;
    ELSIF NEW.source_kind = 'CONSIGNMENT_SALE' AND NEW.source_document_id IS NOT NULL THEN
      SELECT business_line_id INTO v_line
        FROM public.sales_documents WHERE id = NEW.source_document_id;
      NEW.business_line_id := v_line;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_obligation_business_line ON public.partner_receivables;
CREATE TRIGGER trg_fill_obligation_business_line
BEFORE INSERT OR UPDATE ON public.partner_receivables
FOR EACH ROW EXECUTE FUNCTION public.tvk_fill_obligation_business_line();

DROP TRIGGER IF EXISTS trg_fill_obligation_business_line ON public.supplier_payables;
CREATE TRIGGER trg_fill_obligation_business_line
BEFORE INSERT OR UPDATE ON public.supplier_payables
FOR EACH ROW EXECUTE FUNCTION public.tvk_fill_obligation_business_line();

-- ---------------------------------------------------------------------
-- 1c. Guard: ngành của khoản công nợ đã chốt thì không đổi.
--    (NULL -> có giá trị thì được — bổ sung sau khi chứng từ gốc
--    được phân loại.) Tên trigger "fill" < "guard" nên fill chạy trước.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_guard_obligation_business_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.business_line_id IS NOT NULL
     AND NEW.business_line_id IS DISTINCT FROM OLD.business_line_id THEN
    RAISE EXCEPTION 'Ngành của khoản công nợ đã chốt, không được đổi (chỉ được bổ sung khi đang trống).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_obligation_business_line ON public.partner_receivables;
CREATE TRIGGER trg_guard_obligation_business_line
BEFORE UPDATE ON public.partner_receivables
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_obligation_business_line();

DROP TRIGGER IF EXISTS trg_guard_obligation_business_line ON public.supplier_payables;
CREATE TRIGGER trg_guard_obligation_business_line
BEFORE UPDATE ON public.supplier_payables
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_obligation_business_line();

-- ---------------------------------------------------------------------
-- 1d. BL-014: khoản công nợ chưa quy chiếu được ngành (chứng từ gốc
--    hỗn hợp hoặc chưa phân loại) — liệt kê để chủ rà soát, KHÔNG tự
--    chia tỷ lệ. Chỉ liệt kê khoản còn dư (chưa PAID).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_unattributed_balances AS
SELECT 'RECEIVABLE'::text AS kind,
       r.id,
       r.partner_id AS counterparty_id,
       NULL::uuid AS supplier_id,
       r.amount, r.amount_paid,
       r.amount - r.amount_paid AS remaining,
       r.source_document_id,
       d.doc_code AS source_code,
       r.created_at
  FROM public.partner_receivables r
  LEFT JOIN public.sales_documents d ON d.id = r.source_document_id
 WHERE r.business_line_id IS NULL
   AND r.status <> 'PAID'
UNION ALL
SELECT 'PAYABLE'::text AS kind,
       p.id,
       NULL::uuid AS counterparty_id,
       p.supplier_id,
       p.amount, p.amount_paid,
       p.amount - p.amount_paid AS remaining,
       coalesce(p.source_document_id, p.purchase_receipt_id) AS source_document_id,
       coalesce(d.doc_code, pr.doc_code) AS source_code,
       p.created_at
  FROM public.supplier_payables p
  LEFT JOIN public.sales_documents d ON d.id = p.source_document_id
  LEFT JOIN public.purchase_receipts pr ON pr.id = p.purchase_receipt_id
 WHERE p.business_line_id IS NULL
   AND p.status <> 'PAID';

COMMENT ON VIEW public.v_unattributed_balances IS
  'P4b BL-014: khoản công nợ còn dư nhưng chưa quy chiếu được ngành (chứng từ gốc hỗn hợp hoặc chưa phân loại). Chủ rà soát và phân loại thủ công; hệ thống KHÔNG tự chia tỷ lệ.';

-- ---------------------------------------------------------------------
-- 2a. Schema hoá đơn GTGT tách theo ngành + tách VAT.
--     amount trên vat_invoice_lines GIỮ nghĩa cũ (= tiền gồm thuế
--     của dòng, sau khi trừ giảm giá) để tương thích ngược; các cột
--     mới amount_before_tax / vat_amount / amount_including_tax ghi
--     rõ từng thành phần.
-- ---------------------------------------------------------------------
ALTER TABLE public.vat_invoices
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id),
  ADD COLUMN IF NOT EXISTS total_before_tax numeric(15,2),
  ADD COLUMN IF NOT EXISTS total_vat numeric(15,2);
CREATE INDEX IF NOT EXISTS idx_vat_invoices_business_line ON public.vat_invoices(business_line_id);

ALTER TABLE public.vat_invoice_lines
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_before_tax numeric(15,2),
  ADD COLUMN IF NOT EXISTS vat_amount numeric(15,2),
  ADD COLUMN IF NOT EXISTS amount_including_tax numeric(15,2);

-- Backfill hoá đơn cũ: GIỮ NGUYÊN total_amount (không đổi số liệu).
-- Tách VAT trên số đã ghi, discount_amount = 0 (bản 0020 không chia
-- giảm giá nên không thể khôi phục phần giảm giá của hoá đơn cũ).
-- Ngành = ngành chung của các dòng còn hiệu lực; hoá đơn trộn ngành
-- hoặc có dòng chưa phân loại thì giữ NULL.
UPDATE public.vat_invoice_lines vil
   SET vat_rate = 8.00,
       discount_amount = 0,
       amount_before_tax = round(amount / 1.08, 2),
       vat_amount = amount - round(amount / 1.08, 2),
       amount_including_tax = amount
 WHERE is_active;

UPDATE public.vat_invoices vi
   SET business_line_id = sub.line_id,
       total_before_tax = sub.bt,
       total_vat = sub.vat
  FROM (
    SELECT vil.vat_invoice_id,
           CASE WHEN count(*) = count(p.business_line_id)
                     AND count(DISTINCT p.business_line_id) = 1
                THEN (array_agg(p.business_line_id))[1] ELSE NULL END AS line_id,
           sum(vil.amount_before_tax) AS bt,
           sum(vil.vat_amount) AS vat
      FROM public.vat_invoice_lines vil
      JOIN public.sales_document_lines sdl ON sdl.id = vil.sales_document_line_id
      JOIN public.products p ON p.id = sdl.product_id
     WHERE vil.is_active
     GROUP BY vil.vat_invoice_id
  ) sub
 WHERE vi.id = sub.vat_invoice_id;

-- ---------------------------------------------------------------------
-- 2b. Guard: dòng hoá đơn phải cùng ngành với header; header đã chốt
--    thì không đổi ngành/tổng. (Dòng insert vào hoá đơn cũ chưa có
--    ngành sẽ bị chặn — hoá đơn cũ đã chốt, không thêm dòng mới.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_guard_vat_invoice_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_line uuid;
  v_header_line uuid;
BEGIN
  SELECT p.business_line_id INTO v_line
    FROM public.sales_document_lines sdl
    JOIN public.products p ON p.id = sdl.product_id
   WHERE sdl.id = NEW.sales_document_line_id;
  IF v_line IS NULL THEN
    RAISE EXCEPTION 'Dòng chứng từ của hoá đơn GTGT phải thuộc sản phẩm đã phân loại ngành.';
  END IF;
  SELECT business_line_id INTO v_header_line
    FROM public.vat_invoices WHERE id = NEW.vat_invoice_id;
  IF v_header_line IS DISTINCT FROM v_line THEN
    RAISE EXCEPTION 'Dòng hoá đơn GTGT thuộc ngành khác với ngành của hoá đơn.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_vat_invoice_line ON public.vat_invoice_lines;
CREATE TRIGGER trg_guard_vat_invoice_line
BEFORE INSERT OR UPDATE ON public.vat_invoice_lines
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_vat_invoice_line();

CREATE OR REPLACE FUNCTION public.tvk_guard_vat_invoice_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.business_line_id IS NOT NULL
     AND NEW.business_line_id IS DISTINCT FROM OLD.business_line_id THEN
    RAISE EXCEPTION 'Ngành của hoá đơn GTGT đã chốt, không được đổi.';
  END IF;
  IF OLD.total_before_tax IS NOT NULL
     AND NEW.total_before_tax IS DISTINCT FROM OLD.total_before_tax THEN
    RAISE EXCEPTION 'Tổng trước thuế của hoá đơn GTGT đã chốt, không được sửa trực tiếp.';
  END IF;
  IF OLD.total_vat IS NOT NULL
     AND NEW.total_vat IS DISTINCT FROM OLD.total_vat THEN
    RAISE EXCEPTION 'Tổng thuế GTGT của hoá đơn GTGT đã chốt, không được sửa trực tiếp.';
  END IF;
  IF OLD.total_amount IS NOT NULL
     AND NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
    RAISE EXCEPTION 'Tổng tiền hoá đơn GTGT đã chốt, không được sửa trực tiếp.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_vat_invoice_header ON public.vat_invoices;
CREATE TRIGGER trg_guard_vat_invoice_header
BEFORE UPDATE ON public.vat_invoices
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_vat_invoice_header();

-- ---------------------------------------------------------------------
-- 2c. create_vat_invoice viết lại (bản sao 0020 + P4b).
--     Giữ: role OWNER/ACCOUNTING, chống trùng dòng, tất cả dòng
--     CONFIRMED + cùng partner, chống ghi trùng dòng, đánh dấu
--     allocation_lines INVOICED, unique (invoice_no, symbol).
--     Mới (P4b):
--       - Khóa các dòng chứng từ FOR UPDATE trước khi kiểm tra
--         (chống hai phiên cùng ghi nhận một dòng).
--       - Ngành của dòng phân giải qua sản phẩm; dòng chưa phân loại
--         -> từ chối; các dòng khác ngành -> từ chối (TÁCH HOÁ ĐƠN
--         theo quyết định của chủ 21/11/2026; BL-015 bảng §21.2).
--       - Kiểm tra quyền ngành của người gọi.
--       - Chia giảm giá đầu chứng từ xuống từng dòng theo tỷ lệ
--         (làm tròn xuống đồng, phần dư về dòng lớn nhất); tổng
--         phần giảm giá đã chia = đúng discount_amount của chứng từ.
--       - Tách VAT 8% trên cơ sở đã trừ giảm giá:
--         trước-thuế = ROUND(cơ-sở/1.08, 2); VAT = cơ-sở - trước-thuế.
--       - Header total_amount = SUM(cơ-sở các dòng) — SỬA bản 0020
--         (lấy SUM(line_total) nên bỏ qua giảm giá, tính thừa thuế).
--     Bảng tạm _vat_line_calc chỉ sống trong giao dịch gọi hàm.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_vat_invoice(
  p_partner_id uuid,
  p_invoice_no text,
  p_symbol text,
  p_invoice_date date,
  p_provider text,
  p_line_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_invoice uuid;
  v_count integer;
  v_distinct integer;
  v_bad integer;
  v_line uuid;
  v_line_count integer;
  v_before_tax numeric(15,2);
  v_vat numeric(15,2);
  v_total numeric(15,2);
BEGIN
  v_role := public.current_app_role();
  IF v_role NOT IN ('OWNER', 'ACCOUNTING') THEN
    RAISE EXCEPTION 'Chỉ Chủ cửa hàng hoặc Kế toán mới được ghi nhận hoá đơn GTGT.';
  END IF;

  IF p_line_ids IS NULL OR array_length(p_line_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Chưa chọn dòng chứng từ nào để ghi nhận hoá đơn.';
  END IF;

  SELECT count(*) INTO v_count FROM (SELECT unnest(p_line_ids) AS id) s;
  SELECT count(*) INTO v_distinct FROM (SELECT DISTINCT unnest(p_line_ids) AS id) s;
  IF v_count <> v_distinct THEN
    RAISE EXCEPTION 'Danh sách dòng chứng từ có dòng bị trùng.';
  END IF;

  -- Khóa các dòng chứng từ (chống hai phiên cùng ghi nhận một dòng).
  PERFORM 1 FROM public.sales_document_lines
   WHERE id = ANY(p_line_ids) ORDER BY id FOR UPDATE;

  SELECT count(*) INTO v_count
    FROM public.sales_document_lines
   WHERE id = ANY(p_line_ids);
  IF v_count <> array_length(p_line_ids, 1) THEN
    RAISE EXCEPTION 'Có dòng chứng từ không tồn tại.';
  END IF;

  SELECT count(*) INTO v_bad
    FROM public.sales_document_lines l
    JOIN public.sales_documents d ON d.id = l.document_id
   WHERE l.id = ANY(p_line_ids)
     AND (d.status <> 'CONFIRMED' OR d.partner_id IS DISTINCT FROM p_partner_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Chỉ ghi nhận được dòng của chứng từ ĐÃ XÁC NHẬN và cùng một đối tác.';
  END IF;

  SELECT count(*) INTO v_bad
    FROM public.vat_invoice_lines
   WHERE sales_document_line_id = ANY(p_line_ids) AND is_active;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Đã có dòng chứng từ trong danh sách đã được ghi nhận hoá đơn trước đó.';
  END IF;

  -- (P4b) Ngành của dòng phân giải qua sản phẩm.
  SELECT count(*) INTO v_bad
    FROM public.sales_document_lines l
    JOIN public.products p ON p.id = l.product_id
   WHERE l.id = ANY(p_line_ids) AND p.business_line_id IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Có dòng chứng từ thuộc sản phẩm chưa phân loại ngành — phân loại sản phẩm trước khi ghi nhận hoá đơn.';
  END IF;

  SELECT count(DISTINCT p.business_line_id) INTO v_line_count
    FROM public.sales_document_lines l
    JOIN public.products p ON p.id = l.product_id
   WHERE l.id = ANY(p_line_ids);
  IF v_line_count <> 1 THEN
    RAISE EXCEPTION 'Một hoá đơn GTGT chỉ được ghi cho một ngành (Dầu nhớt hoặc Phụ tùng). Tách hoá đơn theo ngành.';
  END IF;
  SELECT p.business_line_id INTO v_line
    FROM public.sales_document_lines l
    JOIN public.products p ON p.id = l.product_id
   WHERE l.id = ANY(p_line_ids) LIMIT 1;

  IF NOT public.user_can_access_business_line(auth.uid(), v_line) THEN
    RAISE EXCEPTION 'Tài khoản không có quyền trên ngành của các dòng chứng từ này.';
  END IF;

  -- Giảm giá đầu chứng từ không được vượt tổng tiền hàng.
  SELECT count(*) INTO v_bad
    FROM public.sales_documents d
   WHERE d.id IN (SELECT DISTINCT document_id FROM public.sales_document_lines WHERE id = ANY(p_line_ids))
     AND d.discount_amount > (SELECT coalesce(sum(line_total), 0) FROM public.sales_document_lines WHERE document_id = d.id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Giảm giá của chứng từ vượt tổng tiền hàng — kiểm tra lại chứng từ gốc.';
  END IF;

  -- Chia giảm giá xuống từng dòng + tách VAT 8% (bảng tạm theo giao dịch).
  DROP TABLE IF EXISTS _vat_line_calc;
  CREATE TEMP TABLE _vat_line_calc (
    line_id uuid PRIMARY KEY,
    discount_share numeric(15,2) NOT NULL DEFAULT 0,
    base numeric(15,2) NOT NULL,
    before_tax numeric(15,2) NOT NULL,
    vat numeric(15,2) NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _vat_line_calc (line_id, discount_share, base, before_tax, vat)
  WITH target_docs AS (
    SELECT DISTINCT l.document_id
      FROM public.sales_document_lines l WHERE l.id = ANY(p_line_ids)
  ),
  doc_lines AS (
    SELECT l.id, l.document_id, l.line_total, d.discount_amount,
           sum(l.line_total) OVER (PARTITION BY l.document_id) AS doc_subtotal
      FROM public.sales_document_lines l
      JOIN public.sales_documents d ON d.id = l.document_id
     WHERE l.document_id IN (SELECT document_id FROM target_docs)
  ),
  floor_shares AS (
    SELECT id, document_id, line_total, discount_amount, doc_subtotal,
           CASE WHEN coalesce(discount_amount, 0) = 0 OR doc_subtotal = 0 THEN 0::numeric(15,2)
                ELSE floor(coalesce(discount_amount, 0) * line_total / doc_subtotal * 100) / 100
           END AS floor_share,
           row_number() OVER (PARTITION BY document_id ORDER BY line_total DESC, id) AS rn
      FROM doc_lines
  ),
  shares AS (
    SELECT id,
           CASE WHEN rn = 1
                THEN coalesce(discount_amount, 0) - (sum(floor_share) OVER (PARTITION BY document_id) - floor_share)
                ELSE floor_share END AS discount_share
      FROM floor_shares
  )
  SELECT s.id, s.discount_share,
         l.line_total - s.discount_share,
         round((l.line_total - s.discount_share) / 1.08, 2),
         (l.line_total - s.discount_share) - round((l.line_total - s.discount_share) / 1.08, 2)
    FROM shares s
    JOIN public.sales_document_lines l ON l.id = s.id
   WHERE s.id = ANY(p_line_ids);

  SELECT count(*) INTO v_bad FROM _vat_line_calc WHERE base < 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Phần giảm giá chia xuống dòng vượt tiền hàng của dòng — kiểm tra lại chứng từ gốc.';
  END IF;

  SELECT coalesce(sum(before_tax), 0), coalesce(sum(vat), 0), coalesce(sum(base), 0)
    INTO v_before_tax, v_vat, v_total
    FROM _vat_line_calc;

  INSERT INTO public.vat_invoices
    (invoice_no, symbol, invoice_date, provider, partner_id, total_amount, total_before_tax, total_vat, business_line_id, status)
  VALUES
    (p_invoice_no, p_symbol, p_invoice_date, p_provider, p_partner_id, v_total, v_before_tax, v_vat, v_line, 'ISSUED')
  RETURNING id INTO v_invoice;

  INSERT INTO public.vat_invoice_lines
    (vat_invoice_id, sales_document_line_id, line_no, amount, vat_rate, discount_amount, amount_before_tax, vat_amount, amount_including_tax)
  SELECT v_invoice, c.line_id, row_number() OVER (ORDER BY u.ord),
         c.base, 8.00, c.discount_share, c.before_tax, c.vat, c.base
    FROM _vat_line_calc c
    JOIN unnest(p_line_ids) WITH ORDINALITY AS u(id, ord) ON u.id = c.line_id;

  UPDATE public.allocation_lines
     SET invoice_status = 'INVOICED'
   WHERE id IN (
     SELECT allocation_line_id FROM public.sales_document_lines
      WHERE id = ANY(p_line_ids)
   );

  RETURN v_invoice;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. reverse_payment + BL-015 (bản sao y hệt 0027 + bước chặn mới).
--    QUYẾT MỚI của chủ 23/11 21:48: OWNER cũng được đảo bút toán
--    (không giữ quy tắc chỉ-Kế-toán theo quyết định kế toán 28/10/2026
--    nữa). SALES / WAREHOUSE / CEO vẫn bị chặn. Các guard khác giữ
--    nguyên: lý do bắt buộc; khóa FOR UPDATE; chặn đảo phiếu đã bị
--    đảo / đảo của đảo / sai số tiền / sai kind / sai ref / sai quỹ /
--    không có phân bổ. Mới: chặn khi chứng từ gốc của phiếu đã có
--    hoá đơn GTGT còn hiệu lực — phải huỷ bản ghi hoá đơn trước rồi
--    mới đảo. Khôi phục đúng 0027 (bản 0029 cũ lệch): phiếu đảo đảo
--    chiều IN<->OUT (mã do trigger cấp theo chiều đã đảo) và đánh
--    dấu dòng tiền gốc is_cancelled.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_payment(
  p_payment_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment record;
  v_reversal uuid;
  v_rev_mov_id uuid;
  v_existing uuid;
  v_alloc_count integer;
  v_doc_ids uuid[];
  v_invoice_no text;
  v_role text;
BEGIN
  v_role := public.current_app_role();
  IF v_role NOT IN ('OWNER', 'ACCOUNTING') THEN
    RAISE EXCEPTION 'Chỉ Chủ cửa hàng và Kế toán mới được đảo bút toán thanh toán.';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Đảo bút toán phải ghi rõ lý do.';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phiếu thanh toán % không tồn tại.', p_payment_id;
  END IF;

  IF v_payment.reversal_of_id IS NOT NULL THEN
    RAISE EXCEPTION 'Phiếu % đã là phiếu đảo của phiếu % — không đảo phiếu đảo.',
      v_payment.doc_code, v_payment.reversal_of_id;
  END IF;

  SELECT id INTO v_existing FROM public.payments
   WHERE reversal_of_id = p_payment_id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Phiếu % đã bị đảo bởi phiếu % rồi.', v_payment.doc_code, v_existing;
  END IF;

  IF v_payment.amount <= 0 THEN
    RAISE EXCEPTION 'Phiếu % có số tiền % — chỉ đảo phiếu có số tiền dương.',
      v_payment.doc_code, v_payment.amount;
  END IF;

  IF v_payment.payment_kind NOT IN ('IN', 'OUT') THEN
    RAISE EXCEPTION 'Phiếu % có loại % — chỉ đảo phiếu thu/chi thường.',
      v_payment.doc_code, v_payment.payment_kind;
  END IF;

  IF v_payment.payable_id IS NULL
     AND v_payment.receivable_id IS NULL
     AND v_payment.settlement_id IS NULL THEN
    RAISE EXCEPTION 'Phiếu % không gắn công nợ hay đợt đối soát nào — không đảo được.',
      v_payment.doc_code;
  END IF;

  IF v_payment.fund_id IS NULL THEN
    RAISE EXCEPTION 'Phiếu % không gắn quỹ tiền — không đảo được (không biết hoàn tiền về quỹ nào).',
      v_payment.doc_code;
  END IF;

  SELECT count(*) INTO v_alloc_count
    FROM public.payment_allocations WHERE payment_id = p_payment_id;
  IF v_alloc_count = 0 THEN
    RAISE EXCEPTION 'Phiếu % chưa có dòng phân bổ nào — không đảo được.',
      v_payment.doc_code;
  END IF;

  -- (P4b, BL-015) Chặn đảo khi chứng từ gốc đã có hoá đơn GTGT còn
  -- hiệu lực. Phải huỷ bản ghi hoá đơn GTGT trước rồi mới đảo lại.
  -- Phải trả mua hàng (không có sales_document) không bao giờ bị chặn.
  SELECT array_agg(DISTINCT sdl.document_id) INTO v_doc_ids
    FROM public.payment_allocations a
    LEFT JOIN public.partner_receivables r ON r.id = a.receivable_id
    LEFT JOIN public.supplier_payables p ON p.id = a.payable_id
    JOIN public.sales_document_lines sdl
      ON sdl.document_id = coalesce(r.source_document_id, p.source_document_id)
   WHERE a.payment_id = v_payment.id;
  IF v_doc_ids IS NOT NULL THEN
    SELECT vi.invoice_no INTO v_invoice_no
      FROM public.vat_invoice_lines vil
      JOIN public.vat_invoices vi ON vi.id = vil.vat_invoice_id
      JOIN public.sales_document_lines sdl ON sdl.id = vil.sales_document_line_id
     WHERE vil.is_active AND vi.status = 'ISSUED'
       AND sdl.document_id = ANY(v_doc_ids)
     ORDER BY vi.invoice_no LIMIT 1;
    IF v_invoice_no IS NOT NULL THEN
      RAISE EXCEPTION 'Không đảo được: chứng từ gốc đã có hoá đơn GTGT % còn hiệu lực. Huỷ bản ghi hoá đơn trước rồi đảo lại.',
        v_invoice_no;
    END IF;
  END IF;

  -- Phiếu đảo ĐẢO CHIỀU tiền (IN <-> OUT) như 0027: trigger
  -- trg_payments_code cấp mã theo chiều đã đảo (đảo phiếu thu PT
  -- thành phiếu chi PC và ngược lại). Bản 0029 cũ giữ nguyên kind
  -- nên phiếu đảo hiện 2 lần trong lịch sử app (vừa là dòng cùng
  -- kind gốc, vừa được lấy thêm qua reversal_of_id) và cộng trùng
  -- vào tiền đã trả của đợt chốt sổ — đã sửa khi soát doc P4.
  INSERT INTO public.payments
    (payment_kind, amount, payment_date, method, payable_id, receivable_id, settlement_id, fund_id, note, reversal_of_id, created_by)
  VALUES
    (CASE WHEN v_payment.payment_kind = 'IN' THEN 'OUT'::payment_type ELSE 'IN'::payment_type END,
     v_payment.amount, CURRENT_DATE, v_payment.method,
     v_payment.payable_id, v_payment.receivable_id, v_payment.settlement_id, v_payment.fund_id,
     'Đảo của ' || v_payment.doc_code || ': ' || p_reason, v_payment.id, auth.uid())
  RETURNING id INTO v_reversal;

  -- Đánh dấu dòng tiền gốc đã đảo huỷ (như 0027): sổ quỹ hiện đúng
  -- trạng thái. Dòng tiền đảo (payment_id = v_reversal, kind
  -- REVERSAL) đã được trg_payments_cash_fund tự tạo khi INSERT trên.
  -- Phiếu gốc không gắn quỹ (fund_id NULL) thì UPDATE này khớp 0 dòng.
  SELECT id INTO v_rev_mov_id FROM public.cash_movements WHERE payment_id = v_reversal;
  UPDATE public.cash_movements
     SET is_cancelled = true,
         cancel_reason = 'Đã đảo bút toán ' || v_payment.doc_code || ' (Lý do: ' || trim(p_reason) || ')',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         reversal_entry_id = v_rev_mov_id
   WHERE payment_id = v_payment.id;

  RETURN v_reversal;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Đối chiếu: bản chụp đã chốt là bất biến (§15.6, BL-017).
--    - Trigger chặn mọi UPDATE/DELETE trên reconciliation_snapshots
--      (mọi role, kể cả service role — trigger chạy trước RLS).
--    - FK period_id: 0023:356 CÓ ON DELETE CASCADE -> đổi RESTRICT
--      (xóa kỳ đang có bản chụp phải bị chặn).
--    - Bỏ policy UPDATE/DELETE của OWNER (giữ SELECT/INSERT).
--    Tạo bản chụp mới vẫn được; sửa sai bằng bản chụp hiệu chỉnh mới.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_guard_reconciliation_snapshots_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Bản chụp đối chiếu đã chốt là bất biến — không được sửa hay xoá. Muốn sửa số liệu, tạo bản chụp hiệu chỉnh mới.';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_reconciliation_snapshots_immutable ON public.reconciliation_snapshots;
CREATE TRIGGER trg_guard_reconciliation_snapshots_immutable
BEFORE UPDATE OR DELETE ON public.reconciliation_snapshots
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_reconciliation_snapshots_immutable();

ALTER TABLE public.reconciliation_snapshots
  DROP CONSTRAINT IF EXISTS reconciliation_snapshots_period_id_fkey;
ALTER TABLE public.reconciliation_snapshots
  ADD CONSTRAINT reconciliation_snapshots_period_id_fkey
  FOREIGN KEY (period_id) REFERENCES public.reconciliation_periods(id) ON DELETE RESTRICT;

DROP POLICY IF EXISTS pol_reconciliation_snapshots_upd ON public.reconciliation_snapshots;
DROP POLICY IF EXISTS pol_reconciliation_snapshots_del ON public.reconciliation_snapshots;

-- ---------------------------------------------------------------------
-- 5. Quỹ tiền theo ngành (§11.5 — mô hình quỹ CHƯA chốt, hỗ trợ cả hai).
--    business_line_id NULL = quỹ chung (Model A); có giá trị = quỹ
--    riêng ngành (Model B). P4 chỉ thêm cột + view, KHÔNG thêm UI gán
--    quỹ (chờ chủ chốt mô hình). Quỹ "Két tiền mặt" hiện có giữ NULL.
-- ---------------------------------------------------------------------
ALTER TABLE public.cash_funds
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);
CREATE INDEX IF NOT EXISTS idx_cash_funds_business_line ON public.cash_funds(business_line_id);

CREATE OR REPLACE VIEW public.v_cash_flow_by_line AS
SELECT cf.id AS fund_id,
       cf.name AS fund_name,
       cf.business_line_id AS fund_line_id,
       a.business_line_id AS line_id,
       -- Chiều tiền hiệu dụng: phiếu đảo mang phân bổ âm và đảo chiều
       -- kind (IN<->OUT, như 0027) nên phân loại theo kind của phiếu
       -- GỐC (qua reversal_of_id); phiếu thường lấy kind của chính nó.
       -- Nhờ đó phiếu đảo tự triệt tiêu đúng ngăn thu/chi của phiếu gốc.
       sum(CASE WHEN coalesce(orig.payment_kind, p.payment_kind) = 'IN' THEN a.amount ELSE -a.amount END) AS net_amount,
       sum(CASE WHEN coalesce(orig.payment_kind, p.payment_kind) = 'IN' THEN a.amount ELSE 0 END) AS in_amount,
       sum(CASE WHEN coalesce(orig.payment_kind, p.payment_kind) = 'OUT' THEN a.amount ELSE 0 END) AS out_amount,
       count(DISTINCT p.id) AS payment_count
  FROM public.payment_allocations a
  JOIN public.payments p ON p.id = a.payment_id
  LEFT JOIN public.payments orig ON orig.id = p.reversal_of_id
  JOIN public.cash_movements cm ON cm.payment_id = p.id
  JOIN public.cash_funds cf ON cf.id = cm.fund_id
 GROUP BY cf.id, cf.name, cf.business_line_id, a.business_line_id;

COMMENT ON VIEW public.v_cash_flow_by_line IS
  'P4b: dòng tiền thu/chi theo quỹ x ngành, suy ra từ payment_allocations (phiếu đảo mang phân bổ âm nên tự triệt tiêu — phân loại theo kind của phiếu gốc vì phiếu đảo đảo chiều IN<->OUT). Phiếu vận hành không gắn công nợ không có phân bổ nên không vào view này; tổng quỹ vẫn đọc v_cash_fund_balances.';

-- ---------------------------------------------------------------------
-- 6. Kiểm chứng cuối migration: ngành đã quy chiếu, VAT tách đúng,
--    snapshot bất biến, không đổi số liệu tài chính.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_rec_total numeric;
  v_pay_total numeric;
  v_pmt_total numeric;
  v_mov_total numeric;
  v_rec_open numeric;
  v_pay_open numeric;
  v_mixed_null integer;
  v_fk text;
  v_pol integer;
BEGIN
  -- Khoản công nợ có chứng từ gốc một ngành thì phải có ngành.
  SELECT count(*) INTO v_mixed_null
    FROM public.partner_receivables r
    JOIN public.sales_documents d ON d.id = r.source_document_id
   WHERE d.business_line_id IS NOT NULL AND r.business_line_id IS NULL;
  IF v_mixed_null > 0 THEN
    RAISE EXCEPTION 'P4b POST-CHECK FAIL: % khoản phải thu có chứng từ gốc đã phân loại nhưng chưa có ngành.', v_mixed_null;
  END IF;
  SELECT count(*) INTO v_mixed_null
    FROM public.supplier_payables p
    JOIN public.sales_documents d ON d.id = p.source_document_id
   WHERE p.source_kind = 'CONSIGNMENT_SALE' AND d.business_line_id IS NOT NULL AND p.business_line_id IS NULL;
  IF v_mixed_null > 0 THEN
    RAISE EXCEPTION 'P4b POST-CHECK FAIL: % khoản phải trả ký gửi có chứng từ gốc đã phân loại nhưng chưa có ngành.', v_mixed_null;
  END IF;

  -- Hoá đơn cũ: tổng trước thuế + VAT phải cộng lại đúng total_amount.
  SELECT count(*) INTO v_mixed_null
    FROM public.vat_invoices
   WHERE total_before_tax IS NOT NULL
     AND (total_before_tax + total_vat) <> total_amount;
  IF v_mixed_null > 0 THEN
    RAISE EXCEPTION 'P4b POST-CHECK FAIL: % hoá đơn GTGT có trước-thuế + VAT lệch tổng tiền.', v_mixed_null;
  END IF;

  -- Snapshot: FK phải là RESTRICT, không còn policy UPDATE/DELETE.
  SELECT pg_get_constraintdef(oid) INTO v_fk
    FROM pg_constraint
   WHERE conname = 'reconciliation_snapshots_period_id_fkey';
  IF v_fk IS NULL OR v_fk NOT ILIKE '%ON DELETE RESTRICT%' THEN
    RAISE EXCEPTION 'P4b POST-CHECK FAIL: FK reconciliation_snapshots_period_id_fkey không phải RESTRICT: %.', v_fk;
  END IF;
  SELECT count(*) INTO v_pol FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'reconciliation_snapshots'
     AND cmd IN ('UPDATE', 'DELETE');
  IF v_pol > 0 THEN
    RAISE EXCEPTION 'P4b POST-CHECK FAIL: còn % policy UPDATE/DELETE trên reconciliation_snapshots.', v_pol;
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_pay_total FROM public.supplier_payables;
  SELECT coalesce(sum(amount), 0) INTO v_rec_total FROM public.partner_receivables;
  SELECT coalesce(sum(amount), 0) INTO v_pmt_total FROM public.payments;
  SELECT coalesce(sum(amount), 0) INTO v_mov_total FROM public.cash_movements;
  SELECT coalesce(sum(amount - amount_paid), 0) INTO v_rec_open FROM public.partner_receivables;
  SELECT coalesce(sum(amount - amount_paid), 0) INTO v_pay_open FROM public.supplier_payables;
  RAISE NOTICE 'P4b POST-CHECK | finance+VAT OK | phai-tra-total=% phai-thu-total=% payments-total=% cash-movements-total=% phai-thu-con-no=% phai-tra-con-no=%',
    v_pay_total, v_rec_total, v_pmt_total, v_mov_total, v_rec_open, v_pay_open;
END $$;

COMMIT;
