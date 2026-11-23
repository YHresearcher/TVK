-- =====================================================================
-- 0025_business_lines.sql — TVK V2.0 P1: Database Foundation and Security
-- Tách 2 ngành hàng: OIL (Dầu nhớt) / AUTO_PARTS (Phụ tùng).
--
-- Phạm vi P1 (theo Prompt-TVK-V2.0-FINAL.md §20):
--   1. Bảng business_lines + user_business_lines (+ RLS + grants).
--   2. products.business_line_id + backfill bằng MAPPING TƯỜNG MINH theo
--      GIÁ TRỊ product_group (KHÔNG BAO GIỜ phân loại theo chuỗi con trong
--      tên sản phẩm — "Lọc nhớt"/"Lọc dầu" là PHỤ TÙNG).
--   3. Bảng kiểm toán phân loại + hàng đợi sản phẩm chưa phân loại.
--   4. business_line_id (nullable) trên 7 bảng chứng từ + backfill từ dòng
--      (chỉ khi mọi dòng cùng một ngành; chứng từ hỗn hợp để NULL).
--   5. Guard: cấm đổi ngành hàng của sản phẩm đã có giao dịch/tồn kho;
--      cấm dòng hàng lệch ngành với chứng từ (chỉ khi cả hai phía đã gán).
--   6. Mở rộng v_batches_for_sales (§6.5): lọc theo phân quyền ngành hàng,
--      giữ nguyên guard active-profile của 0024, cột mới APPEND Ở CUỐI.
--
-- NGUYÊN TẮC TƯƠNG THÍCH NGƯỢC (Expand–Backfill–Validate–Enforce–Contract):
--   - Mọi cột mới đều NULLABLE trong P1; app hiện tại chưa ghi business_line_id
--     nên mọi guard đều NULL-tolerant (chỉ chặn khi cả hai phía đã gán).
--   - Quy tắc tương thích P1: user CHƯA có dòng nào trong user_business_lines
--     vẫn thấy toàn bộ (hành vi cũ). Chỉ khi OWNER đã gán phân quyền thì view
--     mới thu hẹp. Việc bắt buộc gán (assignment-required) thuộc P2.
--   - Migration này KHÔNG đụng bảng tài chính (supplier_payables,
--     partner_receivables, settlements, settlement_lines, payments,
--     cash_funds, cash_movements, reconciliation_*), KHÔNG sửa sổ cái kho
--     (stock_movements), KHÔNG đổi mã chứng từ, KHÔNG xoá dữ liệu.
--   - sales_orders KHÔNG có business_line_id (§5.4 E2: DH là chứng từ cha
--     chung, không có dòng; ngành nằm ở sales_documents).
--
-- Chạy SAU 0024. Chạy được nhiều lần (idempotent ở mức hợp lý: IF NOT EXISTS /
-- ON CONFLICT / WHERE ... IS NULL); các policy dùng DROP POLICY IF EXISTS +
-- CREATE POLICY để chạy lại an toàn.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. business_lines — danh mục ngành hàng
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_lines (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code       text NOT NULL UNIQUE,
    name       text NOT NULL,
    is_active  boolean NOT NULL DEFAULT TRUE,
    created_at timestamptz NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.business_lines IS 'Ngành hàng TVK V2.0 P1: OIL (Dầu nhớt), AUTO_PARTS (Phụ tùng). Một ứng dụng, một database, hai ngành tách biệt vận hành.';

ALTER TABLE public.business_lines ENABLE ROW LEVEL SECURITY;

INSERT INTO public.business_lines (code, name)
VALUES
    ('OIL', 'Dầu nhớt'),
    ('AUTO_PARTS', 'Phụ tùng')
ON CONFLICT (code) DO NOTHING;

-- Mọi người dùng đã đăng nhập đều đọc được danh mục (cần cho bộ chọn ngành ở P2);
-- chỉ OWNER được quản lý danh mục.
DROP POLICY IF EXISTS pol_business_lines_sel ON public.business_lines;
CREATE POLICY pol_business_lines_sel ON public.business_lines
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS pol_business_lines_ins ON public.business_lines;
CREATE POLICY pol_business_lines_ins ON public.business_lines
  FOR INSERT TO authenticated WITH CHECK (current_app_role() = 'OWNER');
DROP POLICY IF EXISTS pol_business_lines_upd ON public.business_lines;
CREATE POLICY pol_business_lines_upd ON public.business_lines
  FOR UPDATE TO authenticated
  USING (current_app_role() = 'OWNER') WITH CHECK (current_app_role() = 'OWNER');
DROP POLICY IF EXISTS pol_business_lines_del ON public.business_lines;
CREATE POLICY pol_business_lines_del ON public.business_lines
  FOR DELETE TO authenticated USING (current_app_role() = 'OWNER');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_lines TO authenticated;

-- ---------------------------------------------------------------------
-- 2. user_business_lines — phân quyền theo ngành hàng (§6.2)
--    Một dòng = một user được phép làm việc trên một ngành.
--    Phân quyền chỉ giới hạn PHẠM VI ngành, không cấp thêm quyền chức năng
--    (SALES chỉ-OIL vẫn không xem được giá vốn/lãi của OWNER).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_business_lines (
    user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    business_line_id uuid NOT NULL REFERENCES public.business_lines(id) ON DELETE CASCADE,
    created_at       timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, business_line_id)
);
CREATE INDEX IF NOT EXISTS idx_user_business_lines_line
  ON public.user_business_lines (business_line_id);

ALTER TABLE public.user_business_lines ENABLE ROW LEVEL SECURITY;

-- Xem: chính mình, hoặc OWNER/CEO xem tất cả (CEO chỉ xem để kiểm toán).
DROP POLICY IF EXISTS pol_user_business_lines_sel ON public.user_business_lines;
CREATE POLICY pol_user_business_lines_sel ON public.user_business_lines
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR current_app_role() IN ('OWNER', 'CEO'));
-- Gán / thu hồi: chỉ OWNER. Không có policy UPDATE: đổi phân quyền =
-- DELETE dòng cũ + INSERT dòng mới (để lại dấu vết rõ ràng).
DROP POLICY IF EXISTS pol_user_business_lines_ins ON public.user_business_lines;
CREATE POLICY pol_user_business_lines_ins ON public.user_business_lines
  FOR INSERT TO authenticated WITH CHECK (current_app_role() = 'OWNER');
DROP POLICY IF EXISTS pol_user_business_lines_del ON public.user_business_lines;
CREATE POLICY pol_user_business_lines_del ON public.user_business_lines
  FOR DELETE TO authenticated USING (current_app_role() = 'OWNER');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_business_lines TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Hàm kiểm tra quyền truy cập ngành hàng (dùng chung cho view + RLS sau này)
--    - Profile không active -> false (fail-closed).
--    - OWNER / CEO -> mọi ngành.
--    - Sản phẩm/chứng từ CHƯA phân loại (NULL) -> true (hành vi cũ, để xử lý
--      thủ công ở hàng đợi; không tự ẩn dữ liệu chưa phân loại).
--    - User chưa có phân quyền nào -> true (TƯƠNG THÍCH P1: giữ nguyên hành
--      vi cũ cho tới khi OWNER bắt đầu gán; P2 sẽ siết thành bắt buộc gán).
--    - Ngược lại: chỉ true khi user được gán đúng ngành đó.
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
          OR NOT EXISTS (
            SELECT 1 FROM public.user_business_lines u WHERE u.user_id = p_user_id
          )
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
  'P1: kiểm tra user có được xem/làm việc trên một ngành hàng không. NULL = chưa phân loại -> cho qua (legacy). User chưa được gán ngành nào -> cho qua toàn bộ (tương thích P1); OWNER/CEO luôn được qua.';

-- ---------------------------------------------------------------------
-- 4. Bảng mapping tường minh: GIÁ TRỊ product_group -> business_line
--    (Prompt §5.2 E4 — mapping do chủ phê duyệt, KHÔNG heuristic tên hàng.)
--    Nhóm lạ / NULL / rỗng KHÔNG có trong bảng này -> ở lại NULL, vào hàng
--    đợi phân loại thủ công (view v_unclassified_products), KHÔNG tự gán.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_line_group_mappings (
    product_group    text PRIMARY KEY,
    business_line_id uuid NOT NULL REFERENCES public.business_lines(id),
    created_at       timestamptz NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.business_line_group_mappings IS
  'Mapping tường minh product_group -> business_line (chủ phê duyệt). Dùng cho backfill P1 và cho import tạo sản phẩm mới ở P2. Nhóm không có trong bảng này = chưa phân loại, không tự gán.';

INSERT INTO public.business_line_group_mappings (product_group, business_line_id)
VALUES
    ('Linh kiện ô tô tải', (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')),
    ('Nhớt',               (SELECT id FROM public.business_lines WHERE code = 'OIL')),
    ('Dầu nhớt',           (SELECT id FROM public.business_lines WHERE code = 'OIL'))
ON CONFLICT (product_group) DO NOTHING;

ALTER TABLE public.business_line_group_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_bl_group_mappings_sel ON public.business_line_group_mappings;
CREATE POLICY pol_bl_group_mappings_sel ON public.business_line_group_mappings
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS pol_bl_group_mappings_ins ON public.business_line_group_mappings;
CREATE POLICY pol_bl_group_mappings_ins ON public.business_line_group_mappings
  FOR INSERT TO authenticated WITH CHECK (current_app_role() = 'OWNER');
DROP POLICY IF EXISTS pol_bl_group_mappings_upd ON public.business_line_group_mappings;
CREATE POLICY pol_bl_group_mappings_upd ON public.business_line_group_mappings
  FOR UPDATE TO authenticated
  USING (current_app_role() = 'OWNER') WITH CHECK (current_app_role() = 'OWNER');
DROP POLICY IF EXISTS pol_bl_group_mappings_del ON public.business_line_group_mappings;
CREATE POLICY pol_bl_group_mappings_del ON public.business_line_group_mappings
  FOR DELETE TO authenticated USING (current_app_role() = 'OWNER');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_line_group_mappings TO authenticated;

-- ---------------------------------------------------------------------
-- 5. products.business_line_id + BACKFILL + KIỂM TOÁN PHÂN LOẠI
-- ---------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);
CREATE INDEX IF NOT EXISTS idx_products_business_line
  ON public.products (business_line_id);
COMMENT ON COLUMN public.products.business_line_id IS
  'Ngành hàng V2.0 (FK business_lines). NULL = chưa phân loại — vào hàng đợi phân loại thủ công (v_unclassified_products), KHÔNG tự gán. Chỉ siết NOT NULL ở P2 khi form đã ghi được ngành.';

-- Bảng kiểm toán phân loại: một dòng cho mỗi lần phân loại/đổi ngành của một
-- sản phẩm (backfill + đổi tay + guard trigger). Append-only: không có policy
-- INSERT/UPDATE/DELETE cho authenticated (chỉ trigger SECURITY DEFINER và
-- postgres mới ghi được); SELECT cho OWNER/ACCOUNTING/CEO.
CREATE TABLE IF NOT EXISTS public.product_business_line_audit (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id       uuid NOT NULL REFERENCES public.products(id),
    sku              text NOT NULL,
    product_group    text,
    business_line_id uuid REFERENCES public.business_lines(id),
    business_line_code text,
    source           text NOT NULL,  -- MIGRATION_0025_BACKFILL | MANUAL_CORRECTION | GUARD_TRIGGER
    changed_by       uuid REFERENCES public.profiles(id),
    created_at       timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_bl_audit_product
  ON public.product_business_line_audit (product_id);

ALTER TABLE public.product_business_line_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_product_bl_audit_sel ON public.product_business_line_audit;
CREATE POLICY pol_product_bl_audit_sel ON public.product_business_line_audit
  FOR SELECT TO authenticated
  USING (current_app_role() IN ('OWNER', 'ACCOUNTING', 'CEO'));
-- Cố ý KHÔNG tạo policy INSERT/UPDATE/DELETE: bảng append-only, chỉ ghi qua
-- trigger SECURITY DEFINER (mục 8) hoặc migration chạy bằng postgres.
-- Thu hồi luôn quyền ghi ở tầng GRANT (phòng khi default privileges 0005
-- đã cấp sẵn): RLS + GRANT cùng chặn ghi trực tiếp.
GRANT SELECT ON public.product_business_line_audit TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.product_business_line_audit FROM authenticated;

-- Backfill: khớp CHÍNH XÁC giá trị product_group với bảng mapping.
-- (Không dùng LIKE, không dùng substring tên hàng.)
UPDATE public.products p
   SET business_line_id = m.business_line_id
  FROM public.business_line_group_mappings m
 WHERE p.business_line_id IS NULL
   AND p.product_group = m.product_group;

-- Ghi kiểm toán cho toàn bộ sản phẩm vừa phân loại (chạy lại không ghi trùng).
INSERT INTO public.product_business_line_audit
  (product_id, sku, product_group, business_line_id, business_line_code, source, changed_by)
SELECT p.id, p.sku, p.product_group, p.business_line_id, bl.code,
       'MIGRATION_0025_BACKFILL', NULL
  FROM public.products p
  JOIN public.business_lines bl ON bl.id = p.business_line_id
 WHERE p.business_line_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.product_business_line_audit a
      WHERE a.product_id = p.id AND a.source = 'MIGRATION_0025_BACKFILL'
   );

-- Hàng đợi phân loại thủ công: sản phẩm chưa có ngành (nhóm lạ / NULL / rỗng).
CREATE OR REPLACE VIEW public.v_unclassified_products AS
SELECT p.id, p.sku, p.name, p.product_group, p.created_at
  FROM public.products p
 WHERE p.business_line_id IS NULL;
GRANT SELECT ON public.v_unclassified_products TO authenticated;
COMMENT ON VIEW public.v_unclassified_products IS
  'P1: hàng đợi sản phẩm chưa phân loại ngành — xử lý thủ công theo quy trình đã phê duyệt, không tự gán.';

-- Báo cáo phân loại (in ra log khi chạy migration).
DO $$
DECLARE
  v_total       integer;
  v_oil         integer;
  v_parts       integer;
  v_unclassified integer;
  v_unknown     text;
  v_risky       integer;
BEGIN
  SELECT count(*) INTO v_total FROM public.products;
  SELECT count(*) INTO v_oil FROM public.products p
    JOIN public.business_lines bl ON bl.id = p.business_line_id WHERE bl.code = 'OIL';
  SELECT count(*) INTO v_parts FROM public.products p
    JOIN public.business_lines bl ON bl.id = p.business_line_id WHERE bl.code = 'AUTO_PARTS';
  SELECT count(*) INTO v_unclassified FROM public.products WHERE business_line_id IS NULL;
  SELECT string_agg(DISTINCT coalesce(product_group, '(NULL)'), ', ') INTO v_unknown
    FROM public.products
   WHERE business_line_id IS NULL;
  -- Sản phẩm chưa phân loại mà ĐÃ có tồn kho hoặc giao dịch: cần xử lý ngay.
  SELECT count(*) INTO v_risky FROM public.products p
   WHERE p.business_line_id IS NULL
     AND (
       EXISTS (SELECT 1 FROM public.stock_batches b WHERE b.product_id = p.id)
       OR EXISTS (SELECT 1 FROM public.sales_document_lines l WHERE l.product_id = p.id)
       OR EXISTS (SELECT 1 FROM public.purchase_receipt_items i WHERE i.product_id = p.id)
     );
  RAISE NOTICE 'P1 CLASSIFICATION: total=% | OIL=% | AUTO_PARTS=% | UNCLASSIFIED=% | unknown groups=[%] | unclassified-with-stock-or-txn=%',
    v_total, v_oil, v_parts, v_unclassified, coalesce(v_unknown, '(none)'), v_risky;
  IF v_unclassified > 0 THEN
    RAISE WARNING 'P1 CLASSIFICATION: còn % sản phẩm chưa phân loại (nhóm lạ: %) — xem v_unclassified_products và phân loại thủ công theo quy trình đã phê duyệt. KHÔNG tự gán.',
      v_unclassified, coalesce(v_unknown, '(none)');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. business_line_id trên 7 bảng chứng từ (NULLABLE ở P1) + BACKFILL
--    sales_orders KHÔNG có cột này (§5.4 E2).
-- ---------------------------------------------------------------------
ALTER TABLE public.purchase_receipts
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);
ALTER TABLE public.consignment_receipts
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);
ALTER TABLE public.consignment_out_slips
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);
ALTER TABLE public.consumption_reports
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);
ALTER TABLE public.allocation_slips
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);
ALTER TABLE public.sales_documents
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);
ALTER TABLE public.return_documents
  ADD COLUMN IF NOT EXISTS business_line_id uuid REFERENCES public.business_lines(id);

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_bl ON public.purchase_receipts (business_line_id);
CREATE INDEX IF NOT EXISTS idx_consignment_receipts_bl ON public.consignment_receipts (business_line_id);
CREATE INDEX IF NOT EXISTS idx_consignment_out_slips_bl ON public.consignment_out_slips (business_line_id);
CREATE INDEX IF NOT EXISTS idx_consumption_reports_bl ON public.consumption_reports (business_line_id);
CREATE INDEX IF NOT EXISTS idx_allocation_slips_bl ON public.allocation_slips (business_line_id);
CREATE INDEX IF NOT EXISTS idx_sales_documents_bl ON public.sales_documents (business_line_id);
CREATE INDEX IF NOT EXISTS idx_return_documents_bl ON public.return_documents (business_line_id);

COMMENT ON COLUMN public.purchase_receipts.business_line_id IS 'Ngành hàng V2.0 P1: suy ra từ dòng hàng khi backfill; NULL = hỗn hợp/chưa xác định (không ép một ngành).';
COMMENT ON COLUMN public.sales_documents.business_line_id IS 'Ngành hàng V2.0 P1: một chứng từ BH/KG chỉ thuộc một ngành; NULL = hỗn hợp/chưa xác định.';

-- Backfill: chỉ gán khi MỌI dòng đều đã phân loại VÀ cùng một ngành.
-- Chứng từ hỗn hợp hoặc có dòng chưa phân loại -> giữ NULL (không ép).
UPDATE public.purchase_receipts h
   SET business_line_id = s.line_id
  FROM (
    SELECT i.receipt_id AS hid, (array_agg(p.business_line_id))[1] AS line_id
      FROM public.purchase_receipt_items i
      JOIN public.products p ON p.id = i.product_id
     GROUP BY i.receipt_id
    HAVING count(DISTINCT p.business_line_id) = 1
       AND count(*) = count(p.business_line_id)
  ) s
 WHERE h.id = s.hid AND h.business_line_id IS NULL;

UPDATE public.consignment_receipts h
   SET business_line_id = s.line_id
  FROM (
    SELECT i.receipt_id AS hid, (array_agg(p.business_line_id))[1] AS line_id
      FROM public.consignment_receipt_items i
      JOIN public.products p ON p.id = i.product_id
     GROUP BY i.receipt_id
    HAVING count(DISTINCT p.business_line_id) = 1
       AND count(*) = count(p.business_line_id)
  ) s
 WHERE h.id = s.hid AND h.business_line_id IS NULL;

UPDATE public.consignment_out_slips h
   SET business_line_id = s.line_id
  FROM (
    SELECT i.slip_id AS hid, (array_agg(p.business_line_id))[1] AS line_id
      FROM public.consignment_out_items i
      JOIN public.stock_batches b ON b.id = i.batch_id
      JOIN public.products p ON p.id = b.product_id
     GROUP BY i.slip_id
    HAVING count(DISTINCT p.business_line_id) = 1
       AND count(*) = count(p.business_line_id)
  ) s
 WHERE h.id = s.hid AND h.business_line_id IS NULL;

UPDATE public.consumption_reports h
   SET business_line_id = s.line_id
  FROM (
    SELECT i.report_id AS hid, (array_agg(p.business_line_id))[1] AS line_id
      FROM public.consumption_report_items i
      JOIN public.products p ON p.id = i.product_id
     GROUP BY i.report_id
    HAVING count(DISTINCT p.business_line_id) = 1
       AND count(*) = count(p.business_line_id)
  ) s
 WHERE h.id = s.hid AND h.business_line_id IS NULL;

UPDATE public.allocation_slips h
   SET business_line_id = s.line_id
  FROM (
    SELECT i.allocation_id AS hid, (array_agg(p.business_line_id))[1] AS line_id
      FROM public.allocation_lines i
      JOIN public.products p ON p.id = i.product_id
     GROUP BY i.allocation_id
    HAVING count(DISTINCT p.business_line_id) = 1
       AND count(*) = count(p.business_line_id)
  ) s
 WHERE h.id = s.hid AND h.business_line_id IS NULL;

UPDATE public.sales_documents h
   SET business_line_id = s.line_id
  FROM (
    SELECT i.document_id AS hid, (array_agg(p.business_line_id))[1] AS line_id
      FROM public.sales_document_lines i
      JOIN public.products p ON p.id = i.product_id
     GROUP BY i.document_id
    HAVING count(DISTINCT p.business_line_id) = 1
       AND count(*) = count(p.business_line_id)
  ) s
 WHERE h.id = s.hid AND h.business_line_id IS NULL;

UPDATE public.return_documents h
   SET business_line_id = s.line_id
  FROM (
    SELECT i.return_id AS hid, (array_agg(p.business_line_id))[1] AS line_id
      FROM public.return_items i
      JOIN public.stock_batches b ON b.id = i.batch_id
      JOIN public.products p ON p.id = b.product_id
     GROUP BY i.return_id
    HAVING count(DISTINCT p.business_line_id) = 1
       AND count(*) = count(p.business_line_id)
  ) s
 WHERE h.id = s.hid AND h.business_line_id IS NULL;

-- Báo cáo backfill chứng từ.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT 'purchase_receipts' AS tbl,
           (SELECT count(*) FROM public.purchase_receipts) AS total,
           (SELECT count(*) FROM public.purchase_receipts WHERE business_line_id IS NOT NULL) AS classified
    UNION ALL SELECT 'consignment_receipts',
           (SELECT count(*) FROM public.consignment_receipts),
           (SELECT count(*) FROM public.consignment_receipts WHERE business_line_id IS NOT NULL)
    UNION ALL SELECT 'consignment_out_slips',
           (SELECT count(*) FROM public.consignment_out_slips),
           (SELECT count(*) FROM public.consignment_out_slips WHERE business_line_id IS NOT NULL)
    UNION ALL SELECT 'consumption_reports',
           (SELECT count(*) FROM public.consumption_reports),
           (SELECT count(*) FROM public.consumption_reports WHERE business_line_id IS NOT NULL)
    UNION ALL SELECT 'allocation_slips',
           (SELECT count(*) FROM public.allocation_slips),
           (SELECT count(*) FROM public.allocation_slips WHERE business_line_id IS NOT NULL)
    UNION ALL SELECT 'sales_documents',
           (SELECT count(*) FROM public.sales_documents),
           (SELECT count(*) FROM public.sales_documents WHERE business_line_id IS NOT NULL)
    UNION ALL SELECT 'return_documents',
           (SELECT count(*) FROM public.return_documents),
           (SELECT count(*) FROM public.return_documents WHERE business_line_id IS NOT NULL)
  LOOP
    RAISE NOTICE 'P1 HEADER BACKFILL: % total=% classified=% unclassified(mixed-or-pending)=%',
      r.tbl, r.total, r.classified, r.total - r.classified;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 7. GUARD: cấm đổi ngành hàng của sản phẩm đã có giao dịch / tồn kho (§5.3)
--    - NULL -> giá trị (phân loại lần đầu): luôn cho, ghi kiểm toán.
--    - Đổi ngành / xoá ngành khi sản phẩm đã có tham chiếu ở bất kỳ bảng
--      giao dịch nào (lô, phiếu nhập, phiếu ký gửi, BT, PB, BH/KG, trả hàng):
--      CHẶN. Đổi ngành lịch sử phải dùng quy trình điều chỉnh đã phê duyệt.
--    - Đổi ngành khi chưa có tham chiếu nào: cho, ghi kiểm toán.
--    Trigger tạo SAU backfill để backfill không ghi trùng kiểm toán.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_guard_product_business_line()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_refs integer;
BEGIN
  IF OLD.business_line_id IS NOT DISTINCT FROM NEW.business_line_id THEN
    RETURN NEW;
  END IF;

  IF OLD.business_line_id IS NOT NULL THEN
    SELECT
      (SELECT count(*) FROM public.stock_batches WHERE product_id = NEW.id)
      + (SELECT count(*) FROM public.purchase_receipt_items WHERE product_id = NEW.id)
      + (SELECT count(*) FROM public.consignment_receipt_items WHERE product_id = NEW.id)
      + (SELECT count(*) FROM public.consumption_report_items WHERE product_id = NEW.id)
      + (SELECT count(*) FROM public.allocation_lines WHERE product_id = NEW.id)
      + (SELECT count(*) FROM public.sales_document_lines WHERE product_id = NEW.id)
      + (SELECT count(*) FROM public.return_items ri
          JOIN public.stock_batches b ON b.id = ri.batch_id
         WHERE b.product_id = NEW.id)
    INTO v_refs;
    IF v_refs > 0 THEN
      RAISE EXCEPTION 'Không được đổi ngành hàng của sản phẩm đã có giao dịch hoặc tồn kho (sản phẩm % đã có % tham chiếu). Đổi ngành lịch sử phải dùng quy trình điều chỉnh đã phê duyệt.',
        OLD.sku, v_refs;
    END IF;
  END IF;

  -- Thay đổi được phép: ghi kiểm toán (hàm SECURITY DEFINER nên ghi được
  -- vào bảng audit append-only bất chấp RLS).
  INSERT INTO public.product_business_line_audit
    (product_id, sku, product_group, business_line_id, business_line_code, source, changed_by)
  VALUES (
    NEW.id, NEW.sku, NEW.product_group, NEW.business_line_id,
    (SELECT code FROM public.business_lines WHERE id = NEW.business_line_id),
    'GUARD_TRIGGER', auth.uid()
  );
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tvk_guard_product_business_line() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_products_business_line_guard ON public.products;
CREATE TRIGGER trg_products_business_line_guard
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_product_business_line();

-- ---------------------------------------------------------------------
-- 8. GUARD: dòng hàng phải cùng ngành với chứng từ (§5.4)
--    Chỉ chặn khi CẢ HAI phía đã gán ngành (NULL-tolerant ở P1 — app hiện
--    tại chưa ghi business_line_id nên mọi luồng cũ vẫn chạy).
--    Hàm chung: TG_ARGV[0] = bảng chứng từ, TG_ARGV[1] = cột FK trên dòng,
--    TG_ARGV[2] = 'batch' (sản phẩm suy qua lô) hoặc 'product' (product_id).
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
  SELECT business_line_id INTO v_product_line
    FROM public.products WHERE id = v_product_id;
  IF v_product_line IS NULL THEN
    RETURN NEW;
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

DROP TRIGGER IF EXISTS trg_guard_line_bl ON public.purchase_receipt_items;
CREATE TRIGGER trg_guard_line_bl
BEFORE INSERT OR UPDATE ON public.purchase_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_line_business_line('purchase_receipts', 'receipt_id', 'product');

DROP TRIGGER IF EXISTS trg_guard_line_bl ON public.consignment_receipt_items;
CREATE TRIGGER trg_guard_line_bl
BEFORE INSERT OR UPDATE ON public.consignment_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_line_business_line('consignment_receipts', 'receipt_id', 'product');

DROP TRIGGER IF EXISTS trg_guard_line_bl ON public.consignment_out_items;
CREATE TRIGGER trg_guard_line_bl
BEFORE INSERT OR UPDATE ON public.consignment_out_items
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_line_business_line('consignment_out_slips', 'slip_id', 'batch');

DROP TRIGGER IF EXISTS trg_guard_line_bl ON public.consumption_report_items;
CREATE TRIGGER trg_guard_line_bl
BEFORE INSERT OR UPDATE ON public.consumption_report_items
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_line_business_line('consumption_reports', 'report_id', 'product');

DROP TRIGGER IF EXISTS trg_guard_line_bl ON public.allocation_lines;
CREATE TRIGGER trg_guard_line_bl
BEFORE INSERT OR UPDATE ON public.allocation_lines
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_line_business_line('allocation_slips', 'allocation_id', 'product');

DROP TRIGGER IF EXISTS trg_guard_line_bl ON public.sales_document_lines;
CREATE TRIGGER trg_guard_line_bl
BEFORE INSERT OR UPDATE ON public.sales_document_lines
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_line_business_line('sales_documents', 'document_id', 'product');

DROP TRIGGER IF EXISTS trg_guard_line_bl ON public.return_items;
CREATE TRIGGER trg_guard_line_bl
BEFORE INSERT OR UPDATE ON public.return_items
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_line_business_line('return_documents', 'return_id', 'batch');

-- ---------------------------------------------------------------------
-- 9. GUARD: cấm đổi ngành của chứng từ khi dòng hiện có lệch ngành (§5.4)
--    Chỉ chặn khi NEW.business_line_id đã gán và có dòng đã phân loại khác
--    ngành. Xoá ngành (về NULL) được phép ở P1 (P2 sẽ siết).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tvk_guard_header_business_line()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bad integer := 0;
BEGIN
  IF OLD.business_line_id IS NOT DISTINCT FROM NEW.business_line_id THEN
    RETURN NEW;
  END IF;
  IF NEW.business_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'purchase_receipts' THEN
    SELECT count(*) INTO v_bad FROM public.purchase_receipt_items i
      JOIN public.products p ON p.id = i.product_id
     WHERE i.receipt_id = NEW.id AND p.business_line_id IS NOT NULL
       AND p.business_line_id IS DISTINCT FROM NEW.business_line_id;
  ELSIF TG_TABLE_NAME = 'consignment_receipts' THEN
    SELECT count(*) INTO v_bad FROM public.consignment_receipt_items i
      JOIN public.products p ON p.id = i.product_id
     WHERE i.receipt_id = NEW.id AND p.business_line_id IS NOT NULL
       AND p.business_line_id IS DISTINCT FROM NEW.business_line_id;
  ELSIF TG_TABLE_NAME = 'consignment_out_slips' THEN
    SELECT count(*) INTO v_bad FROM public.consignment_out_items i
      JOIN public.stock_batches b ON b.id = i.batch_id
      JOIN public.products p ON p.id = b.product_id
     WHERE i.slip_id = NEW.id AND p.business_line_id IS NOT NULL
       AND p.business_line_id IS DISTINCT FROM NEW.business_line_id;
  ELSIF TG_TABLE_NAME = 'consumption_reports' THEN
    SELECT count(*) INTO v_bad FROM public.consumption_report_items i
      JOIN public.products p ON p.id = i.product_id
     WHERE i.report_id = NEW.id AND p.business_line_id IS NOT NULL
       AND p.business_line_id IS DISTINCT FROM NEW.business_line_id;
  ELSIF TG_TABLE_NAME = 'allocation_slips' THEN
    SELECT count(*) INTO v_bad FROM public.allocation_lines i
      JOIN public.products p ON p.id = i.product_id
     WHERE i.allocation_id = NEW.id AND p.business_line_id IS NOT NULL
       AND p.business_line_id IS DISTINCT FROM NEW.business_line_id;
  ELSIF TG_TABLE_NAME = 'sales_documents' THEN
    SELECT count(*) INTO v_bad FROM public.sales_document_lines i
      JOIN public.products p ON p.id = i.product_id
     WHERE i.document_id = NEW.id AND p.business_line_id IS NOT NULL
       AND p.business_line_id IS DISTINCT FROM NEW.business_line_id;
  ELSIF TG_TABLE_NAME = 'return_documents' THEN
    SELECT count(*) INTO v_bad FROM public.return_items i
      JOIN public.stock_batches b ON b.id = i.batch_id
      JOIN public.products p ON p.id = b.product_id
     WHERE i.return_id = NEW.id AND p.business_line_id IS NOT NULL
       AND p.business_line_id IS DISTINCT FROM NEW.business_line_id;
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Không được đổi ngành của chứng từ % khi còn % dòng thuộc ngành khác.',
      TG_TABLE_NAME, v_bad;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tvk_guard_header_business_line() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_header_bl ON public.purchase_receipts;
CREATE TRIGGER trg_guard_header_bl
BEFORE UPDATE ON public.purchase_receipts
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_header_business_line();
DROP TRIGGER IF EXISTS trg_guard_header_bl ON public.consignment_receipts;
CREATE TRIGGER trg_guard_header_bl
BEFORE UPDATE ON public.consignment_receipts
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_header_business_line();
DROP TRIGGER IF EXISTS trg_guard_header_bl ON public.consignment_out_slips;
CREATE TRIGGER trg_guard_header_bl
BEFORE UPDATE ON public.consignment_out_slips
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_header_business_line();
DROP TRIGGER IF EXISTS trg_guard_header_bl ON public.consumption_reports;
CREATE TRIGGER trg_guard_header_bl
BEFORE UPDATE ON public.consumption_reports
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_header_business_line();
DROP TRIGGER IF EXISTS trg_guard_header_bl ON public.allocation_slips;
CREATE TRIGGER trg_guard_header_bl
BEFORE UPDATE ON public.allocation_slips
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_header_business_line();
DROP TRIGGER IF EXISTS trg_guard_header_bl ON public.sales_documents;
CREATE TRIGGER trg_guard_header_bl
BEFORE UPDATE ON public.sales_documents
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_header_business_line();
DROP TRIGGER IF EXISTS trg_guard_header_bl ON public.return_documents;
CREATE TRIGGER trg_guard_header_bl
BEFORE UPDATE ON public.return_documents
FOR EACH ROW EXECUTE FUNCTION public.tvk_guard_header_business_line();

-- ---------------------------------------------------------------------
-- 10. v_batches_for_sales (§6.5): giữ nguyên guard active-profile của 0024,
--     thêm lọc phân quyền ngành hàng. Cột mới APPEND Ở CUỐI (bài học 42P16:
--     CREATE OR REPLACE VIEW khớp cột theo vị trí).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_batches_for_sales
WITH (security_invoker = false, security_barrier = true) AS
SELECT b.id AS batch_id,
       b.batch_code,
       b.product_id,
       p.sku,
       p.name AS product_name,
       b.ownership,
       s.name AS supplier_name,
       bl.location_id,
       l.name AS location_name,
       l.location_kind,
       l.partner_id,
       bl.qty,
       b.received_date,
       b.status,
       b.supplier_id,
       b.return_by_date,
       b.expiry_date,
       p.business_line_id,
       bln.code AS business_line_code
FROM public.stock_batches AS b
JOIN public.products AS p ON p.id = b.product_id
LEFT JOIN public.suppliers AS s ON s.id = b.supplier_id
JOIN public.batch_locations AS bl ON bl.batch_id = b.id
JOIN public.locations AS l ON l.id = bl.location_id
LEFT JOIN public.business_lines AS bln ON bln.id = p.business_line_id
WHERE EXISTS (
  SELECT 1
  FROM public.profiles AS actor
  WHERE actor.id = (SELECT auth.uid())
    AND actor.is_active = true
    AND actor.role IN ('OWNER', 'SALES', 'WAREHOUSE', 'ACCOUNTING', 'CEO')
)
AND public.user_can_access_business_line((SELECT auth.uid()), p.business_line_id);

REVOKE ALL ON public.v_batches_for_sales FROM PUBLIC, anon;
GRANT SELECT ON public.v_batches_for_sales TO authenticated;

-- ---------------------------------------------------------------------
-- 11. Kiểm chứng cuối migration (chỉ NOTICE/WARNING — không fail deploy
--     vì dữ liệu lạ; dữ liệu lạ thuộc về quy trình phân loại thủ công).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_payables  integer;
  v_receivables integer;
  v_payments  integer;
  v_movements integer;
BEGIN
  -- Migration này không INSERT/UPDATE/DELETE bảng tài chính hay sổ cái kho.
  -- Ghi lại số lượng hiện tại để đối chiếu sau deploy (bất biến tài chính P1).
  SELECT count(*) INTO v_payables FROM public.supplier_payables;
  SELECT count(*) INTO v_receivables FROM public.partner_receivables;
  SELECT count(*) INTO v_payments FROM public.payments;
  SELECT count(*) INTO v_movements FROM public.stock_movements;
  RAISE NOTICE 'P1 FINANCIAL INVARIANT (post-0025 counts, must equal pre-0025): supplier_payables=% partner_receivables=% payments=% stock_movements=%',
    v_payables, v_receivables, v_payments, v_movements;
  RAISE NOTICE 'P1 DONE: business_lines + user_business_lines + product classification + 7 header columns + guards + v_batches_for_sales (line-aware). sales_orders intentionally has NO business_line_id.';
END $$;

COMMIT;
