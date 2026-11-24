-- =====================================================================
-- p6_hardening_local.sql — Kiểm chứng HỒI QUY toàn chuỗi TVK V2.0 (P6)
-- trên database local (KHÔNG phải live).
--
-- CHẠY (thứ tự bắt buộc):
--   1. Database local trống -> p2_setup_local.sql
--   2. Áp 0001–0024, p1_seed, 0025, p2_seed, 0026, p3_seed, 0027,
--      p4_seed, 0028, 0029, p5_seed, 0030
--   3. psql -v ON_ERROR_STOP=1 -f docs/tests/p6_hardening_local.sql
-- Mọi assertion fail đều RAISE EXCEPTION (psql dừng ngay nhờ ON_ERROR_STOP).
-- Chạy bằng role postgres (superuser) — các khối mô phỏng role dùng
-- SET LOCAL ROLE authenticated + JWT giả (mẫu p0/p2/p3/p4).
-- LƯU Ý: file này TẠO dữ liệu (hoá đơn HD-P6-0001, phải thu + 2 phiếu
-- thu R6-05/R6-06) nên KHÔNG chạy lại được trên cùng database — luôn
-- rebuild từ đầu bằng /tmp/tvk-p6-verify/run-all.sh (không có chế độ
-- test-only như P5).
--
-- Khác với các file P1–P5 (kiểm chứng từng phase ngay sau migration
-- của nó), file này kiểm chứng lại các bất biến QUAN TRỌNG NHẤT trên
-- chuỗi ĐẦY ĐỦ 0001–0030 — tức trạng thái sẽ đem lên staging:
--   R6-01 cấu trúc chuỗi (business_lines, gán mặc định 5/5,
--          payment_allocations, reversal_of_id, 10 view báo cáo)
--   R6-02 fail-closed (chưa gán = không thấy gì; chỉ-dầu; ghost)
--   R6-03 trigger bắt buộc ngành ở header chứng từ (P2)
--   R6-04 hoá đơn trộn hai ngành bị chặn (P4, BL-015 bảng §21.2)
--   R6-05 đảo khi chứng từ đã có hoá đơn GTGT bị chặn (P4, BL-015)
--   R6-06 BL-022: OWNER ghi trực tiếp cash_movements bị chặn (P3)
--   R6-07 sổ kho bất biến (trigger 0001)
--   R6-08 payments bất biến (trigger 0027)
--   R6-09 BL-020: tổng theo ngành = tổng hợp (đối chiếu động)
--   R6-10 view báo cáo 0030: đủ 10 view, security_invoker, grant
--   R6-11 document_counters còn nguyên (mã chứng từ không dùng lại)
--   R6-12 bất biến tài chính sau toàn bộ kiểm chứng (có tính các
--          phiếu R6-05/R6-06 tự tạo trong file này)
--
-- UUID dùng lại từ seed P1–P5 (xem p1_seed_local.sql, p2_seed_local.sql,
-- p4_seed_local.sql, p5_seed_local.sql). UUID mới của file này:
--   R-P6-0001 99999999-9999-9999-9999-999999999901 (phải thu BH-P5-0001)
--   PT-P6-0001 99999999-9999-9999-9999-999999999902 (thu 50.000, có quỹ)
--   PT-P6-FUND 99999999-9999-9999-9999-999999999903 (thu 10.000, có quỹ)
-- =====================================================================

-- Bảng tạm giữ baseline (các khối mô phỏng role cũng cần đọc).
CREATE TEMP TABLE IF NOT EXISTS p6_base (key text PRIMARY KEY, val numeric);
GRANT ALL ON TABLE p6_base TO authenticated;

INSERT INTO p6_base (key, val) VALUES
  ('payables', (SELECT count(*) FROM public.supplier_payables)),
  ('receivables', (SELECT count(*) FROM public.partner_receivables)),
  ('payments', (SELECT count(*) FROM public.payments)),
  ('movements', (SELECT count(*) FROM public.stock_movements)),
  ('cash_movements', (SELECT count(*) FROM public.cash_movements)),
  ('allocations', (SELECT count(*) FROM public.payment_allocations)),
  ('confirmed_docs', (SELECT count(*) FROM public.sales_documents WHERE status = 'CONFIRMED')),
  ('rec_open', (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.partner_receivables)),
  ('pay_open', (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.supplier_payables)),
  ('a1_paid', (SELECT coalesce(amount_paid, 0) FROM public.partner_receivables WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffa1'))
ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;

-- ---------------------------------------------------------------------
-- R6-01. Cấu trúc chuỗi: business_lines, gán mặc định 5/5,
--         payment_allocations, reversal_of_id, 10 view báo cáo.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_lines integer; v_assign integer; v_views integer;
BEGIN
  SELECT count(*) INTO v_lines FROM public.business_lines;
  IF v_lines <> 2 THEN
    RAISE EXCEPTION 'FAIL R6-01a: business_lines có % dòng (expect 2: OIL/AUTO_PARTS)', v_lines;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_lines WHERE code = 'OIL')
     OR NOT EXISTS (SELECT 1 FROM public.business_lines WHERE code = 'AUTO_PARTS') THEN
    RAISE EXCEPTION 'FAIL R6-01b: thiếu mã OIL hoặc AUTO_PARTS trong business_lines';
  END IF;
  -- 5 tài khoản live đều gán AUTO_PARTS (0026 seed theo username).
  SELECT count(*) INTO v_assign
    FROM public.user_business_lines ubl
    JOIN public.profiles p ON p.id = ubl.user_id
    JOIN public.business_lines bl ON bl.id = ubl.business_line_id
   WHERE p.username IN ('thanhphan', 'banhang', 'kho', 'ketoan', 'ceo')
     AND bl.code = 'AUTO_PARTS' AND p.is_active;
  IF v_assign <> 5 THEN
    RAISE EXCEPTION 'FAIL R6-01c: chỉ %/5 tài khoản live gán AUTO_PARTS', v_assign;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'payment_allocations') THEN
    RAISE EXCEPTION 'FAIL R6-01d: thiếu bảng payment_allocations (0027)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'payments'
                    AND column_name = 'reversal_of_id') THEN
    RAISE EXCEPTION 'FAIL R6-01e: thiếu cột payments.reversal_of_id (0027)';
  END IF;
  SELECT count(*) INTO v_views FROM pg_views WHERE schemaname = 'public'
    AND viewname IN ('v_sales_doc_totals', 'v_sales_by_line', 'v_daily_revenue_by_line',
      'v_product_sales_30d', 'v_group_performance_by_line', 'v_debt_by_line',
      'v_inventory_value_by_line', 'v_partner_consignment_by_line',
      'v_consignment_flow_by_line', 'v_stock_movements_with_line');
  IF v_views <> 10 THEN
    RAISE EXCEPTION 'FAIL R6-01f: chỉ %/10 view báo cáo 0030', v_views;
  END IF;
  RAISE NOTICE 'PASS R6-01: chuỗi 0001–0030 đủ cấu trúc (2 ngành, 5/5 gán AUTO_PARTS, payment_allocations, reversal_of_id, 10 view)';
END $$;

-- ---------------------------------------------------------------------
-- R6-02. Fail-closed (P2): chưa gán = không thấy gì; chỉ-dầu chỉ
--         thấy dầu; ghost (không profile) không thấy gì; OWNER thấy tất.
-- ---------------------------------------------------------------------
-- Gán OIL cho test-chidau ngay trong file này (p5 chỉ gán trong file
-- kiểm chứng của nó, không lưu lại chuỗi seed).
INSERT INTO public.user_business_lines (user_id, business_line_id)
SELECT '88888888-8888-8888-8888-888888888888', id FROM public.business_lines WHERE code = 'OIL'
ON CONFLICT (user_id, business_line_id) DO NOTHING;

DO $$
DECLARE
  v_oil uuid; v_auto uuid;
BEGIN
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  SELECT id INTO v_auto FROM public.business_lines WHERE code = 'AUTO_PARTS';
  IF public.user_can_access_business_line('77777777-7777-7777-7777-777777777777', v_oil)
     OR public.user_can_access_business_line('77777777-7777-7777-7777-777777777777', v_auto) THEN
    RAISE EXCEPTION 'FAIL R6-02a: test-chuagan (chưa gán ngành) vẫn thấy ngành';
  END IF;
  IF NOT public.user_can_access_business_line('88888888-8888-8888-8888-888888888888', v_oil)
     OR public.user_can_access_business_line('88888888-8888-8888-8888-888888888888', v_auto) THEN
    RAISE EXCEPTION 'FAIL R6-02b: test-chidau phải chỉ thấy OIL';
  END IF;
  IF public.user_can_access_business_line('00000000-0000-4000-8000-000000000000', v_oil)
     OR public.user_can_access_business_line('00000000-0000-4000-8000-000000000000', v_auto) THEN
    RAISE EXCEPTION 'FAIL R6-02c: ghost (không profile) vẫn thấy ngành';
  END IF;
  IF NOT public.user_can_access_business_line('158a181e-f50e-43ef-92b2-4841bdf468aa', v_oil)
     OR NOT public.user_can_access_business_line('158a181e-f50e-43ef-92b2-4841bdf468aa', v_auto) THEN
    RAISE EXCEPTION 'FAIL R6-02d: OWNER phải thấy cả hai ngành';
  END IF;
  RAISE NOTICE 'PASS R6-02: fail-closed đúng (chưa gán/ghost = 0, chỉ-dầu = chỉ OIL, OWNER = tất cả)';
END $$;

-- ---------------------------------------------------------------------
-- R6-03. Trigger bắt buộc ngành ở header chứng từ (P2).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO public.purchase_receipts (id, doc_code, supplier_id, warehouse_id, receipt_date, status, business_line_id)
    VALUES ('99999999-9999-9999-9999-999999999910', 'PN-P6-TEST-NULL', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', '2026-11-23', 'DRAFT', NULL);
    RAISE EXCEPTION 'FAIL R6-03a: INSERT phiếu NULL ngành không bị chặn';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%ngành hàng%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS R6-03: INSERT phiếu NULL ngành bị chặn (trigger header)';
END $$;

-- ---------------------------------------------------------------------
-- R6-04. Hoá đơn trộn hai ngành bị chặn (P4, BL-015 bảng §21.2).
--   Dùng lại đúng 2 dòng của file P4 (KG-VAT-0001 AUTO + BH-VAT-0004
--   OIL, cả hai chưa ghi hoá đơn vì lần gọi ở P4 đã bị chặn).
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_inv uuid;
BEGIN
  BEGIN
    SELECT public.create_vat_invoice('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'HD-P6-MIX', 'P6', '2026-09-08', 'TVK',
      ARRAY['55555555-5555-5555-5555-555555550304'::uuid, '55555555-5555-5555-5555-555555550307'::uuid]) INTO v_inv;
    RAISE EXCEPTION 'FAIL R6-04: hoá đơn trộn ngành không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%một ngành%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS R6-04: hoá đơn trộn Dầu nhớt + Phụ tùng bị chặn';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- R6-05. Đảo khi chứng từ đã có hoá đơn GTGT bị chặn (P4, BL-015).
--   Dựng kịch bản mới trong file này (không dùng dữ liệu P4):
--   phải thu R-P6-0001 cho BH-P5-0001 (AUTO, CONFIRMED) -> thu
--   50.000 có quỹ -> ghi hoá đơn HD-P6-0001 cho dòng BH-P5-0001
--   -> đảo phải bị chặn và nêu đúng số hoá đơn; số dư không đổi.
-- ---------------------------------------------------------------------
-- Phải thu + phiếu thu (trigger 0027 tự tạo dòng phân bổ + dòng quỹ).
INSERT INTO public.partner_receivables (id, partner_id, source_document_id, amount, amount_paid, status)
VALUES ('99999999-9999-9999-9999-999999999901', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
        '66666666-6666-6666-6666-666666660201', 300000, 0, 'UNPAID')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payments (id, doc_code, payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
SELECT '99999999-9999-9999-9999-999999999902', 'PT-P6-0001', 'IN', '2026-11-23', 50000, 'BANK',
       '99999999-9999-9999-9999-999999999901', id, 'Thu P6-05', '158a181e-f50e-43ef-92b2-4841bdf468aa'
  FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_alloc integer; v_paid numeric;
BEGIN
  SELECT count(*) INTO v_alloc FROM public.payment_allocations
   WHERE payment_id = '99999999-9999-9999-9999-999999999902';
  IF v_alloc < 1 THEN
    RAISE EXCEPTION 'FAIL R6-05a: phiếu PT-P6-0001 không có dòng phân bổ (trigger 0027)';
  END IF;
  SELECT amount_paid INTO v_paid FROM public.partner_receivables
   WHERE id = '99999999-9999-9999-9999-999999999901';
  IF v_paid <> 50000 THEN
    RAISE EXCEPTION 'FAIL R6-05b: R-P6-0001 amount_paid=% (expect 50000)', v_paid;
  END IF;
  RAISE NOTICE 'PASS R6-05a/b: phiếu P6 có phân bổ, phải thu đã nhận 50.000';
END $$;

-- Ghi hoá đơn cho dòng BH-P5-0001 (AUTO, chưa ghi hoá đơn).
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_inv uuid;
BEGIN
  SELECT public.create_vat_invoice('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'HD-P6-0001', 'P6', '2026-11-23', 'TVK',
    ARRAY['66666666-6666-6666-6666-666666660301'::uuid]) INTO v_inv;
  IF v_inv IS NULL THEN
    RAISE EXCEPTION 'FAIL R6-05c: create_vat_invoice trả NULL cho dòng BH-P5-0001';
  END IF;
  RAISE NOTICE 'PASS R6-05c: đã ghi hoá đơn HD-P6-0001 cho BH-P5-0001';
END $$;
COMMIT;

-- Đảo phiếu đã có hoá đơn -> phải bị chặn, nêu đúng số hoá đơn.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb78abc2-584f-45b8-b63f-11c38f4299d0', true);
DO $$
DECLARE
  v_rev uuid; v_paid numeric; v_payments integer;
BEGIN
  BEGIN
    SELECT public.reverse_payment('99999999-9999-9999-9999-999999999902', 'Kiểm chứng R6-05: đảo khi đã có hoá đơn') INTO v_rev;
    RAISE EXCEPTION 'FAIL R6-05d: đảo khi chứng từ đã có hoá đơn không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%HD-P6-0001%' THEN RAISE; END IF;
  END;
  SELECT amount_paid INTO v_paid FROM public.partner_receivables
   WHERE id = '99999999-9999-9999-9999-999999999901';
  IF v_paid <> 50000 THEN
    RAISE EXCEPTION 'FAIL R6-05e: đảo bị chặn nhưng amount_paid đổi thành %', v_paid;
  END IF;
  SELECT count(*) INTO v_payments FROM public.payments
   WHERE reversal_of_id = '99999999-9999-9999-9999-999999999902';
  IF v_payments <> 0 THEN
    RAISE EXCEPTION 'FAIL R6-05f: đảo bị chặn nhưng vẫn tạo % phiếu đảo', v_payments;
  END IF;
  RAISE NOTICE 'PASS R6-05d/e/f: đảo khi đã có hoá đơn HD-P6-0001 bị chặn, số dư nguyên vẹn';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- R6-06. BL-022: OWNER ghi trực tiếp cash_movements bị chặn (P3).
--   Tạo phiếu thu có quỹ PT-P6-FUND để có dòng tiền thật rồi thử
--   INSERT/UPDATE/DELETE trực tiếp dưới quyền OWNER.
-- ---------------------------------------------------------------------
INSERT INTO public.payments (id, doc_code, payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
SELECT '99999999-9999-9999-9999-999999999903', 'PT-P6-FUND', 'IN', '2026-11-23', 10000, 'CASH',
       'ffffffff-ffff-ffff-ffff-ffffffffffa1', id, 'Thu P6-06 có quỹ', '158a181e-f50e-43ef-92b2-4841bdf468aa'
  FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1
ON CONFLICT (id) DO NOTHING;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_fund uuid; v_mid uuid;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  SELECT id INTO v_mid FROM public.cash_movements
   WHERE payment_id = '99999999-9999-9999-9999-999999999903' LIMIT 1;
  IF v_mid IS NULL THEN
    RAISE EXCEPTION 'FAIL R6-06a: phiếu PT-P6-FUND không tạo dòng tiền (trigger quỹ)';
  END IF;
  BEGIN
    INSERT INTO public.cash_movements (fund_id, amount, movement_date, movement_kind, note, created_by)
    VALUES (v_fund, 1000, '2026-11-23', 'OPERATING', 'R6-06 direct insert', '158a181e-f50e-43ef-92b2-4841bdf468aa');
    RAISE EXCEPTION 'FAIL R6-06b: OWNER INSERT trực tiếp cash_movements không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.cash_movements SET amount = amount + 1 WHERE id = v_mid;
    RAISE EXCEPTION 'FAIL R6-06c: OWNER UPDATE trực tiếp cash_movements không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE NOT IN ('42501', 'P0001') THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.cash_movements WHERE id = v_mid;
    RAISE EXCEPTION 'FAIL R6-06d: OWNER DELETE trực tiếp cash_movements không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE NOT IN ('42501', 'P0001') THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS R6-06: OWNER ghi/sửa/xoá trực tiếp cash_movements đều bị chặn (BL-022)';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- R6-07. Sổ kho bất biến: UPDATE/DELETE stock_movements bị chặn (0001).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_mid uuid;
BEGIN
  SELECT id INTO v_mid FROM public.stock_movements
   WHERE id = '66666666-6666-6666-6666-666666660501' LIMIT 1;
  IF v_mid IS NULL THEN
    RAISE EXCEPTION 'FAIL R6-07a: thiếu bút toán M1 của seed P5';
  END IF;
  BEGIN
    UPDATE public.stock_movements SET qty = qty + 1 WHERE id = v_mid;
    RAISE EXCEPTION 'FAIL R6-07b: UPDATE stock_movements không bị chặn';
  EXCEPTION WHEN raise_exception THEN
    -- trg_movements_no_update raise EXCEPTION (P0001).
    IF SQLSTATE <> 'P0001' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.stock_movements WHERE id = v_mid;
    RAISE EXCEPTION 'FAIL R6-07c: DELETE stock_movements không bị chặn';
  EXCEPTION WHEN raise_exception THEN
    IF SQLSTATE <> 'P0001' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS R6-07: sổ kho bất biến (UPDATE/DELETE đều bị trigger chặn)';
END $$;

-- ---------------------------------------------------------------------
-- R6-08. Payments bất biến: UPDATE/DELETE payments bị chặn (0027).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    UPDATE public.payments SET amount = amount + 1
     WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffa2';
    RAISE EXCEPTION 'FAIL R6-08a: UPDATE payments không bị chặn';
  EXCEPTION WHEN raise_exception THEN
    IF SQLSTATE <> 'P0001' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.payments WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffa2';
    RAISE EXCEPTION 'FAIL R6-08b: DELETE payments không bị chặn';
  EXCEPTION WHEN raise_exception THEN
    IF SQLSTATE <> 'P0001' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS R6-08: payments bất biến (UPDATE/DELETE đều bị trigger chặn)';
END $$;

-- ---------------------------------------------------------------------
-- R6-09. BL-020: tổng theo ngành = tổng hợp (đối chiếu động, không
--         hard-code số — số liệu seed có thể đổi khi P1–P5 sửa seed).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_rev_line numeric; v_rev_docs numeric;
  v_cogs_line numeric; v_cogs_docs numeric;
  v_orders_line integer; v_orders_docs integer;
  v_debt_line numeric; v_debt_direct numeric;
BEGIN
  SELECT coalesce(sum(revenue), 0), coalesce(sum(cogs), 0), coalesce(sum(orders), 0)
    INTO v_rev_line, v_cogs_line, v_orders_line FROM public.v_sales_by_line;
  SELECT coalesce(sum(revenue_net), 0), coalesce(sum(cogs), 0), count(*)
    INTO v_rev_docs, v_cogs_docs, v_orders_docs FROM public.v_sales_doc_totals;
  IF v_rev_line <> v_rev_docs OR v_cogs_line <> v_cogs_docs OR v_orders_line <> v_orders_docs THEN
    RAISE EXCEPTION 'FAIL R6-09a: v_sales_by_line (rev=% cogs=% orders=%) <> v_sales_doc_totals (rev=% cogs=% orders=%)',
      v_rev_line, v_cogs_line, v_orders_line, v_rev_docs, v_cogs_docs, v_orders_docs;
  END IF;
  SELECT coalesce(sum(outstanding), 0) INTO v_debt_line FROM public.v_debt_by_line;
  SELECT coalesce(sum(amount - amount_paid), 0) INTO v_debt_direct
    FROM (SELECT amount, amount_paid FROM public.partner_receivables
          UNION ALL
          SELECT amount, amount_paid FROM public.supplier_payables) t;
  IF v_debt_line <> v_debt_direct THEN
    RAISE EXCEPTION 'FAIL R6-09b: v_debt_by_line outstanding=% <> trực tiếp=%', v_debt_line, v_debt_direct;
  END IF;
  RAISE NOTICE 'PASS R6-09 (BL-020): tổng theo ngành = tổng hợp (doanh thu %, giá vốn %, % đơn; công nợ %)',
    v_rev_line, v_cogs_line, v_orders_line, v_debt_line;
END $$;

-- ---------------------------------------------------------------------
-- R6-10. View báo cáo 0030: đủ 10 view, security_invoker=true,
--         SELECT cho authenticated.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_missing text[]; v_bad_invoker text[]; v_no_grant text[];
BEGIN
  SELECT array_agg(v) INTO v_missing FROM (VALUES
    ('v_sales_doc_totals'), ('v_sales_by_line'), ('v_daily_revenue_by_line'),
    ('v_product_sales_30d'), ('v_group_performance_by_line'), ('v_debt_by_line'),
    ('v_inventory_value_by_line'), ('v_partner_consignment_by_line'),
    ('v_consignment_flow_by_line'), ('v_stock_movements_with_line')
  ) AS t(v)
  WHERE NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = t.v);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL R6-10a: thiếu view báo cáo: %', array_to_string(v_missing, ', ');
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
    RAISE EXCEPTION 'FAIL R6-10b: view không có security_invoker=true: %', array_to_string(v_bad_invoker, ', ');
  END IF;
  SELECT array_agg(v) INTO v_no_grant FROM (VALUES
    ('v_sales_doc_totals'), ('v_sales_by_line'), ('v_daily_revenue_by_line'),
    ('v_product_sales_30d'), ('v_group_performance_by_line'), ('v_debt_by_line'),
    ('v_inventory_value_by_line'), ('v_partner_consignment_by_line'),
    ('v_consignment_flow_by_line'), ('v_stock_movements_with_line')
  ) AS t(v)
  WHERE NOT has_table_privilege('authenticated', 'public.' || t.v, 'SELECT');
  IF v_no_grant IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL R6-10c: authenticated không SELECT được view: %', array_to_string(v_no_grant, ', ');
  END IF;
  RAISE NOTICE 'PASS R6-10: đủ 10 view báo cáo, security_invoker=true, SELECT cho authenticated';
END $$;

-- ---------------------------------------------------------------------
-- R6-11. Cơ chế cấp mã chứng từ (0001): next_doc_code cấp mã liên
--         tục, không dùng lại. (Bảng document_counters RỖNG trên
--         scratch là đúng — seed chèn mã trực tiếp, không qua hàm
--         này; kiểm chứng bằng cách gọi hàm với tiền tố thử 'ZZ'.)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_c1 text; v_c2 text;
BEGIN
  SELECT public.next_doc_code('ZZ') INTO v_c1;
  SELECT public.next_doc_code('ZZ') INTO v_c2;
  IF v_c1 = v_c2 THEN
    RAISE EXCEPTION 'FAIL R6-11a: next_doc_code cấp trùng mã %', v_c1;
  END IF;
  IF v_c1 NOT LIKE 'ZZ-____-0001' OR v_c2 NOT LIKE 'ZZ-____-0002' THEN
    RAISE EXCEPTION 'FAIL R6-11b: mã cấp sai dạng: % / %', v_c1, v_c2;
  END IF;
  DELETE FROM public.document_counters WHERE prefix = 'ZZ';
  RAISE NOTICE 'PASS R6-11: next_doc_code cấp mã liên tục không trùng (% / %; đã dọn dãy thử ZZ)', v_c1, v_c2;
END $$;

-- ---------------------------------------------------------------------
-- R6-12. Bất biến tài chính sau toàn bộ kiểm chứng.
--   Kỳ vọng so với baseline đầu file (chỉ cộng các phiếu R6-05/R6-06):
--   - receivables +1 (R-P6-0001); payments +2 (PT-P6-0001, PT-P6-FUND);
--   - cash_movements +2 (cả hai phiếu đều có quỹ);
--   - payables / stock_movements không đổi;
--   - rec_open = baseline + 240.000 (R-P6-0001 còn 250.000 trừ
--     10.000 đã thu thêm của khoản a1); pay_open không đổi;
--   - a1 amount_paid = baseline + 10.000 (PT-P6-FUND).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_payables integer; v_receivables integer; v_payments integer;
  v_movements integer; v_cash_movements integer;
  v_rec_open numeric; v_pay_open numeric; v_a1_paid numeric;
BEGIN
  SELECT count(*) INTO v_payables FROM public.supplier_payables;
  SELECT count(*) INTO v_receivables FROM public.partner_receivables;
  SELECT count(*) INTO v_payments FROM public.payments;
  SELECT count(*) INTO v_movements FROM public.stock_movements;
  SELECT count(*) INTO v_cash_movements FROM public.cash_movements;
  SELECT coalesce(sum(amount - amount_paid), 0) INTO v_rec_open FROM public.partner_receivables;
  SELECT coalesce(sum(amount - amount_paid), 0) INTO v_pay_open FROM public.supplier_payables;
  SELECT coalesce(amount_paid, 0) INTO v_a1_paid FROM public.partner_receivables
   WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffa1';
  IF v_payables <> (SELECT val FROM p6_base WHERE key = 'payables') THEN
    RAISE EXCEPTION 'FAIL R6-12a: payables đổi (expect baseline)';
  END IF;
  IF v_receivables <> (SELECT val FROM p6_base WHERE key = 'receivables') + 1 THEN
    RAISE EXCEPTION 'FAIL R6-12b: receivables=% (expect baseline+1 R-P6-0001)', v_receivables;
  END IF;
  IF v_payments <> (SELECT val FROM p6_base WHERE key = 'payments') + 2 THEN
    RAISE EXCEPTION 'FAIL R6-12c: payments=% (expect baseline+2)', v_payments;
  END IF;
  IF v_movements <> (SELECT val FROM p6_base WHERE key = 'movements') THEN
    RAISE EXCEPTION 'FAIL R6-12d: stock_movements đổi (expect baseline)';
  END IF;
  IF v_cash_movements <> (SELECT val FROM p6_base WHERE key = 'cash_movements') + 2 THEN
    RAISE EXCEPTION 'FAIL R6-12e: cash_movements=% (expect baseline+2)', v_cash_movements;
  END IF;
  IF v_rec_open <> (SELECT val FROM p6_base WHERE key = 'rec_open') + 240000 THEN
    RAISE EXCEPTION 'FAIL R6-12f: rec_open=% (expect baseline+240000)', v_rec_open;
  END IF;
  IF v_pay_open <> (SELECT val FROM p6_base WHERE key = 'pay_open') THEN
    RAISE EXCEPTION 'FAIL R6-12g: pay_open đổi (expect baseline)';
  END IF;
  IF v_a1_paid <> (SELECT val FROM p6_base WHERE key = 'a1_paid') + 10000 THEN
    RAISE EXCEPTION 'FAIL R6-12h: a1 amount_paid=% (expect baseline+10000)', v_a1_paid;
  END IF;
  RAISE NOTICE 'PASS R6-12: bất biến tài chính sau toàn chuỗi (chỉ cộng đúng các phiếu R6-05/R6-06)';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'P6 HARDENING REGRESSION: ALL CHECKS R6-01..R6-12 PASSED';
END $$;
