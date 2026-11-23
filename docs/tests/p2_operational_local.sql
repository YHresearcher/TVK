-- =====================================================================
-- p2_operational_local.sql — Kiểm chứng migration 0026 (TVK V2.0 P2)
-- trên database local (KHÔNG phải live).
--
-- CHẠY (thứ tự bắt buộc):
--   1. Database local trống -> p2_setup_local.sql
--   2. Áp 0001–0024
--   3. psql -v ON_ERROR_STOP=1 -f docs/tests/p1_seed_local.sql
--   4. psql -v ON_ERROR_STOP=1 -f supabase/migrations/0025_business_lines.sql
--   5. psql -v ON_ERROR_STOP=1 -f docs/tests/p2_seed_local.sql
--   6. psql -v ON_ERROR_STOP=1 -f supabase/migrations/0026_default_assignments_fail_closed.sql
--   7. psql -v ON_ERROR_STOP=1 -f docs/tests/p2_operational_local.sql
-- Mọi assertion fail đều RAISE EXCEPTION (psql dừng ngay nhờ ON_ERROR_STOP).
-- Chạy bằng role postgres (superuser) — các khối mô phỏng role dùng
-- SET LOCAL ROLE authenticated + JWT giả (mẫu p0_sales_view_rls_local.sql).
--
-- Quy ước UUID (từ p1_seed_local.sql + p2_seed_local.sql):
--   OWNER 158a181e-f50e-43ef-92b2-4841bdf468aa | SALES banhang 44b1f9c9-f3f6-48ad-a575-2c32092f2130
--   WAREHOUSE kho 07d6557e-4444-4561-849a-0db13579439e | ACCOUNTING ketoan eb78abc2-584f-45b8-b63f-11c38f4299d0
--   CEO e3436179-bf18-4745-8843-f5cecb139e07 | test-chuagan 77777777-7777-7777-7777-777777777777
--   test-chidau 88888888-8888-8888-8888-888888888888 | test-tat 99999999-9999-9999-9999-999999999999
--   test-kho-dau 12121212-1212-1212-1212-121212121212 (WAREHOUSE, OIL — tạo ở mục C7)
--   test-kho-chuagan 34343434-3434-3434-3434-343434343434 (WAREHOUSE, chưa gán — tạo ở mục C7)
--   ghost 00000000-0000-4000-8000-000000000000 (không có profile)
--   Sản phẩm: a1/a2/a7 phụ tùng, a3/a4 dầu, a5/a6 chưa phân loại.
--   Lô: d1 phụ tùng (p1), d2 dầu (p3). Phiếu nhập: e1 thuần phụ tùng, e2 hỗn hợp.
-- =====================================================================

-- Gán OIL cho 2 tài khoản kiểm chứng (mô phỏng OWNER gán qua action P1).
INSERT INTO public.user_business_lines (user_id, business_line_id)
SELECT '88888888-8888-8888-8888-888888888888', id FROM public.business_lines WHERE code = 'OIL'
ON CONFLICT (user_id, business_line_id) DO NOTHING;
INSERT INTO public.user_business_lines (user_id, business_line_id)
SELECT '99999999-9999-9999-9999-999999999999', id FROM public.business_lines WHERE code = 'OIL'
ON CONFLICT (user_id, business_line_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- A. Seed gán mặc định: đúng 5 tài khoản thật -> AUTO_PARTS.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_auto integer; v_total integer;
BEGIN
  SELECT count(*) INTO v_auto FROM public.user_business_lines ubl
    JOIN public.business_lines bl ON bl.id = ubl.business_line_id
   WHERE bl.code = 'AUTO_PARTS';
  SELECT count(*) INTO v_total FROM public.user_business_lines;
  IF v_auto <> 5 THEN RAISE EXCEPTION 'FAIL A1: AUTO_PARTS assignments=% (expect 5)', v_auto; END IF;
  IF v_total <> 7 THEN RAISE EXCEPTION 'FAIL A2: total assignments=% (expect 7 = 5 AUTO_PARTS + 2 OIL test)', v_total; END IF;
  IF (SELECT count(*) FROM public.user_business_lines ubl JOIN public.profiles p ON p.id = ubl.user_id
       WHERE p.username IN ('thanhphan','banhang','kho','ketoan','ceo')) <> 5 THEN
    RAISE EXCEPTION 'FAIL A3: not all 5 real accounts assigned';
  END IF;
  RAISE NOTICE 'PASS A: 5 tài khoản thật -> AUTO_PARTS, tổng 7 dòng gán';
END $$;

-- ---------------------------------------------------------------------
-- B. Hàm user_can_access_business_line — fail-closed (P2).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_oil uuid; v_parts uuid;
  b_owner boolean; b_ceo boolean; b_none_oil boolean; b_none_parts boolean;
  b_oilonly_oil boolean; b_oilonly_parts boolean; b_inactive boolean;
  b_ghost_oil boolean; b_ghost_parts boolean; b_null boolean;
BEGIN
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  b_owner        := public.user_can_access_business_line('158a181e-f50e-43ef-92b2-4841bdf468aa', v_oil)
                AND public.user_can_access_business_line('158a181e-f50e-43ef-92b2-4841bdf468aa', v_parts);
  b_ceo          := public.user_can_access_business_line('e3436179-bf18-4745-8843-f5cecb139e07', v_oil)
                AND public.user_can_access_business_line('e3436179-bf18-4745-8843-f5cecb139e07', v_parts);
  b_none_oil     := public.user_can_access_business_line('77777777-7777-7777-7777-777777777777', v_oil);
  b_none_parts   := public.user_can_access_business_line('77777777-7777-7777-7777-777777777777', v_parts);
  b_oilonly_oil  := public.user_can_access_business_line('88888888-8888-8888-8888-888888888888', v_oil);
  b_oilonly_parts:= public.user_can_access_business_line('88888888-8888-8888-8888-888888888888', v_parts);
  b_inactive     := public.user_can_access_business_line('99999999-9999-9999-9999-999999999999', v_oil);
  b_ghost_oil    := public.user_can_access_business_line('00000000-0000-4000-8000-000000000000', v_oil);
  b_ghost_parts  := public.user_can_access_business_line('00000000-0000-4000-8000-000000000000', v_parts);
  b_null         := public.user_can_access_business_line('77777777-7777-7777-7777-777777777777', NULL);

  IF NOT b_owner THEN RAISE EXCEPTION 'FAIL B1: OWNER bị chặn một ngành'; END IF;
  IF NOT b_ceo THEN RAISE EXCEPTION 'FAIL B2: CEO bị chặn một ngành'; END IF;
  IF b_none_oil OR b_none_parts THEN RAISE EXCEPTION 'FAIL B3: user chưa gán vẫn thấy ngành (fail-closed hỏng)'; END IF;
  IF NOT b_oilonly_oil THEN RAISE EXCEPTION 'FAIL B4: user chỉ-dầu bị chặn OIL'; END IF;
  IF b_oilonly_parts THEN RAISE EXCEPTION 'FAIL B5: user chỉ-dầu thấy được AUTO_PARTS'; END IF;
  IF b_inactive THEN RAISE EXCEPTION 'FAIL B6: tài khoản đã tắt vẫn thấy ngành'; END IF;
  IF b_ghost_oil OR b_ghost_parts THEN RAISE EXCEPTION 'FAIL B7: ghost (không profile) thấy được ngành'; END IF;
  IF NOT b_null THEN RAISE EXCEPTION 'FAIL B8: dòng chưa phân loại (NULL) bị chặn — phải cho qua để xử lý thủ công'; END IF;
  RAISE NOTICE 'PASS B: fail-closed đúng (OWNER/CEO tất cả; chưa gán = 0; chỉ-dầu đúng 1; đã tắt/ghost = 0; NULL cho qua)';
END $$;

-- ---------------------------------------------------------------------
-- C. View v_batches_for_sales lọc theo phân quyền ngành (P2).
--    Seed: 2 lô (d1 phụ tùng, d2 dầu) x 1 kho = 2 dòng view.
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batches_for_sales;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL C1: user chưa gán thấy % dòng view (expect 0)', v_n; END IF;
  RAISE NOTICE 'PASS C1: user chưa gán = 0 dòng view';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44b1f9c9-f3f6-48ad-a575-2c32092f2130', true);
DO $$
DECLARE v_n integer; v_oil integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batches_for_sales;
  SELECT count(*) INTO v_oil FROM public.v_batches_for_sales WHERE business_line_code = 'OIL';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL C2: banhang (AUTO_PARTS) thấy % dòng (expect 1)', v_n; END IF;
  IF v_oil <> 0 THEN RAISE EXCEPTION 'FAIL C3: banhang thấy dòng OIL'; END IF;
  RAISE NOTICE 'PASS C2: banhang chỉ thấy 1 dòng AUTO_PARTS, 0 dòng OIL';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
DO $$
DECLARE v_n integer; v_parts integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batches_for_sales;
  SELECT count(*) INTO v_parts FROM public.v_batches_for_sales WHERE business_line_code = 'AUTO_PARTS';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL C4: test-chidau (OIL) thấy % dòng (expect 1)', v_n; END IF;
  IF v_parts <> 0 THEN RAISE EXCEPTION 'FAIL C5: test-chidau thấy dòng AUTO_PARTS'; END IF;
  RAISE NOTICE 'PASS C3: test-chidau chỉ thấy 1 dòng OIL, 0 dòng AUTO_PARTS';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batches_for_sales;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL C6: OWNER thấy % dòng (expect 2)', v_n; END IF;
  RAISE NOTICE 'PASS C4: OWNER thấy đủ 2 dòng';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000000', true);
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batches_for_sales;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL C7: ghost thấy % dòng (expect 0)', v_n; END IF;
  RAISE NOTICE 'PASS C5: ghost = 0 dòng view';
END $$;
ROLLBACK;

-- C6: view không lộ cột giá vốn.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='v_batches_for_sales'
               AND column_name IN ('unit_cost','consignment_price')) THEN
    RAISE EXCEPTION 'FAIL C8: cost column leaked in sales view';
  END IF;
  RAISE NOTICE 'PASS C6: view không có cột giá vốn';
END $$;

-- C7: v_batch_stock lọc theo ngành (BL-001 ở tầng view tồn kho, 0026 §6).
-- Seed có 2 lô: OWN-SEED-0001 (Lọc dầu, AUTO_PARTS) + OWN-SEED-0002
-- (Nhớt 10W40, OIL), mỗi lô 1 dòng batch_locations tại Kho TVK.
-- LƯU Ý VAI TRÒ: v_batch_stock chạy với security_invoker=true nên RLS
-- bảng gốc áp dụng — SALES KHÔNG đọc được stock_batches (siết M2 ở
-- 0018: SALES phải dùng v_batches_for_sales, đã kiểm ở C2/C3). Vì vậy
-- C7 dùng user WAREHOUSE để kiểm lọc ngành; banhang (SALES) = 0 dòng
-- là đúng thiết kế, không phải lỗi lọc ngành (C7e).
-- Tài khoản kiểm chứng tạo riêng trong mục này (sau A/B nên không ảnh
-- hưởng đếm gán ở A/G): test-kho-dau (WAREHOUSE, gán OIL),
-- test-kho-chuagan (WAREHOUSE, chưa gán); dọn ở cuối file.
INSERT INTO auth.users (id, email) VALUES
  ('12121212-1212-1212-1212-121212121212', 'test-kho-dau@test.local'),
  ('34343434-3434-3434-3434-343434343434', 'test-kho-chuagan@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, email, username, full_name, role, is_active) VALUES
  ('12121212-1212-1212-1212-121212121212', 'test-kho-dau@test.local', 'test-kho-dau', 'Thủ kho chỉ dầu', 'WAREHOUSE', true),
  ('34343434-3434-3434-3434-343434343434', 'test-kho-chuagan@test.local', 'test-kho-chuagan', 'Thủ kho chưa gán', 'WAREHOUSE', true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_business_lines (user_id, business_line_id)
SELECT '12121212-1212-1212-1212-121212121212', id FROM public.business_lines WHERE code = 'OIL'
ON CONFLICT (user_id, business_line_id) DO NOTHING;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '07d6557e-4444-4561-849a-0db13579439e', true);
DO $$
DECLARE v_n integer; v_oil integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batch_stock;
  SELECT count(*) INTO v_oil FROM public.v_batch_stock WHERE business_line_code = 'OIL';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL C7a: kho thay % dong v_batch_stock (doi 1)', v_n; END IF;
  IF v_oil <> 0 THEN RAISE EXCEPTION 'FAIL C7a: kho thay dong OIL trong v_batch_stock'; END IF;
  RAISE NOTICE 'PASS C7a: kho (WAREHOUSE, AUTO_PARTS) chỉ thấy 1 dòng AUTO_PARTS trong v_batch_stock';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '12121212-1212-1212-1212-121212121212', true);
DO $$
DECLARE v_n integer; v_parts integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batch_stock;
  SELECT count(*) INTO v_parts FROM public.v_batch_stock WHERE business_line_code = 'AUTO_PARTS';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL C7b: test-kho-dau thay % dong v_batch_stock (doi 1)', v_n; END IF;
  IF v_parts <> 0 THEN RAISE EXCEPTION 'FAIL C7b: test-kho-dau thay dong AUTO_PARTS trong v_batch_stock'; END IF;
  RAISE NOTICE 'PASS C7b: test-kho-dau (WAREHOUSE, OIL) chỉ thấy 1 dòng OIL trong v_batch_stock';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '34343434-3434-3434-3434-343434343434', true);
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batch_stock;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL C7c: test-kho-chuagan thay % dong v_batch_stock (doi 0)', v_n; END IF;
  RAISE NOTICE 'PASS C7c: test-kho-chuagan (WAREHOUSE, chưa gán) = 0 dòng v_batch_stock';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batch_stock;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL C7d: OWNER thay % dong v_batch_stock (doi 2)', v_n; END IF;
  RAISE NOTICE 'PASS C7d: OWNER thấy đủ 2 dòng v_batch_stock';
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44b1f9c9-f3f6-48ad-a575-2c32092f2130', true);
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_batch_stock;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL C7e: banhang (SALES) thay % dong v_batch_stock (doi 0 — SALES khong doc duoc stock_batches, xem v_batches_for_sales)', v_n; END IF;
  RAISE NOTICE 'PASS C7e: banhang (SALES) = 0 dòng v_batch_stock theo đúng siết M2 (dùng v_batches_for_sales thay thế)';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------
-- D. Chứng từ mới bắt buộc có ngành (trigger trg_require_header_bl).
-- ---------------------------------------------------------------------
-- D1: INSERT phiếu nhập NULL ngành -> bị chặn.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.purchase_receipts (id, doc_code, supplier_id, warehouse_id, receipt_date, status, business_line_id)
    VALUES ('ffffffff-ffff-ffff-ffff-fffffffffff1', 'PN-P2-TEST-NULL', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', '2026-11-23', 'DRAFT', NULL);
    RAISE EXCEPTION 'FAIL D1: INSERT phiếu NULL ngành không bị chặn';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%ngành hàng%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS D1: INSERT phiếu NULL ngành bị chặn';
  END;
END $$;

-- D2: INSERT phiếu có ngành -> được (dùng làm phiếu thử cho mục E).
INSERT INTO public.purchase_receipts (id, doc_code, supplier_id, warehouse_id, receipt_date, status, business_line_id)
SELECT 'ffffffff-ffff-ffff-ffff-fffffffffff2', 'PN-P2-TEST-01', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', '2026-11-23', 'DRAFT', id
  FROM public.business_lines WHERE code = 'AUTO_PARTS';

-- D3: UPDATE bỏ ngành của phiếu đã có dòng (PN-SEED-0001) -> bị chặn.
DO $$
BEGIN
  BEGIN
    UPDATE public.purchase_receipts SET business_line_id = NULL WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
    RAISE EXCEPTION 'FAIL D2: UPDATE bỏ ngành của phiếu có dòng không bị chặn';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Không được bỏ ngành hàng%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS D2: UPDATE bỏ ngành của phiếu có dòng bị chặn';
  END;
END $$;

-- D4: UPDATE bỏ ngành của phiếu chưa có dòng -> được (rồi xoá dọn).
DO $$
DECLARE v_before uuid;
BEGIN
  SELECT business_line_id INTO v_before FROM public.purchase_receipts WHERE id = 'ffffffff-ffff-ffff-ffff-fffffffffff2';
  IF v_before IS NULL THEN RAISE EXCEPTION 'FAIL D3: phiếu thử PN-P2-TEST-01 không có ngành'; END IF;
  UPDATE public.purchase_receipts SET business_line_id = NULL WHERE id = 'ffffffff-ffff-ffff-ffff-fffffffffff2';
  UPDATE public.purchase_receipts SET business_line_id = v_before WHERE id = 'ffffffff-ffff-ffff-ffff-fffffffffff2';
  RAISE NOTICE 'PASS D3: UPDATE bỏ ngành của phiếu chưa có dòng được phép (khôi phục lại sau thử)';
END $$;

-- ---------------------------------------------------------------------
-- E. Guard dòng-chứng từ đã siết (P2): sản phẩm chưa phân loại / lệch
--    ngành không được vào chứng từ đã có ngành.
-- ---------------------------------------------------------------------
-- E1: dòng sản phẩm chưa phân loại (STRANGE-1) vào phiếu AUTO_PARTS -> chặn.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.purchase_receipt_items (receipt_id, product_id, qty, unit_cost)
    VALUES ('ffffffff-ffff-ffff-ffff-fffffffffff2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', 1, 1000);
    RAISE EXCEPTION 'FAIL E1: dòng chưa phân loại vào phiếu AUTO_PARTS không bị chặn';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%chưa phân loại ngành hàng%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS E1: dòng chưa phân loại vào phiếu có ngành bị chặn';
  END;
END $$;

-- E2: dòng dầu (OIL-10W40) vào phiếu AUTO_PARTS -> chặn (trộn ngành).
DO $$
BEGIN
  BEGIN
    INSERT INTO public.purchase_receipt_items (receipt_id, product_id, qty, unit_cost)
    VALUES ('ffffffff-ffff-ffff-ffff-fffffffffff2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 1, 1000);
    RAISE EXCEPTION 'FAIL E2: dòng dầu vào phiếu AUTO_PARTS không bị chặn';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Không được trộn ngành hàng%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS E2: dòng lệch ngành vào phiếu bị chặn';
  END;
END $$;

-- E3: dòng phụ tùng (WG9725190102) vào phiếu AUTO_PARTS -> được.
INSERT INTO public.purchase_receipt_items (receipt_id, product_id, qty, unit_cost)
VALUES ('ffffffff-ffff-ffff-ffff-fffffffffff2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 1, 1000);

-- E4: dòng lô dầu (qua batch) vào phiếu gửi ký gửi AUTO_PARTS -> chặn.
INSERT INTO public.consignment_out_slips (id, partner_id, slip_date, status, business_line_id)
SELECT 'ffffffff-ffff-ffff-ffff-fffffffffff3', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-11-23', 'DRAFT', id
  FROM public.business_lines WHERE code = 'AUTO_PARTS';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.consignment_out_items (slip_id, batch_id, from_location_id, qty, term, transfer_price)
    VALUES ('ffffffff-ffff-ffff-ffff-fffffffffff3', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 1, 'CONSIGNMENT', 60000);
    RAISE EXCEPTION 'FAIL E3: dòng lô dầu vào phiếu GK AUTO_PARTS không bị chặn';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Không được trộn ngành hàng%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS E3: dòng lô dầu vào phiếu GK AUTO_PARTS bị chặn';
  END;
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.purchase_receipt_items WHERE receipt_id = 'ffffffff-ffff-ffff-ffff-fffffffffff2') <> 1 THEN
    RAISE EXCEPTION 'FAIL E4: phiếu thử không có đúng 1 dòng hợp lệ';
  END IF;
  RAISE NOTICE 'PASS E4: phiếu thử chỉ giữ đúng 1 dòng cùng ngành';
END $$;

-- ---------------------------------------------------------------------
-- F. Bất biến tài chính (không đổi sau 0026).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_payables integer; v_receivables integer; v_payments integer; v_movements integer;
BEGIN
  SELECT count(*) INTO v_payables FROM public.supplier_payables;
  SELECT count(*) INTO v_receivables FROM public.partner_receivables;
  SELECT count(*) INTO v_payments FROM public.payments;
  SELECT count(*) INTO v_movements FROM public.stock_movements;
  IF v_payables <> 0 OR v_receivables <> 1 OR v_payments <> 1 OR v_movements <> 0 THEN
    RAISE EXCEPTION 'FAIL F1: financial invariant changed: payables=% receivables=% payments=% movements=% (expect 0/1/1/0)',
      v_payables, v_receivables, v_payments, v_movements;
  END IF;
  RAISE NOTICE 'PASS F: bất biến tài chính 0/1/1/0 không đổi';
END $$;

-- ---------------------------------------------------------------------
-- G. Idempotency: chạy lại 0026 phải exit 0 và không tạo trùng gán.
--    (Chạy bằng tay sau file này: psql -f 0026 ... — ghi nhận ở đây để
--    người chạy không quên; assertion số dòng gán kiểm tra ngay dưới.)
-- ---------------------------------------------------------------------
DO $$
DECLARE v_auto integer;
BEGIN
  SELECT count(*) INTO v_auto FROM public.user_business_lines ubl
    JOIN public.business_lines bl ON bl.id = ubl.business_line_id
   WHERE bl.code = 'AUTO_PARTS';
  IF v_auto <> 5 THEN RAISE EXCEPTION 'FAIL G1: AUTO_PARTS assignments=% (expect 5)', v_auto; END IF;
  RAISE NOTICE 'PASS G: đúng 5 dòng gán AUTO_PARTS (idempotent — chạy lại 0026 không tạo trùng)';
END $$;

-- ---------------------------------------------------------------------
-- H. v_product_stock có cột business_line_id (§6b — xuất Excel theo ngành).
-- ---------------------------------------------------------------------
DO $$
DECLARE v_auto integer; v_oil integer; v_null integer;
BEGIN
  SELECT count(*) INTO v_auto FROM public.v_product_stock WHERE business_line_id = (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS');
  SELECT count(*) INTO v_oil FROM public.v_product_stock WHERE business_line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL');
  SELECT count(*) INTO v_null FROM public.v_product_stock WHERE business_line_id IS NULL;
  -- Seed P1: 3 sản phẩm AUTO_PARTS (a1/a2/a7, gồm 2 bẫy tên), 2 OIL (a3/a4),
  -- 2 chưa phân loại (a5/a6) — xem p1_seed_local.sql.
  IF v_auto <> 3 OR v_oil <> 2 OR v_null <> 2 THEN
    RAISE EXCEPTION 'FAIL H1: v_product_stock theo ngành AUTO_PARTS=% OIL=% NULL=% (expect 3/2/2)', v_auto, v_oil, v_null;
  END IF;
  RAISE NOTICE 'PASS H: v_product_stock có business_line_id (AUTO_PARTS=3, OIL=2, NULL=2)';
END $$;

-- Dọn dữ liệu thử (phiếu/slip thử chỉ phục vụ kiểm chứng, không phải dữ liệu thật).
DELETE FROM public.purchase_receipt_items WHERE receipt_id = 'ffffffff-ffff-ffff-ffff-fffffffffff2';
DELETE FROM public.purchase_receipts WHERE id = 'ffffffff-ffff-ffff-ffff-fffffffffff2';
DELETE FROM public.consignment_out_slips WHERE id = 'ffffffff-ffff-ffff-ffff-fffffffffff3';
-- Dọn tài khoản kiểm chứng C7 (test-kho-dau / test-kho-chuagan).
DELETE FROM public.user_business_lines WHERE user_id IN ('12121212-1212-1212-1212-121212121212', '34343434-3434-3434-3434-343434343434');
DELETE FROM public.profiles WHERE id IN ('12121212-1212-1212-1212-121212121212', '34343434-3434-3434-3434-343434343434');
DELETE FROM auth.users WHERE id IN ('12121212-1212-1212-1212-121212121212', '34343434-3434-3434-3434-343434343434');

DO $$ BEGIN
  RAISE NOTICE 'P2 TEST DONE: PASS A–H toàn bộ';
END $$;
