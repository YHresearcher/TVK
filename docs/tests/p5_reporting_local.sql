-- =====================================================================
-- p5_reporting_local.sql — Kiểm chứng migration 0030 (P5) trên database
-- local (KHÔNG phải live).
--
-- CHẠY (thứ tự bắt buộc):
--   1. Database local trống -> p2_setup_local.sql
--   2. Áp 0001–0024, p1_seed, 0025, p2_seed, 0026, p3_seed, 0027,
--      p4_seed, 0028, 0029, p5_seed, 0030
--   3. psql -v ON_ERROR_STOP=1 -f docs/tests/p5_reporting_local.sql
-- Mọi assertion fail đều RAISE EXCEPTION (psql dừng ngay nhờ ON_ERROR_STOP).
-- Chạy bằng role postgres (superuser) — các khối mô phỏng role dùng
-- SET LOCAL ROLE authenticated + JWT giả (mẫu p0/p2/p3).
--
-- Quy ước UUID (p1/p2/p3/p4/p5 seed):
--   OWNER 158a181e-f50e-43ef-92b2-4841bdf468aa | SALES-oil 22222222-...-2222
--   test-chidau 88888888-...-8888 (được gán OIL trong file này)
--   Đối tác Á Âu bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2
--   BH-P5-0001 6666...0201 (AUTO, a1 x2 @150.000, lô vốn 100.000)
--   BH-P5-0002 6666...0202 (OIL, a3 x4 @50.000, lô vốn 50.000)
--   GK-P5-0001 6666...0401 (AUTO, a1 x3 @150.000)
--   M1 6666...0501 IN_PURCHASE a1 +5 | M2 6666...0502 OUT_SALE a3 −2 |
--   M3 6666...0503 OUT_CONSIGNMENT a1 3
-- =====================================================================

-- Bảng tạm giữ baseline (các khối mô phỏng role cũng cần đọc).
CREATE TEMP TABLE IF NOT EXISTS p5_base (key text PRIMARY KEY, val numeric);
GRANT ALL ON TABLE p5_base TO authenticated;

-- Baseline tài chính đầu file (0030 chỉ tạo view — số liệu gốc phải
-- giữ nguyên tới cuối file).
INSERT INTO p5_base (key, val) VALUES
  ('payables', (SELECT count(*) FROM public.supplier_payables)),
  ('receivables', (SELECT count(*) FROM public.partner_receivables)),
  ('payments', (SELECT count(*) FROM public.payments)),
  ('movements', (SELECT count(*) FROM public.stock_movements)),
  ('confirmed_docs', (SELECT count(*) FROM public.sales_documents WHERE status = 'CONFIRMED')),
  ('rec_open', (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.partner_receivables)),
  ('pay_open', (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.supplier_payables))
ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;

-- ---------------------------------------------------------------------
-- R5-01. Cấu trúc: đủ 10 view, security_invoker=true, SELECT cho
--         authenticated.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_missing text[];
  v_bad_invoker text[];
  v_no_grant text[];
BEGIN
  SELECT array_agg(v) INTO v_missing FROM (VALUES
    ('v_sales_doc_totals'), ('v_sales_by_line'), ('v_daily_revenue_by_line'),
    ('v_product_sales_30d'), ('v_group_performance_by_line'), ('v_debt_by_line'),
    ('v_inventory_value_by_line'), ('v_partner_consignment_by_line'),
    ('v_consignment_flow_by_line'), ('v_stock_movements_with_line')
  ) AS t(v)
  WHERE NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = t.v);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL R5-01a: thiếu view báo cáo: %', array_to_string(v_missing, ', ');
  END IF;
  SELECT array_agg(c.relname::text) INTO v_bad_invoker
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN (
    'v_sales_doc_totals', 'v_sales_by_line', 'v_daily_revenue_by_line',
    'v_product_sales_30d', 'v_group_performance_by_line', 'v_debt_by_line',
    'v_inventory_value_by_line', 'v_partner_consignment_by_line',
    'v_consignment_flow_by_line', 'v_stock_movements_with_line')
    AND NOT (c.reloptions @> ARRAY['security_invoker=true']);
  IF v_bad_invoker IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL R5-01b: view không có security_invoker=true: %', array_to_string(v_bad_invoker, ', ');
  END IF;
  SELECT array_agg(v) INTO v_no_grant FROM (VALUES
    ('v_sales_doc_totals'), ('v_sales_by_line'), ('v_daily_revenue_by_line'),
    ('v_product_sales_30d'), ('v_group_performance_by_line'), ('v_debt_by_line'),
    ('v_inventory_value_by_line'), ('v_partner_consignment_by_line'),
    ('v_consignment_flow_by_line'), ('v_stock_movements_with_line')
  ) AS t(v)
  WHERE NOT has_table_privilege('authenticated', 'public.' || t.v, 'SELECT');
  IF v_no_grant IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL R5-01c: authenticated không SELECT được view: %', array_to_string(v_no_grant, ', ');
  END IF;
  RAISE NOTICE 'PASS R5-01: đủ 10 view, security_invoker=true, SELECT cho authenticated';
END $$;

-- ---------------------------------------------------------------------
-- R5-02. v_sales_doc_totals: doanh thu thuần + giá vốn từng chứng từ.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT revenue_net, cogs INTO r FROM public.v_sales_doc_totals WHERE doc_code = 'BH-P5-0001';
  IF r.revenue_net <> 300000 OR r.cogs <> 200000 THEN
    RAISE EXCEPTION 'FAIL R5-02a: BH-P5-0001 revenue/cogs=%/% (expect 300000/200000)', r.revenue_net, r.cogs;
  END IF;
  SELECT revenue_net, cogs INTO r FROM public.v_sales_doc_totals WHERE doc_code = 'BH-P5-0002';
  IF r.revenue_net <> 200000 OR r.cogs <> 200000 THEN
    RAISE EXCEPTION 'FAIL R5-02b: BH-P5-0002 revenue/cogs=%/% (expect 200000/200000)', r.revenue_net, r.cogs;
  END IF;
  SELECT revenue_net, cogs INTO r FROM public.v_sales_doc_totals WHERE doc_code = 'BH-VAT-0001';
  IF r.revenue_net <> 450000 OR r.cogs <> 0 THEN
    RAISE EXCEPTION 'FAIL R5-02c: BH-VAT-0001 revenue/cogs=%/% (expect 450000/0)', r.revenue_net, r.cogs;
  END IF;
  -- Chứng từ DRAFT không được tính.
  IF EXISTS (SELECT 1 FROM public.v_sales_doc_totals WHERE doc_code IN ('BH-VAT-0003', 'BH-SEED-0003')) THEN
    RAISE EXCEPTION 'FAIL R5-02d: chứng từ DRAFT lọt vào v_sales_doc_totals';
  END IF;
  RAISE NOTICE 'PASS R5-02: v_sales_doc_totals đúng từng chứng từ (P5 có giá vốn theo lô thật)';
END $$;

-- ---------------------------------------------------------------------
-- R5-03. v_sales_by_line: số theo ngành (giá trị đã đối chiếu tay).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_oil uuid; v_parts uuid;
  r record;
BEGIN
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  SELECT * INTO r FROM public.v_sales_by_line WHERE business_line_id = v_parts;
  IF r.orders <> 4 OR r.qty <> 7 OR r.revenue <> 1100000 OR r.cogs <> 200000 OR r.profit <> 900000
     OR r.sold_qty <> 6 OR r.sold_revenue <> 950000
     OR r.revenue_30d <> 300000 OR r.cogs_30d <> 200000 OR r.orders_30d <> 1 THEN
    RAISE EXCEPTION 'FAIL R5-03a: AUTO revenue=% cogs=% profit=% orders=% sold=% revenue_30d=% (expect 1100000/200000/900000/4/950000/300000)', r.revenue, r.cogs, r.profit, r.orders, r.sold_revenue, r.revenue_30d;
  END IF;
  SELECT * INTO r FROM public.v_sales_by_line WHERE business_line_id = v_oil;
  IF r.orders <> 4 OR r.qty <> 11 OR r.revenue <> 550000 OR r.cogs <> 200000 OR r.profit <> 350000
     OR r.sold_qty <> 11 OR r.sold_revenue <> 550000
     OR r.revenue_30d <> 200000 OR r.cogs_30d <> 200000 OR r.orders_30d <> 1 THEN
    RAISE EXCEPTION 'FAIL R5-03b: OIL revenue=% cogs=% profit=% orders=% (expect 550000/200000/350000/4)', r.revenue, r.cogs, r.profit, r.orders;
  END IF;
  SELECT * INTO r FROM public.v_sales_by_line WHERE business_line_id IS NULL;
  IF r.orders <> 1 OR r.revenue <> 100000 OR r.cogs <> 0 OR r.revenue_30d <> 0 THEN
    RAISE EXCEPTION 'FAIL R5-03c: NULL-line revenue=% orders=% revenue_30d=% (expect 100000/1/0)', r.revenue, r.orders, r.revenue_30d;
  END IF;
  IF (SELECT count(*) FROM public.v_sales_by_line) <> 3 THEN
    RAISE EXCEPTION 'FAIL R5-03d: v_sales_by_line phải có đúng 3 hàng (OIL/AUTO/NULL)';
  END IF;
  RAISE NOTICE 'PASS R5-03: v_sales_by_line đúng từng ngành (AUTO 1.100.000 / OIL 550.000 / chưa phân loại 100.000)';
END $$;

-- ---------------------------------------------------------------------
-- R5-04 (BL-020). Tổng các hàng theo ngành = số toàn doanh nghiệp,
--         đối chiếu độc lập với truy vấn trực tiếp (không qua view).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_rev numeric; v_cogs numeric; v_orders bigint; v_qty bigint;
  d_rev numeric; d_cogs numeric; d_orders bigint; d_qty bigint;
BEGIN
  SELECT coalesce(sum(revenue), 0), coalesce(sum(cogs), 0),
         coalesce(sum(orders), 0), coalesce(sum(qty), 0)
    INTO v_rev, v_cogs, v_orders, v_qty FROM public.v_sales_by_line;
  WITH doc AS (
    SELECT d.id, d.discount_amount,
           COALESCE(SUM(l.line_total), 0) AS gross,
           COALESCE(SUM(l.qty * COALESCE(b.unit_cost, 0)), 0) AS cogs,
           COALESCE(SUM(l.qty), 0) AS qty
    FROM public.sales_documents d
    LEFT JOIN public.sales_document_lines l ON l.document_id = d.id
    LEFT JOIN public.allocation_lines al ON al.id = l.allocation_line_id
    LEFT JOIN public.stock_batches b ON b.id = COALESCE(l.batch_id, al.batch_id)
    WHERE d.status = 'CONFIRMED'
    GROUP BY d.id, d.discount_amount
  )
  SELECT coalesce(sum(GREATEST(gross - discount_amount, 0)), 0),
         coalesce(sum(cogs), 0), count(*), coalesce(sum(qty), 0)
    INTO d_rev, d_cogs, d_orders, d_qty FROM doc;
  IF v_rev <> d_rev OR v_cogs <> d_cogs OR v_orders <> d_orders OR v_qty <> d_qty THEN
    RAISE EXCEPTION 'FAIL R5-04: view (rev=% cogs=% orders=% qty=%) <> trực tiếp (rev=% cogs=% orders=% qty=%)',
      v_rev, v_cogs, v_orders, v_qty, d_rev, d_cogs, d_orders, d_qty;
  END IF;
  IF v_rev <> 1750000 OR v_cogs <> 400000 OR v_orders <> 9 THEN
    RAISE EXCEPTION 'FAIL R5-04b: tổng hợp rev=% cogs=% orders=% (expect 1750000/400000/9)', v_rev, v_cogs, v_orders;
  END IF;
  RAISE NOTICE 'PASS R5-04 (BL-020): tổng theo ngành = toàn doanh nghiệp (doanh thu 1.750.000, giá vốn 400.000, 9 đơn)';
END $$;

-- ---------------------------------------------------------------------
-- R5-05. v_debt_by_line: dư nợ theo ngành + quá hạn.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_oil uuid; v_parts uuid;
  v_rec numeric; v_pay numeric;
  d_rec numeric; d_pay numeric;
  r record;
BEGIN
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  SELECT * INTO r FROM public.v_debt_by_line WHERE kind = 'RECEIVABLE' AND business_line_id = v_parts;
  IF r.outstanding <> 1050000 OR r.unpaid <> 850000 OR r.partial <> 200000 OR r.overdue <> 0 OR r.cnt <> 4 THEN
    RAISE EXCEPTION 'FAIL R5-05a: phải thu AUTO outstanding=% unpaid=% partial=% (expect 1050000/850000/200000)', r.outstanding, r.unpaid, r.partial;
  END IF;
  SELECT * INTO r FROM public.v_debt_by_line WHERE kind = 'RECEIVABLE' AND business_line_id = v_oil;
  IF r.outstanding <> 550000 OR r.overdue <> 200000 OR r.cnt <> 4 THEN
    RAISE EXCEPTION 'FAIL R5-05b: phải thu OIL outstanding=% overdue=% (expect 550000/200000)', r.outstanding, r.overdue;
  END IF;
  SELECT * INTO r FROM public.v_debt_by_line WHERE kind = 'RECEIVABLE' AND business_line_id IS NULL;
  IF r.outstanding <> 300000 OR r.cnt <> 2 THEN
    RAISE EXCEPTION 'FAIL R5-05c: phải thu NULL outstanding=% (expect 300000)', r.outstanding;
  END IF;
  SELECT * INTO r FROM public.v_debt_by_line WHERE kind = 'PAYABLE' AND business_line_id = v_parts;
  IF r.outstanding <> 2300000 OR r.cnt <> 2 THEN
    RAISE EXCEPTION 'FAIL R5-05d: phải trả AUTO outstanding=% (expect 2300000)', r.outstanding;
  END IF;
  SELECT * INTO r FROM public.v_debt_by_line WHERE kind = 'PAYABLE' AND business_line_id IS NULL;
  IF r.outstanding <> 350000 OR r.cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL R5-05e: phải trả NULL outstanding=% (expect 350000)', r.outstanding;
  END IF;
  SELECT coalesce(sum(outstanding), 0) INTO v_rec FROM public.v_debt_by_line WHERE kind = 'RECEIVABLE';
  SELECT coalesce(sum(outstanding), 0) INTO v_pay FROM public.v_debt_by_line WHERE kind = 'PAYABLE';
  SELECT coalesce(sum(amount - amount_paid), 0) INTO d_rec FROM public.partner_receivables WHERE status IN ('UNPAID', 'PARTIAL');
  SELECT coalesce(sum(amount - amount_paid), 0) INTO d_pay FROM public.supplier_payables WHERE status IN ('UNPAID', 'PARTIAL');
  IF v_rec <> d_rec OR v_rec <> 1900000 OR v_pay <> d_pay OR v_pay <> 2650000 THEN
    RAISE EXCEPTION 'FAIL R5-05f: tổng dư nợ view (thu=% trả=%) <> trực tiếp (thu=% trả=%)', v_rec, v_pay, d_rec, d_pay;
  END IF;
  RAISE NOTICE 'PASS R5-05: v_debt_by_line đúng từng ngành (thu 1.900.000 / trả 2.650.000, quá hạn OIL 200.000)';
END $$;

-- ---------------------------------------------------------------------
-- R5-06. v_inventory_value_by_line: giá trị tồn kho theo giá vốn lô.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_oil uuid; v_parts uuid;
  r record;
  d_auto numeric; d_oil numeric;
BEGIN
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  SELECT * INTO r FROM public.v_inventory_value_by_line WHERE business_line_id = v_parts;
  IF r.owned_qty_own_wh <> 102 OR r.owned_cost_own_wh <> 10200000
     OR r.owned_qty_partners <> 3 OR r.owned_cost_partners <> 300000
     OR r.owned_cost_total <> 10500000 OR r.owned_lots <> 1 OR r.consigned_qty <> 0 THEN
    RAISE EXCEPTION 'FAIL R5-06a: tồn AUTO kho=% (%đ) đối tác=% (%đ) (expect 102/10200000, 3/300000)',
      r.owned_qty_own_wh, r.owned_cost_own_wh, r.owned_qty_partners, r.owned_cost_partners;
  END IF;
  SELECT * INTO r FROM public.v_inventory_value_by_line WHERE business_line_id = v_oil;
  IF r.owned_qty_own_wh <> 48 OR r.owned_cost_own_wh <> 2400000 OR r.owned_cost_total <> 2400000 THEN
    RAISE EXCEPTION 'FAIL R5-06b: tồn OIL kho=% (%đ) (expect 48/2400000)', r.owned_qty_own_wh, r.owned_cost_own_wh;
  END IF;
  SELECT coalesce(sum(bl.qty * b.unit_cost) FILTER (WHERE p.business_line_id = v_parts), 0) INTO d_auto
  FROM public.batch_locations bl
  JOIN public.stock_batches b ON b.id = bl.batch_id AND b.ownership = 'OWNED'
  JOIN public.products p ON p.id = b.product_id;
  SELECT coalesce(sum(bl.qty * b.unit_cost) FILTER (WHERE p.business_line_id = v_oil), 0) INTO d_oil
  FROM public.batch_locations bl
  JOIN public.stock_batches b ON b.id = bl.batch_id AND b.ownership = 'OWNED'
  JOIN public.products p ON p.id = b.product_id;
  IF d_auto <> 10500000 OR d_oil <> 2400000 THEN
    RAISE EXCEPTION 'FAIL R5-06c: đối chiếu trực tiếp tồn AUTO=% OIL=% (expect 10500000/2400000)', d_auto, d_oil;
  END IF;
  RAISE NOTICE 'PASS R5-06: v_inventory_value_by_line đúng (AUTO 10.500.000 / OIL 2.400.000 theo giá vốn)';
END $$;

-- ---------------------------------------------------------------------
-- R5-07. v_group_performance_by_line: doanh thu theo nhóm hàng × ngành.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_rev numeric; d_rev numeric;
BEGIN
  IF (SELECT revenue FROM public.v_group_performance_by_line
       WHERE product_group = 'Linh kiện ô tô tải'
         AND business_line_id = (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')) <> 1150000
     OR (SELECT qty FROM public.v_group_performance_by_line
       WHERE product_group = 'Linh kiện ô tô tải'
         AND business_line_id = (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')) <> 7 THEN
    RAISE EXCEPTION 'FAIL R5-07a: nhóm Linh kiện/AUTO sai';
  END IF;
  IF (SELECT revenue FROM public.v_group_performance_by_line
       WHERE product_group = 'Linh kiện ô tô tải' AND business_line_id IS NULL) <> 100000 THEN
    RAISE EXCEPTION 'FAIL R5-07b: nhóm Linh kiện/chưa phân loại sai (expect 100000)';
  END IF;
  IF (SELECT revenue FROM public.v_group_performance_by_line
       WHERE product_group = 'Nhớt'
         AND business_line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL')) <> 550000 THEN
    RAISE EXCEPTION 'FAIL R5-07c: nhóm Nhớt/OIL sai (expect 550000)';
  END IF;
  SELECT coalesce(sum(revenue), 0) INTO v_rev FROM public.v_group_performance_by_line;
  SELECT coalesce(sum(l.line_total), 0) INTO d_rev
  FROM public.sales_document_lines l
  JOIN public.sales_documents d ON d.id = l.document_id AND d.status = 'CONFIRMED';
  -- Doanh thu nhóm = GỘP (trước chiết khấu) theo §17: tổng gộp 1.800.000,
  -- hơn tổng thuần 1.750.000 đúng 50.000 = chiết khấu của BH-VAT-0001.
  IF v_rev <> d_rev OR v_rev <> 1800000 THEN
    RAISE EXCEPTION 'FAIL R5-07d: tổng nhóm gộp view=% <> trực tiếp=% (expect 1800000)', v_rev, d_rev;
  END IF;
  IF v_rev - (SELECT coalesce(sum(revenue), 0) FROM public.v_sales_by_line) <> 50000 THEN
    RAISE EXCEPTION 'FAIL R5-07e: doanh thu gộp − thuần phải bằng tổng chiết khấu 50000';
  END IF;
  RAISE NOTICE 'PASS R5-07: v_group_performance_by_line đúng (gộp 1.800.000 = thuần 1.750.000 + chiết khấu 50.000)';
END $$;

-- ---------------------------------------------------------------------
-- R5-08. v_daily_revenue_by_line: cộng theo ngày = tổng theo ngành.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_rev numeric; v_cogs numeric;
BEGIN
  IF (SELECT revenue FROM public.v_daily_revenue_by_line
       WHERE doc_date = '2026-09-07'
         AND business_line_id = (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')) <> 800000 THEN
    RAISE EXCEPTION 'FAIL R5-08a: doanh thu ngày 07/09 AUTO sai (expect 800000)';
  END IF;
  IF (SELECT revenue FROM public.v_daily_revenue_by_line
       WHERE doc_date = '2026-09-07'
         AND business_line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL')) <> 350000 THEN
    RAISE EXCEPTION 'FAIL R5-08b: doanh thu ngày 07/09 OIL sai (expect 350000)';
  END IF;
  SELECT coalesce(sum(revenue), 0), coalesce(sum(cogs), 0) INTO v_rev, v_cogs FROM public.v_daily_revenue_by_line;
  IF v_rev <> (SELECT coalesce(sum(revenue), 0) FROM public.v_sales_by_line)
     OR v_cogs <> (SELECT coalesce(sum(cogs), 0) FROM public.v_sales_by_line) THEN
    RAISE EXCEPTION 'FAIL R5-08c: tổng theo ngày (%/%) <> tổng theo ngành', v_rev, v_cogs;
  END IF;
  RAISE NOTICE 'PASS R5-08: v_daily_revenue_by_line khớp tổng theo ngành';
END $$;

-- ---------------------------------------------------------------------
-- R5-09. v_product_sales_30d: Top sản phẩm + hồi quy lỗi LEFT JOIN
--         (dòng DRAFT không được tính vào lũy kế).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.v_product_sales_30d WHERE sku = 'VG1540080110';
  IF r.qty_30d <> 2 OR r.revenue_30d <> 300000 OR r.qty_all <> 5 OR r.revenue_all <> 750000 THEN
    RAISE EXCEPTION 'FAIL R5-09a: a1 30d=%/% all=%/% (expect 2/300000, 5/750000)', r.qty_30d, r.revenue_30d, r.qty_all, r.revenue_all;
  END IF;
  SELECT * INTO r FROM public.v_product_sales_30d WHERE sku = 'OIL-10W40';
  IF r.qty_30d <> 4 OR r.revenue_30d <> 200000 OR r.qty_all <> 11 OR r.revenue_all <> 550000 THEN
    RAISE EXCEPTION 'FAIL R5-09b: a3 30d=%/% all=%/% (expect 4/200000, 11/550000)', r.qty_30d, r.revenue_30d, r.qty_all, r.revenue_all;
  END IF;
  SELECT * INTO r FROM public.v_product_sales_30d WHERE sku = 'WG9725190102';
  IF r.qty_30d <> 0 OR r.qty_all <> 2 OR r.revenue_all <> 400000 THEN
    RAISE EXCEPTION 'FAIL R5-09c: a2 all=%/% (expect 2/400000)', r.qty_all, r.revenue_all;
  END IF;
  RAISE NOTICE 'PASS R5-09: v_product_sales_30d đúng, dòng DRAFT không lọt vào lũy kế';
END $$;

-- ---------------------------------------------------------------------
-- R5-10. v_partner_consignment_by_line: cộng theo ngành = đối soát
--         hợp nhất v_partner_consignment.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v record;
BEGIN
  SELECT * INTO r FROM public.v_partner_consignment_by_line
  WHERE partner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
    AND business_line_id = (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS');
  IF r.qty_sent <> 3 OR r.qty_still_at_partner <> 3 OR r.receivable_outstanding <> 1050000 THEN
    RAISE EXCEPTION 'FAIL R5-10a: đối soát Á Âu/AUTO gửi=% còn=% phải thu=% (expect 3/3/1050000)', r.qty_sent, r.qty_still_at_partner, r.receivable_outstanding;
  END IF;
  SELECT * INTO r FROM public.v_partner_consignment_by_line
  WHERE partner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
    AND business_line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL');
  IF r.receivable_outstanding <> 550000 OR r.qty_sent <> 0 THEN
    RAISE EXCEPTION 'FAIL R5-10b: đối soát Á Âu/OIL phải thu=% (expect 550000)', r.receivable_outstanding;
  END IF;
  SELECT qty_sent, qty_consumed, qty_returned, qty_still_at_partner, receivable_outstanding
    INTO v FROM public.v_partner_consignment
   WHERE partner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  IF (SELECT coalesce(sum(qty_sent), 0) FROM public.v_partner_consignment_by_line WHERE partner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2') <> v.qty_sent
     OR (SELECT coalesce(sum(qty_still_at_partner), 0) FROM public.v_partner_consignment_by_line WHERE partner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2') <> v.qty_still_at_partner
     OR (SELECT coalesce(sum(receivable_outstanding), 0) FROM public.v_partner_consignment_by_line WHERE partner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2') <> v.receivable_outstanding THEN
    RAISE EXCEPTION 'FAIL R5-10c: tổng theo ngành <> đối soát hợp nhất (gửi=% còn=% phải thu=%)', v.qty_sent, v.qty_still_at_partner, v.receivable_outstanding;
  END IF;
  RAISE NOTICE 'PASS R5-10: v_partner_consignment_by_line khớp đối soát hợp nhất';
END $$;

-- ---------------------------------------------------------------------
-- R5-11. v_consignment_flow_by_line: đã gửi theo phiếu GK đã xác nhận.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
  d_qty bigint; d_val numeric;
BEGIN
  SELECT * INTO r FROM public.v_consignment_flow_by_line
   WHERE business_line_id = (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS');
  IF r.sent_qty <> 3 OR r.sent_value <> 450000 THEN
    RAISE EXCEPTION 'FAIL R5-11a: luồng gửi AUTO %/% (expect 3/450000)', r.sent_qty, r.sent_value;
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_consignment_flow_by_line
              WHERE business_line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL')) THEN
    RAISE EXCEPTION 'FAIL R5-11b: không có phiếu GK dầu đã xác nhận, view không được có hàng OIL';
  END IF;
  SELECT coalesce(sum(i.qty), 0), coalesce(sum(i.qty * i.transfer_price), 0) INTO d_qty, d_val
  FROM public.consignment_out_slips s
  JOIN public.consignment_out_items i ON i.slip_id = s.id
  WHERE s.status = 'CONFIRMED';
  IF (SELECT coalesce(sum(sent_qty), 0) FROM public.v_consignment_flow_by_line) <> d_qty
     OR (SELECT coalesce(sum(sent_value), 0) FROM public.v_consignment_flow_by_line) <> d_val THEN
    RAISE EXCEPTION 'FAIL R5-11c: tổng luồng gửi view <> trực tiếp từ phiếu GK';
  END IF;
  RAISE NOTICE 'PASS R5-11: v_consignment_flow_by_line đúng (AUTO đã gửi 3 / 450.000)';
END $$;

-- ---------------------------------------------------------------------
-- R5-12. v_stock_movements_with_line: quy chiếu ngành của lô, theo
--         từng vai trò (mô phỏng JWT như mẫu p0/p2/p3).
-- ---------------------------------------------------------------------
-- Gán OIL cho test-chidau (88888888) để thử fail-closed theo ngành.
INSERT INTO public.user_business_lines (user_id, business_line_id)
SELECT '88888888-8888-8888-8888-888888888888', id FROM public.business_lines WHERE code = 'OIL'
ON CONFLICT (user_id, business_line_id) DO NOTHING;

-- OWNER: đủ 3 bút toán, ngành đúng từng lô.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_auto integer; v_oil integer; v_null integer;
BEGIN
  SELECT count(*) FILTER (WHERE business_line_id = (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS')),
         count(*) FILTER (WHERE business_line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL')),
         count(*) FILTER (WHERE business_line_id IS NULL)
    INTO v_auto, v_oil, v_null FROM public.v_stock_movements_with_line;
  IF v_auto <> 2 OR v_oil <> 1 OR v_null <> 0 THEN
    RAISE EXCEPTION 'FAIL R5-12a: OWNER thấy AUTO=% OIL=% NULL=% (expect 2/1/0)', v_auto, v_oil, v_null;
  END IF;
  IF (SELECT movement_kind FROM public.v_stock_movements_with_line
       WHERE business_line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL')) <> 'OUT_SALE' THEN
    RAISE EXCEPTION 'FAIL R5-12b: bút toán OIL phải là OUT_SALE (lô a3)';
  END IF;
  RAISE NOTICE 'PASS R5-12a: OWNER thấy đủ 3 bút toán, ngành đúng (AUTO 2 / OIL 1)';
END $$;
COMMIT;

-- test-chidau (chỉ OIL): chỉ bút toán OIL quy chiếu được, còn lại NULL.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
DO $$
DECLARE
  v_oil integer; v_null integer;
BEGIN
  SELECT count(*) FILTER (WHERE business_line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL')),
         count(*) FILTER (WHERE business_line_id IS NULL)
    INTO v_oil, v_null FROM public.v_stock_movements_with_line;
  IF v_oil <> 1 OR v_null <> 2 THEN
    RAISE EXCEPTION 'FAIL R5-12c: user chỉ-OIL thấy OIL=% NULL=% (expect 1/2)', v_oil, v_null;
  END IF;
  RAISE NOTICE 'PASS R5-12b: user chỉ-OIL chỉ quy chiếu được bút toán OIL';
END $$;
COMMIT;

-- Ghost (authenticated, không có profile): thấy dòng nhưng không quy
-- chiếu được ngành nào (giống hành vi P2 của v_batches_for_sales).
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000000', true);
DO $$
DECLARE
  v_total integer; v_null integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE business_line_id IS NULL)
    INTO v_total, v_null FROM public.v_stock_movements_with_line;
  IF v_total <> 3 OR v_null <> 3 THEN
    RAISE EXCEPTION 'FAIL R5-12d: ghost thấy total=% NULL=% (expect 3/3)', v_total, v_null;
  END IF;
  RAISE NOTICE 'PASS R5-12c: ghost thấy dòng sổ cái nhưng không quy chiếu ngành';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- R5-13. Rào chắn vai trò trên view tiền (BL-001 mở rộng): SALES
--         không rò giá vốn qua view; không thấy phải trả.
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
DO $$
DECLARE
  v_cogs numeric; v_pay_rows integer; v_inv_rows integer;
BEGIN
  SELECT coalesce(sum(cogs), 0) INTO v_cogs FROM public.v_sales_by_line;
  IF v_cogs <> 0 THEN
    RAISE EXCEPTION 'FAIL R5-13a: SALES đọc được giá vốn qua view (cogs=%)', v_cogs;
  END IF;
  SELECT count(*) INTO v_pay_rows FROM public.v_debt_by_line WHERE kind = 'PAYABLE';
  IF v_pay_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL R5-13b: SALES đọc được phải trả qua view (% hàng)', v_pay_rows;
  END IF;
  SELECT count(*) INTO v_inv_rows FROM public.v_inventory_value_by_line;
  IF v_inv_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL R5-13c: SALES đọc được giá trị tồn kho qua view (% hàng)', v_inv_rows;
  END IF;
  RAISE NOTICE 'PASS R5-13: SALES không rò giá vốn / phải trả / giá trị tồn qua view báo cáo';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- R5-14. Bất biến tài chính: 0030 chỉ tạo view, số liệu gốc không đổi.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  b numeric;
BEGIN
  SELECT val INTO b FROM p5_base WHERE key = 'payables';
  IF (SELECT count(*) FROM public.supplier_payables) <> b THEN RAISE EXCEPTION 'FAIL R5-14a: số phải trả đổi sau 0030'; END IF;
  SELECT val INTO b FROM p5_base WHERE key = 'receivables';
  IF (SELECT count(*) FROM public.partner_receivables) <> b THEN RAISE EXCEPTION 'FAIL R5-14b: số phải thu đổi sau 0030'; END IF;
  SELECT val INTO b FROM p5_base WHERE key = 'payments';
  IF (SELECT count(*) FROM public.payments) <> b THEN RAISE EXCEPTION 'FAIL R5-14c: số phiếu thanh toán đổi sau 0030'; END IF;
  SELECT val INTO b FROM p5_base WHERE key = 'movements';
  IF (SELECT count(*) FROM public.stock_movements) <> b THEN RAISE EXCEPTION 'FAIL R5-14d: số bút toán kho đổi sau 0030'; END IF;
  SELECT val INTO b FROM p5_base WHERE key = 'confirmed_docs';
  IF (SELECT count(*) FROM public.sales_documents WHERE status = 'CONFIRMED') <> b THEN RAISE EXCEPTION 'FAIL R5-14e: số chứng từ đã xác nhận đổi sau 0030'; END IF;
  SELECT val INTO b FROM p5_base WHERE key = 'rec_open';
  IF (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.partner_receivables) <> b THEN RAISE EXCEPTION 'FAIL R5-14f: dư nợ phải thu đổi sau 0030'; END IF;
  SELECT val INTO b FROM p5_base WHERE key = 'pay_open';
  IF (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.supplier_payables) <> b THEN RAISE EXCEPTION 'FAIL R5-14g: dư nợ phải trả đổi sau 0030'; END IF;
  RAISE NOTICE 'PASS R5-14: bất biến tài chính sau 0030 (payables=3 receivables=10 payments=1 movements=3 docs=9)';
END $$;

SELECT 'P5 ALL CHECKS DONE' AS result;
