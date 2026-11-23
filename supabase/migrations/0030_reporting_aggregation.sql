-- =====================================================================
-- 0030_reporting_aggregation.sql — TVK V2.0 P5: Báo cáo + dashboard
-- tách theo ngành, tổng hợp ở database (E8, Prompt §17.5–§17.6).
--
-- VẤN ĐỀ (E8): getDashboard() / getGroupPerformance() /
-- getPerformanceSeries() / listLedgerMovements() gom số liệu ở app
-- bằng cách kéo hàng nghìn dòng về rồi cộng tay, với .limit() cố định
-- (2000/5000/10000/20000) — vượt giới hạn thì số liệu thiếu âm thầm,
-- không báo lỗi. Migration này dời phép tổng hợp xuống database:
--   - v_sales_doc_totals: doanh thu thuần + giá vốn từng chứng từ đã
--     xác nhận (định nghĩa chuẩn duy nhất §17.6: doanh thu thuần =
--     SUM(line_total) − giảm giá đầu chứng từ, chặn dưới 0; giá vốn
--     theo lô thực tế đã xuất, qua batch_id hoặc allocation_lines).
--   - v_sales_by_line: doanh thu / giá vốn / lãi / đơn / số lượng đã
--     bán theo từng ngành + 30 ngày gần nhất.
--   - v_daily_revenue_by_line: doanh thu + giá vốn theo ngày × ngành
--     (cho biểu đồ tầng 3).
--   - v_product_sales_30d: số lượng + doanh thu 30 ngày theo sản phẩm
--     (cho Top 5 bán chạy).
--   - v_group_performance_by_line: doanh thu + số lượng theo nhóm hàng
--     × ngành (thay getGroupPerformance() cộng tay).
--   - v_debt_by_line: dư nợ phải thu / phải trả theo ngành (kèm quá
--     hạn, chưa trả / một phần).
--   - v_inventory_value_by_line: giá trị tồn kho theo giá vốn lô, tách
--     kho TVK / kho đối tác / hàng ký gửi giữ hộ, theo ngành.
--   - v_partner_consignment_by_line: đối soát ký gửi theo đối tác ×
--     ngành (đã gửi / đã bán / đã trả / còn giữ / còn phải thu).
--   - v_consignment_flow_by_line: luồng gửi ký gửi theo ngành (đã gửi
--     theo phiếu GK đã xác nhận; đã bán / còn giữ từ đối soát).
--   - v_stock_movements_with_line: sổ cái kho + ngành của lô (quy
--     chiếu qua v_batches_for_sales, giữ nguyên guard phân quyền
--     ngành + hồ sơ đang hoạt động của view đó).
--
-- QUY TẮC:
--   - Mọi view đều security_invoker = true: RLS trên bảng gốc vẫn áp
--     dụng — vai trò nào không được đọc stock_batches (vd SALES) thì
--     view có giá vốn trả 0 dòng, không rò giá vốn/lãi qua báo cáo.
--   - Chứng từ hỗn hợp / chưa phân loại giữ business_line_id NULL và
--     hiện thành hàng "Chưa phân loại" — tổng các hàng theo ngành luôn
--     bằng số toàn doanh nghiệp (BL-020).
--   - Chỉ tạo view + GRANT — KHÔNG INSERT/UPDATE/DELETE dữ liệu nào,
--     KHÔNG sửa bảng, KHÔNG sửa trigger/RPC hiện có.
--   - Chạy SAU 0029. Chạy lại an toàn (CREATE OR REPLACE VIEW).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. v_sales_doc_totals — doanh thu thuần + giá vốn từng chứng từ đã
--    xác nhận. Đây là định nghĩa chuẩn duy nhất (§17.6) mà mọi KPI
--    doanh thu/lãi (dashboard, báo cáo, bàn điều hành) cùng dùng.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_sales_doc_totals
WITH (security_invoker = true) AS
SELECT d.id AS document_id,
       d.doc_code,
       d.doc_date,
       d.doc_kind,
       d.partner_id,
       COALESCE(d.customer_name, pt.name) AS customer_name,
       d.business_line_id,
       COALESCE(SUM(l.qty), 0)::bigint AS qty,
       COALESCE(SUM(l.line_total), 0)::numeric(15,2) AS gross,
       d.discount_amount,
       GREATEST(COALESCE(SUM(l.line_total), 0) - d.discount_amount, 0)::numeric(15,2) AS revenue_net,
       COALESCE(SUM(l.qty * COALESCE(b.unit_cost, 0)), 0)::numeric(15,2) AS cogs
FROM public.sales_documents d
LEFT JOIN public.partners pt ON pt.id = d.partner_id
LEFT JOIN public.sales_document_lines l ON l.document_id = d.id
LEFT JOIN public.allocation_lines al ON al.id = l.allocation_line_id
LEFT JOIN public.stock_batches b ON b.id = COALESCE(l.batch_id, al.batch_id)
WHERE d.status = 'CONFIRMED'
GROUP BY d.id, d.doc_code, d.doc_date, d.doc_kind, d.partner_id,
         d.customer_name, pt.name, d.business_line_id, d.discount_amount;
GRANT SELECT ON public.v_sales_doc_totals TO authenticated;

-- ---------------------------------------------------------------------
-- 2. v_sales_by_line — doanh thu / giá vốn / lãi / đơn theo ngành.
--    30 ngày = doc_date >= hôm nay − 29 ngày (khớp isoDay(29) ở app).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_sales_by_line
WITH (security_invoker = true) AS
SELECT business_line_id,
       COUNT(*)::bigint AS orders,
       COALESCE(SUM(qty), 0)::bigint AS qty,
       COALESCE(SUM(revenue_net), 0)::numeric(15,2) AS revenue,
       COALESCE(SUM(cogs), 0)::numeric(15,2) AS cogs,
       COALESCE(SUM(revenue_net - cogs), 0)::numeric(15,2) AS profit,
       COALESCE(SUM(CASE WHEN doc_kind = 'BH' THEN qty ELSE 0 END), 0)::bigint AS sold_qty,
       COALESCE(SUM(CASE WHEN doc_kind = 'BH' THEN revenue_net ELSE 0 END), 0)::numeric(15,2) AS sold_revenue,
       COALESCE(SUM(CASE WHEN doc_date >= CURRENT_DATE - 29 THEN revenue_net ELSE 0 END), 0)::numeric(15,2) AS revenue_30d,
       COALESCE(SUM(CASE WHEN doc_date >= CURRENT_DATE - 29 THEN cogs ELSE 0 END), 0)::numeric(15,2) AS cogs_30d,
       COALESCE(SUM(CASE WHEN doc_date >= CURRENT_DATE - 29 THEN revenue_net - cogs ELSE 0 END), 0)::numeric(15,2) AS profit_30d,
       COUNT(*) FILTER (WHERE doc_date >= CURRENT_DATE - 29)::bigint AS orders_30d
FROM public.v_sales_doc_totals
GROUP BY business_line_id;
GRANT SELECT ON public.v_sales_by_line TO authenticated;

-- ---------------------------------------------------------------------
-- 3. v_daily_revenue_by_line — doanh thu + giá vốn theo ngày × ngành.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_daily_revenue_by_line
WITH (security_invoker = true) AS
SELECT doc_date,
       business_line_id,
       COALESCE(SUM(revenue_net), 0)::numeric(15,2) AS revenue,
       COALESCE(SUM(cogs), 0)::numeric(15,2) AS cogs,
       COUNT(*)::bigint AS orders
FROM public.v_sales_doc_totals
GROUP BY doc_date, business_line_id;
GRANT SELECT ON public.v_daily_revenue_by_line TO authenticated;

-- ---------------------------------------------------------------------
-- 4. v_product_sales_30d — số lượng + doanh thu theo sản phẩm (30 ngày
--    và lũy kế). Không chạm stock_batches nên mọi vai trò đều đọc được.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_product_sales_30d
WITH (security_invoker = true) AS
SELECT p.id AS product_id,
       p.sku,
       p.name AS product_name,
       p.business_line_id,
       COALESCE(SUM(s.qty) FILTER (WHERE s.doc_date >= CURRENT_DATE - 29), 0)::bigint AS qty_30d,
       COALESCE(SUM(s.line_total) FILTER (WHERE s.doc_date >= CURRENT_DATE - 29), 0)::numeric(15,2) AS revenue_30d,
       COALESCE(SUM(s.qty), 0)::bigint AS qty_all,
       COALESCE(SUM(s.line_total), 0)::numeric(15,2) AS revenue_all
FROM public.products p
LEFT JOIN (
  SELECT l.product_id, l.qty, l.line_total, d.doc_date
  FROM public.sales_document_lines l
  JOIN public.sales_documents d ON d.id = l.document_id AND d.status = 'CONFIRMED'
) s ON s.product_id = p.id
GROUP BY p.id, p.sku, p.name, p.business_line_id;
GRANT SELECT ON public.v_product_sales_30d TO authenticated;

-- ---------------------------------------------------------------------
-- 5. v_group_performance_by_line — doanh thu + số lượng theo nhóm hàng
--    × ngành (doanh thu gộp theo dòng, như getGroupPerformance cũ).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_group_performance_by_line
WITH (security_invoker = true) AS
SELECT COALESCE(NULLIF(TRIM(p.product_group), ''), 'Chưa xếp nhóm') AS product_group,
       p.business_line_id,
       COALESCE(SUM(l.line_total), 0)::numeric(15,2) AS revenue,
       COALESCE(SUM(l.qty), 0)::bigint AS qty
FROM public.sales_document_lines l
JOIN public.sales_documents d ON d.id = l.document_id AND d.status = 'CONFIRMED'
JOIN public.products p ON p.id = l.product_id
GROUP BY COALESCE(NULLIF(TRIM(p.product_group), ''), 'Chưa xếp nhóm'), p.business_line_id;
GRANT SELECT ON public.v_group_performance_by_line TO authenticated;

-- ---------------------------------------------------------------------
-- 6. v_debt_by_line — dư nợ phải thu / phải trả theo ngành.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_debt_by_line
WITH (security_invoker = true) AS
SELECT 'RECEIVABLE'::text AS kind,
       business_line_id,
       COALESCE(SUM(amount - amount_paid), 0)::numeric(15,2) AS outstanding,
       COALESCE(SUM(amount - amount_paid) FILTER (WHERE status = 'UNPAID'), 0)::numeric(15,2) AS unpaid,
       COALESCE(SUM(amount - amount_paid) FILTER (WHERE status = 'PARTIAL'), 0)::numeric(15,2) AS partial,
       COALESCE(SUM(amount - amount_paid) FILTER (WHERE due_date < CURRENT_DATE), 0)::numeric(15,2) AS overdue,
       COUNT(*)::bigint AS cnt
FROM public.partner_receivables
WHERE status IN ('UNPAID', 'PARTIAL')
GROUP BY business_line_id
UNION ALL
SELECT 'PAYABLE'::text AS kind,
       business_line_id,
       COALESCE(SUM(amount - amount_paid), 0)::numeric(15,2) AS outstanding,
       COALESCE(SUM(amount - amount_paid) FILTER (WHERE status = 'UNPAID'), 0)::numeric(15,2) AS unpaid,
       COALESCE(SUM(amount - amount_paid) FILTER (WHERE status = 'PARTIAL'), 0)::numeric(15,2) AS partial,
       COALESCE(SUM(amount - amount_paid) FILTER (WHERE due_date < CURRENT_DATE), 0)::numeric(15,2) AS overdue,
       COUNT(*)::bigint AS cnt
FROM public.supplier_payables
WHERE status IN ('UNPAID', 'PARTIAL')
GROUP BY business_line_id;
GRANT SELECT ON public.v_debt_by_line TO authenticated;

-- ---------------------------------------------------------------------
-- 7. v_inventory_value_by_line — giá trị tồn kho theo giá vốn lô,
--    tách kho TVK / kho đối tác / hàng ký gửi giữ hộ, theo ngành
--    (ngành lấy từ sản phẩm của lô).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_inventory_value_by_line
WITH (security_invoker = true) AS
SELECT p.business_line_id,
       COALESCE(SUM(bl.qty) FILTER (WHERE b.ownership = 'OWNED' AND l.location_kind = 'OWN_WAREHOUSE'), 0)::bigint AS owned_qty_own_wh,
       COALESCE(SUM(bl.qty * b.unit_cost) FILTER (WHERE b.ownership = 'OWNED' AND l.location_kind = 'OWN_WAREHOUSE'), 0)::numeric(15,2) AS owned_cost_own_wh,
       COALESCE(SUM(bl.qty) FILTER (WHERE b.ownership = 'OWNED' AND l.location_kind = 'PARTNER_VIRTUAL'), 0)::bigint AS owned_qty_partners,
       COALESCE(SUM(bl.qty * b.unit_cost) FILTER (WHERE b.ownership = 'OWNED' AND l.location_kind = 'PARTNER_VIRTUAL'), 0)::numeric(15,2) AS owned_cost_partners,
       COALESCE(SUM(bl.qty * b.unit_cost) FILTER (WHERE b.ownership = 'OWNED'), 0)::numeric(15,2) AS owned_cost_total,
       COALESCE(SUM(bl.qty) FILTER (WHERE b.ownership = 'CONSIGNED'), 0)::bigint AS consigned_qty,
       COALESCE(SUM(bl.qty * b.unit_cost) FILTER (WHERE b.ownership = 'CONSIGNED'), 0)::numeric(15,2) AS consigned_cost,
       COUNT(DISTINCT b.id) FILTER (WHERE b.ownership = 'OWNED' AND bl.qty > 0)::bigint AS owned_lots,
       COUNT(DISTINCT b.id) FILTER (WHERE b.ownership = 'CONSIGNED' AND bl.qty > 0)::bigint AS consigned_lots
FROM public.batch_locations bl
JOIN public.stock_batches b ON b.id = bl.batch_id
JOIN public.products p ON p.id = b.product_id
JOIN public.locations l ON l.id = bl.location_id
GROUP BY p.business_line_id;
GRANT SELECT ON public.v_inventory_value_by_line TO authenticated;

-- ---------------------------------------------------------------------
-- 8. v_partner_consignment_by_line — đối soát ký gửi theo đối tác ×
--    ngành. Cùng định nghĩa với v_partner_consignment, chỉ thêm chiều
--    ngành (quy chiếu qua lô → sản phẩm; phải thu lấy theo ngành đã
--    gán ở P4). Mỗi nguồn gom trước trong CTE riêng rồi mới nối — nối
--    trực tiếp sẽ nhân số liệu chéo nhau (fan-out).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_partner_consignment_by_line
WITH (security_invoker = true) AS
WITH lines AS (
  SELECT DISTINCT business_line_id FROM public.products
),
sent AS (
  SELECT l.partner_id, p.business_line_id, SUM(m.qty)::bigint AS qty
  FROM public.stock_movements m
  JOIN public.locations l ON l.id = m.to_location_id
  JOIN public.stock_batches b ON b.id = m.batch_id
  JOIN public.products p ON p.id = b.product_id
  WHERE m.movement_kind = 'OUT_CONSIGNMENT'
  GROUP BY l.partner_id, p.business_line_id
),
consumed AS (
  SELECT l.partner_id, p.business_line_id, SUM(m.qty)::bigint AS qty
  FROM public.stock_movements m
  JOIN public.locations l ON l.id = m.from_location_id
  JOIN public.stock_batches b ON b.id = m.batch_id
  JOIN public.products p ON p.id = b.product_id
  WHERE m.movement_kind = 'OUT_SALE'
  GROUP BY l.partner_id, p.business_line_id
),
returned AS (
  SELECT lf.partner_id, p.business_line_id, SUM(m.qty)::bigint AS qty
  FROM public.stock_movements m
  JOIN public.locations lf ON lf.id = m.from_location_id
  JOIN public.locations lt ON lt.id = m.to_location_id AND lt.location_kind = 'OWN_WAREHOUSE'
  JOIN public.stock_batches b ON b.id = m.batch_id
  JOIN public.products p ON p.id = b.product_id
  WHERE m.movement_kind IN ('TRANSFER', 'IN_RETURN')
  GROUP BY lf.partner_id, p.business_line_id
),
still AS (
  SELECT l.partner_id, p.business_line_id, SUM(bl.qty)::bigint AS qty
  FROM public.batch_locations bl
  JOIN public.locations l ON l.id = bl.location_id
  JOIN public.stock_batches b ON b.id = bl.batch_id
  JOIN public.products p ON p.id = b.product_id
  WHERE l.partner_id IS NOT NULL
  GROUP BY l.partner_id, p.business_line_id
),
recv AS (
  SELECT partner_id, business_line_id,
         SUM(amount - amount_paid)::numeric(15,2) AS outstanding
  FROM public.partner_receivables
  WHERE status IN ('UNPAID', 'PARTIAL')
  GROUP BY partner_id, business_line_id
)
SELECT pt.id AS partner_id,
       bln.business_line_id,
       COALESCE(s.qty, 0)::bigint AS qty_sent,
       COALESCE(c.qty, 0)::bigint AS qty_consumed,
       COALESCE(r.qty, 0)::bigint AS qty_returned,
       COALESCE(st.qty, 0)::bigint AS qty_still_at_partner,
       COALESCE(rv.outstanding, 0)::numeric(15,2) AS receivable_outstanding
FROM public.partners pt
CROSS JOIN lines bln
LEFT JOIN sent s ON s.partner_id = pt.id AND s.business_line_id IS NOT DISTINCT FROM bln.business_line_id
LEFT JOIN consumed c ON c.partner_id = pt.id AND c.business_line_id IS NOT DISTINCT FROM bln.business_line_id
LEFT JOIN returned r ON r.partner_id = pt.id AND r.business_line_id IS NOT DISTINCT FROM bln.business_line_id
LEFT JOIN still st ON st.partner_id = pt.id AND st.business_line_id IS NOT DISTINCT FROM bln.business_line_id
LEFT JOIN recv rv ON rv.partner_id = pt.id AND rv.business_line_id IS NOT DISTINCT FROM bln.business_line_id
WHERE COALESCE(s.qty, 0) <> 0
   OR COALESCE(c.qty, 0) <> 0
   OR COALESCE(r.qty, 0) <> 0
   OR COALESCE(st.qty, 0) <> 0
   OR COALESCE(rv.outstanding, 0) <> 0;
GRANT SELECT ON public.v_partner_consignment_by_line TO authenticated;

-- ---------------------------------------------------------------------
-- 9. v_consignment_flow_by_line — luồng gửi ký gửi theo ngành: đã gửi
--    (phiếu GK đã xác nhận), đã bán / còn giữ (từ đối soát theo ngành).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_consignment_flow_by_line
WITH (security_invoker = true) AS
SELECT s.business_line_id,
       COALESCE(SUM(i.qty), 0)::bigint AS sent_qty,
       COALESCE(SUM(i.qty * i.transfer_price), 0)::numeric(15,2) AS sent_value
FROM public.consignment_out_slips s
LEFT JOIN public.consignment_out_items i ON i.slip_id = s.id
WHERE s.status = 'CONFIRMED'
GROUP BY s.business_line_id;
GRANT SELECT ON public.v_consignment_flow_by_line TO authenticated;

-- ---------------------------------------------------------------------
-- 10. v_stock_movements_with_line — sổ cái kho + ngành của lô (quy
--     chiếu qua v_batches_for_sales: giữ nguyên guard hồ sơ đang hoạt
--     động + phân quyền ngành của view đó; lô không tra được thì ngành
--     NULL — app lọc theo ngành sẽ bỏ dòng đó, như hành vi P2).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_stock_movements_with_line
WITH (security_invoker = true) AS
SELECT m.id,
       m.batch_id,
       m.movement_kind,
       m.qty,
       m.from_location_id,
       m.to_location_id,
       m.ref_doc_type,
       m.ref_doc_id,
       m.reversal_of_id,
       m.note,
       m.created_by,
       m.created_at,
       (SELECT v.business_line_id FROM public.v_batches_for_sales v WHERE v.batch_id = m.batch_id LIMIT 1) AS business_line_id
FROM public.stock_movements m;
GRANT SELECT ON public.v_stock_movements_with_line TO authenticated;

-- ---------------------------------------------------------------------
-- 11. Kiểm chứng cuối migration (cấu trúc — fail nếu view thiếu;
--     số liệu chỉ NOTICE, dữ liệu lạ thuộc về quy trình phân loại).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(v) INTO v_missing FROM (VALUES
    ('v_sales_doc_totals'), ('v_sales_by_line'), ('v_daily_revenue_by_line'),
    ('v_product_sales_30d'), ('v_group_performance_by_line'), ('v_debt_by_line'),
    ('v_inventory_value_by_line'), ('v_partner_consignment_by_line'),
    ('v_consignment_flow_by_line'), ('v_stock_movements_with_line')
  ) AS t(v)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = t.v
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 0030: thiếu view báo cáo: %', array_to_string(v_missing, ', ');
  END IF;
  RAISE NOTICE 'P5 DONE: 10 view tổng hợp theo ngành đã tạo (0030). v_sales_by_line rows=%, v_debt_by_line rows=%, v_inventory_value_by_line rows=%',
    (SELECT count(*) FROM public.v_sales_by_line),
    (SELECT count(*) FROM public.v_debt_by_line),
    (SELECT count(*) FROM public.v_inventory_value_by_line);
END $$;

COMMIT;
