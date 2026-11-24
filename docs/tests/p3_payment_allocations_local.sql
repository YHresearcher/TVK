-- =====================================================================
-- p3_payment_allocations_local.sql — Kiểm chứng migration 0027 (TVK V2.0 P3)
-- trên database local (KHÔNG phải live).
--
-- CHẠY (thứ tự bắt buộc):
--   1. Database local trống -> p2_setup_local.sql
--   2. Áp 0001–0026
--   3. psql -v ON_ERROR_STOP=1 -f docs/tests/p1_seed_local.sql
--   4. psql -v ON_ERROR_STOP=1 -f supabase/migrations/0025_business_lines.sql
--   5. psql -v ON_ERROR_STOP=1 -f docs/tests/p2_seed_local.sql
--   6. psql -v ON_ERROR_STOP=1 -f supabase/migrations/0026_default_assignments_fail_closed.sql
--   7. psql -v ON_ERROR_STOP=1 -f docs/tests/p3_seed_local.sql
--   8. psql -v ON_ERROR_STOP=1 -f supabase/migrations/0027_payment_allocations_reversal.sql
--   9. psql -v ON_ERROR_STOP=1 -f docs/tests/p3_payment_allocations_local.sql
-- Mọi assertion fail đều RAISE EXCEPTION (psql dừng ngay nhờ ON_ERROR_STOP).
-- Chạy bằng role postgres (superuser) — các khối mô phỏng role dùng
-- SET LOCAL ROLE authenticated + JWT giả (mẫu p0/p2).
--
-- Quy ước UUID (p1/p2/p3 seed):
--   OWNER 158a181e-f50e-43ef-92b2-4841bdf468aa | ACCOUNTING ketoan eb78abc2-584f-45b8-b63f-11c38f4299d0
--   R-a1 ffffffff-ffff-ffff-ffff-ffffffffffa1 (300.000, đã thu 100.000)
--   PT-SEED-0001 ffffffff-ffff-ffff-ffff-ffffffffffa2 (thu 100.000, R-a1)
--   R-OIL 33333333-3333-3333-3333-333333333304 (200.000, BH-SEED-0003 dầu)
--   R-PART2 33333333-3333-3333-3333-333333333308 (200.000, BH-SEED-0004 phụ tùng)
--   PAY-P1 33333333-3333-3333-3333-333333333311 (2.000.000, mua PN1 thuần phụ tùng)
--   PAY-P2 33333333-3333-3333-3333-333333333312 (350.000, mua PN2 HỖN HỢP — kiểm chứng âm)
--   PAY-KG 33333333-3333-3333-3333-333333333313 (300.000, ký gửi đã bán)
--   DS-PARTNER 33333333-3333-3333-3333-333333333314 (R-a1 200.000 + R-PART2 200.000)
--   DS-SUPPLIER 33333333-3333-3333-3333-333333333317 (PAY-P1 2.000.000 + PAY-KG 300.000)
--   Quỹ 'Két tiền mặt' (seed 0022, số dư đầu kỳ 0).
-- =====================================================================

-- Bảng tạm giữ id các phiếu tạo trong file kiểm chứng (DO block không
-- chia sẻ biến với nhau).
CREATE TEMP TABLE IF NOT EXISTS p3_ids (key text PRIMARY KEY, val uuid);
-- Các khối mô phỏng role (SET LOCAL ROLE authenticated) cũng cần đọc p3_ids.
GRANT ALL ON TABLE p3_ids TO authenticated;

-- Quỹ kiểm chứng: Két tiền mặt (0022 seed) + 1 tài khoản ngân hàng thử.
INSERT INTO public.cash_funds (id, name, kind, opening_balance)
SELECT '44444444-4444-4444-4444-444444444444', 'TK test', 'BANK', 0
WHERE NOT EXISTS (SELECT 1 FROM public.cash_funds WHERE id = '44444444-4444-4444-4444-444444444444');

-- ---------------------------------------------------------------------
-- A. Backfill: phiếu lịch sử PT-SEED-0001 có đúng 1 phân bổ (BL-021 nền).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_alloc integer; v_amt numeric; v_line uuid; v_oil uuid; v_parts uuid; v_sum numeric;
BEGIN
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  SELECT count(*), coalesce(sum(amount), 0) INTO v_alloc, v_amt
    FROM public.payment_allocations WHERE payment_id = 'ffffffff-ffff-ffff-ffff-ffffffffffa2';
  IF v_alloc <> 1 THEN RAISE EXCEPTION 'FAIL A1: backfill allocations cho PT-SEED-0001=% (expect 1)', v_alloc; END IF;
  IF v_amt <> 100000 THEN RAISE EXCEPTION 'FAIL A2: backfill amount=% (expect 100000)', v_amt; END IF;
  SELECT business_line_id INTO v_line FROM public.payment_allocations
   WHERE payment_id = 'ffffffff-ffff-ffff-ffff-ffffffffffa2';
  IF v_line <> v_parts THEN RAISE EXCEPTION 'FAIL A3: backfill line không phải AUTO_PARTS'; END IF;
  IF v_line = v_oil THEN RAISE EXCEPTION 'FAIL A4: backfill line nhầm OIL'; END IF;
  SELECT coalesce(sum(amount), 0) INTO v_sum FROM public.payment_allocations
   WHERE receivable_id = 'ffffffff-ffff-ffff-ffff-ffffffffffa1';
  IF v_sum <> 100000 THEN RAISE EXCEPTION 'FAIL A5: SUM(alloc) R-a1=% (expect 100000 = amount_paid)', v_sum; END IF;
  RAISE NOTICE 'PASS A: backfill PT-SEED-0001 -> 1 phân bổ 100.000 AUTO_PARTS, SUM(alloc)=amount_paid';
END $$;

-- ---------------------------------------------------------------------
-- B. Thanh toán trực tiếp mới: ghi phân bổ + cập nhật công nợ + quỹ.
--    B1: thu 50.000 cho R-PART2 (quỹ Két).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fund uuid; v_pay uuid; v_alloc integer; v_paid numeric; v_st text; v_mov integer; v_amt numeric;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  INSERT INTO public.payments (payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
  VALUES ('IN', '2026-09-10', 50000, 'BANK', '33333333-3333-3333-3333-333333333308', v_fund, 'B1 test', 'eb78abc2-584f-45b8-b63f-11c38f4299d0')
  RETURNING id INTO v_pay;
  INSERT INTO p3_ids VALUES ('B1', v_pay) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;

  SELECT count(*), coalesce(sum(amount), 0) INTO v_alloc, v_amt
    FROM public.payment_allocations WHERE payment_id = v_pay;
  IF v_alloc <> 1 THEN RAISE EXCEPTION 'FAIL B1: allocations=% (expect 1)', v_alloc; END IF;
  IF v_amt <> 50000 THEN RAISE EXCEPTION 'FAIL B2: alloc amount=% (expect 50000)', v_amt; END IF;
  SELECT amount_paid, status INTO v_paid, v_st FROM public.partner_receivables
   WHERE id = '33333333-3333-3333-3333-333333333308';
  IF v_paid <> 50000 THEN RAISE EXCEPTION 'FAIL B3: R-PART2 amount_paid=% (expect 50000)', v_paid; END IF;
  IF v_st <> 'PARTIAL' THEN RAISE EXCEPTION 'FAIL B4: R-PART2 status=% (expect PARTIAL)', v_st; END IF;
  SELECT count(*), coalesce(sum(amount), 0) INTO v_mov, v_amt
    FROM public.cash_movements WHERE payment_id = v_pay;
  IF v_mov <> 1 THEN RAISE EXCEPTION 'FAIL B5: cash movements=% (expect 1)', v_mov; END IF;
  IF v_amt <> 50000 THEN RAISE EXCEPTION 'FAIL B6: cash amount=% (expect +50000)', v_amt; END IF;
  RAISE NOTICE 'PASS B: thu trực tiếp 50.000 -> 1 phân bổ + R-PART2 PARTIAL + quỹ +50.000';
END $$;

-- ---------------------------------------------------------------------
-- C. Thanh toán đợt đối soát: phân bổ theo thứ tự dòng (0019) + ghi
--    settlement_line_id. C1: thu 250.000 cho DS-PARTNER (R-a1 còn
--    200.000 -> 200.000, R-PART2 còn 150.000 -> 50.000).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fund uuid; v_pay uuid; v_n integer;
  v_a1 numeric; v_p2 numeric; v_a1paid numeric; v_a1st text; v_p2paid numeric; v_p2st text;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  INSERT INTO public.payments (payment_kind, payment_date, amount, method, settlement_id, fund_id, note, created_by)
  VALUES ('IN', '2026-09-11', 250000, 'BANK', '33333333-3333-3333-3333-333333333314', v_fund, 'C1 test', 'eb78abc2-584f-45b8-b63f-11c38f4299d0')
  RETURNING id INTO v_pay;
  INSERT INTO p3_ids VALUES ('C1', v_pay) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;

  SELECT count(*) INTO v_n FROM public.payment_allocations WHERE payment_id = v_pay;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL C1: allocations=% (expect 2 dòng)', v_n; END IF;
  SELECT coalesce(sum(amount), 0) INTO v_a1 FROM public.payment_allocations
   WHERE payment_id = v_pay AND receivable_id = 'ffffffff-ffff-ffff-ffff-ffffffffffa1';
  SELECT coalesce(sum(amount), 0) INTO v_p2 FROM public.payment_allocations
   WHERE payment_id = v_pay AND receivable_id = '33333333-3333-3333-3333-333333333308';
  IF v_a1 <> 200000 THEN RAISE EXCEPTION 'FAIL C2: alloc R-a1=% (expect 200000)', v_a1; END IF;
  IF v_p2 <> 50000 THEN RAISE EXCEPTION 'FAIL C3: alloc R-PART2=% (expect 50000)', v_p2; END IF;
  SELECT amount_paid, status INTO v_a1paid, v_a1st FROM public.partner_receivables
   WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffa1';
  SELECT amount_paid, status INTO v_p2paid, v_p2st FROM public.partner_receivables
   WHERE id = '33333333-3333-3333-3333-333333333308';
  IF v_a1paid <> 300000 OR v_a1st <> 'PAID' THEN
    RAISE EXCEPTION 'FAIL C4: R-a1 paid=% status=% (expect 300000/PAID)', v_a1paid, v_a1st;
  END IF;
  IF v_p2paid <> 100000 OR v_p2st <> 'PARTIAL' THEN
    RAISE EXCEPTION 'FAIL C5: R-PART2 paid=% status=% (expect 100000/PARTIAL)', v_p2paid, v_p2st;
  END IF;
  RAISE NOTICE 'PASS C: thu DS 250.000 -> 2 phân bổ (200.000 + 50.000), R-a1 PAID, R-PART2 100.000';
END $$;

-- ---------------------------------------------------------------------
-- D. BL-023: trả thừa bị chặn (giữ hành vi 0019, E6) — trực tiếp + DS.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fund uuid; v_before numeric;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  -- D1: thu trực tiếp vượt R-OIL (còn 200.000, thu 200.001).
  BEGIN
    INSERT INTO public.payments (payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
    VALUES ('IN', '2026-09-11', 200001, 'BANK', '33333333-3333-3333-3333-333333333304', v_fund, 'D1 overpay', 'eb78abc2-584f-45b8-b63f-11c38f4299d0');
    RAISE EXCEPTION 'FAIL D1: overpay trực tiếp không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%vượt quá công nợ còn lại của khoản phải thu%' THEN RAISE; END IF;
  END;
  SELECT amount_paid INTO v_before FROM public.partner_receivables
   WHERE id = '33333333-3333-3333-3333-333333333304';
  IF v_before <> 0 THEN RAISE EXCEPTION 'FAIL D2: R-OIL bị đổi sau overpay fail (paid=%)', v_before; END IF;
  -- D3: thu DS vượt (DS-PARTNER còn 150.000, thu 150.001).
  BEGIN
    INSERT INTO public.payments (payment_kind, payment_date, amount, method, settlement_id, fund_id, note, created_by)
    VALUES ('IN', '2026-09-11', 150001, 'BANK', '33333333-3333-3333-3333-333333333314', v_fund, 'D3 overpay DS', 'eb78abc2-584f-45b8-b63f-11c38f4299d0');
    RAISE EXCEPTION 'FAIL D3: overpay DS không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%vượt quá tổng công nợ còn lại của đợt đối soát%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS D (BL-023): trả thừa trực tiếp + DS đều bị chặn, số dư không đổi';
END $$;

-- ---------------------------------------------------------------------
-- E. BL-021: đảo thanh toán đợt đối soát (ACCOUNTING-only) — khôi phục
--    đúng từng khoản, phân bổ gương âm, quỹ về lại.
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb78abc2-584f-45b8-b63f-11c38f4299d0', true);
DO $$
DECLARE
  v_c1 uuid; v_rev uuid; v_fund uuid; v_bal_before numeric; v_bal_after numeric;
  v_a1paid numeric; v_a1st text; v_p2paid numeric; v_p2st text; v_n integer;
  v_mirror numeric; v_rev_mov integer; v_rev_amt numeric; v_orig_cancelled boolean;
  v_rev_kind text; v_rev_amt2 numeric; v_rev_fund uuid;
BEGIN
  SELECT val INTO v_c1 FROM p3_ids WHERE key = 'C1';
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  SELECT coalesce(balance, 0) INTO v_bal_before FROM public.v_cash_fund_balances WHERE fund_id = v_fund;

  SELECT public.reverse_payment(v_c1, 'Kiểm chứng BL-021: đảo thu DS 250.000') INTO v_rev;
  INSERT INTO p3_ids VALUES ('C1-REV', v_rev) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;

  -- E1: phiếu đảo đúng hình dạng (kind đảo, số tiền bằng, cùng quỹ, reversal_of_id).
  SELECT payment_kind, amount, fund_id, reversal_of_id INTO v_rev_kind, v_rev_amt2, v_rev_fund, v_rev
    FROM public.payments WHERE id = (SELECT val FROM p3_ids WHERE key = 'C1-REV');
  IF v_rev_kind <> 'OUT' THEN RAISE EXCEPTION 'FAIL E1: reversal kind=% (expect OUT)', v_rev_kind; END IF;
  IF v_rev_amt2 <> 250000 THEN RAISE EXCEPTION 'FAIL E2: reversal amount=% (expect 250000)', v_rev_amt2; END IF;
  IF v_rev_fund <> v_fund THEN RAISE EXCEPTION 'FAIL E3: reversal fund khác quỹ gốc'; END IF;
  IF v_rev <> v_c1 THEN RAISE EXCEPTION 'FAIL E4: reversal_of_id không trỏ phiếu gốc'; END IF;

  -- E5: R-a1 về 100.000 PARTIAL, R-PART2 về 50.000 PARTIAL.
  SELECT amount_paid, status INTO v_a1paid, v_a1st FROM public.partner_receivables
   WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffa1';
  SELECT amount_paid, status INTO v_p2paid, v_p2st FROM public.partner_receivables
   WHERE id = '33333333-3333-3333-3333-333333333308';
  IF v_a1paid <> 100000 OR v_a1st <> 'PARTIAL' THEN
    RAISE EXCEPTION 'FAIL E5: R-a1 paid=% status=% (expect 100000/PARTIAL)', v_a1paid, v_a1st;
  END IF;
  IF v_p2paid <> 50000 OR v_p2st <> 'PARTIAL' THEN
    RAISE EXCEPTION 'FAIL E6: R-PART2 paid=% status=% (expect 50000/PARTIAL)', v_p2paid, v_p2st;
  END IF;

  -- E7: 2 phân bổ gương âm, mỗi dòng trỏ đúng phân bổ gốc.
  SELECT count(*), coalesce(sum(amount), 0) INTO v_n, v_mirror FROM public.payment_allocations
   WHERE payment_id = (SELECT val FROM p3_ids WHERE key = 'C1-REV');
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL E7: mirror allocations=% (expect 2)', v_n; END IF;
  IF v_mirror <> -250000 THEN RAISE EXCEPTION 'FAIL E8: mirror sum=% (expect -250000)', v_mirror; END IF;
  IF EXISTS (SELECT 1 FROM public.payment_allocations WHERE payment_id = (SELECT val FROM p3_ids WHERE key = 'C1-REV') AND reversal_of_id IS NULL) THEN
    RAISE EXCEPTION 'FAIL E9: phân bổ gương thiếu reversal_of_id';
  END IF;

  -- E10: quỹ về lại đúng số trước C1 (chênh đúng 250.000).
  SELECT coalesce(balance, 0) INTO v_bal_after FROM public.v_cash_fund_balances WHERE fund_id = v_fund;
  IF v_bal_after <> v_bal_before - 250000 THEN
    RAISE EXCEPTION 'FAIL E10: fund balance sau đảo=% (expect %)', v_bal_after, v_bal_before - 250000;
  END IF;
  -- E11: dòng tiền đảo kind=REVERSAL, số âm, payment_id = phiếu đảo (E7).
  SELECT count(*), coalesce(sum(amount), 0) INTO v_rev_mov, v_rev_amt FROM public.cash_movements
   WHERE payment_id = (SELECT val FROM p3_ids WHERE key = 'C1-REV');
  IF v_rev_mov <> 1 THEN RAISE EXCEPTION 'FAIL E11: reversal cash movements=% (expect 1)', v_rev_mov; END IF;
  IF v_rev_amt <> -250000 THEN RAISE EXCEPTION 'FAIL E12: reversal cash amount=% (expect -250000)', v_rev_amt; END IF;
  -- E13: dòng tiền gốc bị đánh dấu hủy.
  SELECT is_cancelled INTO v_orig_cancelled FROM public.cash_movements WHERE payment_id = v_c1;
  IF NOT coalesce(v_orig_cancelled, false) THEN RAISE EXCEPTION 'FAIL E13: dòng tiền gốc chưa is_cancelled'; END IF;
  -- E14: phiếu gốc + đợt đối soát + dòng DS còn nguyên.
  IF (SELECT count(*) FROM public.payments WHERE id = v_c1) <> 1 THEN RAISE EXCEPTION 'FAIL E14: phiếu gốc biến mất'; END IF;
  IF (SELECT count(*) FROM public.settlement_lines WHERE settlement_id = '33333333-3333-3333-3333-333333333314') <> 2 THEN
    RAISE EXCEPTION 'FAIL E15: dòng DS bị đổi sau đảo';
  END IF;
  RAISE NOTICE 'PASS E (BL-021): đảo thu DS 250.000 — khôi phục đúng 2 khoản, gương âm, quỹ về lại';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- F. Đảo thanh toán trực tiếp: B1 (50.000 R-PART2) -> R-PART2 về 0 UNPAID.
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb78abc2-584f-45b8-b63f-11c38f4299d0', true);
DO $$
DECLARE
  v_b1 uuid; v_rev uuid; v_paid numeric; v_st text; v_n integer; v_sum numeric;
BEGIN
  SELECT val INTO v_b1 FROM p3_ids WHERE key = 'B1';
  SELECT public.reverse_payment(v_b1, 'Kiểm chứng F: đảo thu trực tiếp 50.000') INTO v_rev;
  INSERT INTO p3_ids VALUES ('B1-REV', v_rev) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  SELECT amount_paid, status INTO v_paid, v_st FROM public.partner_receivables
   WHERE id = '33333333-3333-3333-3333-333333333308';
  IF v_paid <> 0 OR v_st <> 'UNPAID' THEN
    RAISE EXCEPTION 'FAIL F1: R-PART2 paid=% status=% (expect 0/UNPAID)', v_paid, v_st;
  END IF;
  SELECT count(*), coalesce(sum(amount), 0) INTO v_n, v_sum FROM public.payment_allocations
   WHERE payment_id = v_rev;
  IF v_n <> 1 OR v_sum <> -50000 THEN
    RAISE EXCEPTION 'FAIL F2: mirror allocations=% sum=% (expect 1/-50000)', v_n, v_sum;
  END IF;
  RAISE NOTICE 'PASS F: đảo thu trực tiếp 50.000 — R-PART2 về 0 UNPAID, gương -50.000';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- G. Đảo trùng / đảo phiếu đảo bị chặn (fail-closed, §12.5).
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb78abc2-584f-45b8-b63f-11c38f4299d0', true);
DO $$
DECLARE
  v_c1 uuid; v_rev uuid;
BEGIN
  SELECT val INTO v_c1 FROM p3_ids WHERE key = 'C1';
  SELECT val INTO v_rev FROM p3_ids WHERE key = 'C1-REV';
  BEGIN
    PERFORM public.reverse_payment(v_c1, 'Đảo lần 2');
    RAISE EXCEPTION 'FAIL G1: đảo trùng không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%đã được đảo%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.reverse_payment(v_rev, 'Đảo phiếu đảo');
    RAISE EXCEPTION 'FAIL G2: đảo phiếu đảo không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%bút toán đảo%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS G: đảo trùng + đảo phiếu đảo đều bị chặn';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- H. E7 hồi quy: phiếu đảo có payment_id RIÊNG — không copy payment_id
--    gốc (UNIQUE không bị vi phạm, dòng tiền đảo ghi đúng phiếu đảo).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_c1 uuid; v_rev uuid; v_orig_pay uuid; v_rev_pay uuid;
BEGIN
  SELECT val INTO v_c1 FROM p3_ids WHERE key = 'C1';
  SELECT val INTO v_rev FROM p3_ids WHERE key = 'C1-REV';
  SELECT payment_id INTO v_orig_pay FROM public.cash_movements WHERE payment_id = v_c1;
  SELECT payment_id INTO v_rev_pay FROM public.cash_movements
   WHERE payment_id = v_rev AND movement_kind = 'REVERSAL';
  IF v_orig_pay IS NULL THEN RAISE EXCEPTION 'FAIL H1: thiếu dòng tiền gốc'; END IF;
  IF v_rev_pay IS NULL THEN RAISE EXCEPTION 'FAIL H2: thiếu dòng tiền đảo'; END IF;
  IF v_rev_pay = v_orig_pay THEN RAISE EXCEPTION 'FAIL H3: dòng tiền đảo copy payment_id gốc (E7 tái phát)'; END IF;
  IF (SELECT count(*) FROM public.cash_movements WHERE payment_id IN (v_c1, v_rev)) <> 2 THEN
    RAISE EXCEPTION 'FAIL H4: số dòng tiền cho cặp gốc+đảo <> 2';
  END IF;
  RAISE NOTICE 'PASS H (E7): dòng tiền đảo có payment_id riêng, không copy gốc';
END $$;

-- ---------------------------------------------------------------------
-- I. BL-022: OWNER ghi trực tiếp cash_movements bị chặn (RLS sau 0027).
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_fund uuid; v_mid uuid; v_state text; v_code text;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  SELECT id INTO v_mid FROM public.cash_movements LIMIT 1;
  -- I1: INSERT trực tiếp (kể cả OWNER) -> 42501.
  BEGIN
    INSERT INTO public.cash_movements (fund_id, amount, movement_date, movement_kind, note, created_by)
    VALUES (v_fund, 1000, '2026-09-12', 'OPERATING', 'I1 direct insert', '158a181e-f50e-43ef-92b2-4841bdf468aa');
    RAISE EXCEPTION 'FAIL I1: OWNER INSERT trực tiếp cash_movements không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  -- I2: UPDATE trực tiếp -> 42501 (RLS) hoặc P0001 (guard trigger).
  BEGIN
    UPDATE public.cash_movements SET amount = amount + 1 WHERE id = v_mid;
    RAISE EXCEPTION 'FAIL I2: OWNER UPDATE trực tiếp cash_movements không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE NOT IN ('42501', 'P0001') THEN RAISE; END IF;
  END;
  -- I3: DELETE trực tiếp -> 42501 (không có policy DELETE) hoặc P0001 (guard).
  BEGIN
    DELETE FROM public.cash_movements WHERE id = v_mid;
    RAISE EXCEPTION 'FAIL I3: OWNER DELETE trực tiếp cash_movements không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE NOT IN ('42501', 'P0001') THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS I (BL-022): OWNER ghi/sửa/xóa trực tiếp cash_movements đều bị chặn';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- J. Bất biến payments: UPDATE/DELETE trực tiếp bị chặn với mọi role
--    (kể cả postgres superuser — guard trigger, §12.2).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_pay uuid;
BEGIN
  SELECT val INTO v_pay FROM p3_ids WHERE key = 'B1';
  BEGIN
    UPDATE public.payments SET amount = 1 WHERE id = v_pay;
    RAISE EXCEPTION 'FAIL J1: UPDATE payments không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Không được sửa/xoá phiếu thu/chi%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.payments WHERE id = v_pay;
    RAISE EXCEPTION 'FAIL J2: DELETE payments không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Không được sửa/xoá phiếu thu/chi%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS J: payments bất biến (UPDATE/DELETE bị chặn)';
END $$;

-- ---------------------------------------------------------------------
-- K. Thiết kế lại cancel_cash_movement_reversal (E7).
--    K1: dòng tiền gắn phiếu thanh toán -> TỪ CHỐI, chỉ đảo ở phiếu.
--    K2: dòng OPERATING (qua RPC) -> hủy được, dòng đảo không copy payment_id.
--    K3: chuyển quỹ nội bộ -> hủy được, cả 2 chân đều đảo, không copy payment_id.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fund uuid; v_pay uuid; v_mov uuid;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  -- K1: phiếu thu mới cho R-OIL (100.000), rồi thử hủy dòng tiền của nó.
  INSERT INTO public.payments (payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
  VALUES ('IN', '2026-09-12', 100000, 'BANK', '33333333-3333-3333-3333-333333333304', v_fund, 'K1 test', 'eb78abc2-584f-45b8-b63f-11c38f4299d0')
  RETURNING id INTO v_pay;
  INSERT INTO p3_ids VALUES ('K1', v_pay) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  SELECT id INTO v_mov FROM public.cash_movements WHERE payment_id = v_pay;
  IF v_mov IS NULL THEN RAISE EXCEPTION 'FAIL K0: thiếu dòng tiền cho phiếu K1'; END IF;
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_mov uuid; v_op uuid; v_op_mov uuid; v_cat uuid; v_fund uuid; v_bank uuid;
  v_tr uuid; v_src uuid; v_cnt uuid; v_rev uuid; v_pay uuid;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  SELECT id INTO v_bank FROM public.cash_funds WHERE name = 'TK test' LIMIT 1;
  SELECT val INTO v_pay FROM p3_ids WHERE key = 'K1';
  SELECT id INTO v_mov FROM public.cash_movements WHERE payment_id = v_pay;
  -- K1: hủy dòng tiền gắn phiếu thanh toán -> phải từ chối.
  BEGIN
    PERFORM public.cancel_cash_movement_reversal(v_mov, 'Thử hủy dòng tiền phiếu thanh toán');
    RAISE EXCEPTION 'FAIL K1: hủy dòng tiền gắn phiếu thanh toán không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%phiếu thanh toán%' THEN RAISE; END IF;
  END;
  -- K2: tạo dòng OPERATING qua RPC rồi hủy.
  SELECT id INTO v_cat FROM public.cash_categories WHERE code = 'CHI_KHAC' LIMIT 1;
  SELECT public.record_operating_cash_movement(v_fund, v_cat, 10000, '2026-09-12', 'K2 operating test') INTO v_op_mov;
  SELECT id INTO v_op FROM public.cash_movements WHERE id = v_op_mov;
  IF v_op IS NULL THEN RAISE EXCEPTION 'FAIL K2a: RPC không tạo dòng OPERATING'; END IF;
  SELECT public.cancel_cash_movement_reversal(v_op, 'Hủy chi vận hành thử') INTO v_rev;
  IF (SELECT payment_id FROM public.cash_movements WHERE id = v_rev) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL K2b: dòng đảo OPERATING copy payment_id (E7)';
  END IF;
  IF (SELECT reversal_of_id FROM public.cash_movements WHERE id = v_rev) <> v_op THEN
    RAISE EXCEPTION 'FAIL K2c: dòng đảo OPERATING không trỏ dòng gốc';
  END IF;
  -- K3: chuyển quỹ nội bộ rồi hủy (cả 2 chân).
  SELECT public.transfer_internal_cash_funds(v_fund, v_bank, 50000, '2026-09-12', 'K3 transfer test') INTO v_tr;
  SELECT id INTO v_src FROM public.cash_movements WHERE transfer_id = v_tr AND fund_id = v_fund;
  SELECT id INTO v_cnt FROM public.cash_movements WHERE transfer_id = v_tr AND fund_id = v_bank;
  IF v_src IS NULL OR v_cnt IS NULL THEN RAISE EXCEPTION 'FAIL K3a: thiếu 2 chân chuyển quỹ'; END IF;
  SELECT public.cancel_cash_movement_reversal(v_src, 'Hủy chuyển quỹ thử') INTO v_rev;
  IF (SELECT count(*) FROM public.cash_movements WHERE reversal_of_id IN (v_src, v_cnt)) <> 2 THEN
    RAISE EXCEPTION 'FAIL K3b: hủy chuyển quỹ không đảo đủ 2 chân';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_movements WHERE reversal_of_id IN (v_src, v_cnt) AND payment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL K3c: dòng đảo chuyển quỹ copy payment_id (E7)';
  END IF;
  RAISE NOTICE 'PASS K: cancel redesign — gắn phiếu thanh toán thì từ chối; OPERATING + chuyển quỹ hủy đúng, không copy payment_id';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- L. Đảo đợt đối soát XUYÊN NGÀNH (§12.9): mỗi khoản khôi phục đúng
--    ngành của mình.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_oil uuid; v_parts uuid; v_fund uuid;
  v_ds uuid;
BEGIN
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  -- 2 chứng từ mới: BH dầu 100.000 + BH phụ tùng 100.000, cùng đối tác Á Âu.
  INSERT INTO public.sales_orders (id, doc_code, partner_id, order_date, status) VALUES
    ('55555555-5555-5555-5555-555555555501', 'DH-SEED-0005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-12', 'DRAFT'),
    ('55555555-5555-5555-5555-555555555502', 'DH-SEED-0006', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-12', 'DRAFT');
  INSERT INTO public.sales_documents (id, doc_code, doc_kind, sales_order_id, partner_id, doc_date, total_amount, status, business_line_id) VALUES
    ('55555555-5555-5555-5555-555555555503', 'BH-SEED-0005', 'BH', '55555555-5555-5555-5555-555555555501', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-12', 100000, 'DRAFT', v_oil),
    ('55555555-5555-5555-5555-555555555504', 'BH-SEED-0006', 'BH', '55555555-5555-5555-5555-555555555502', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '2026-09-12', 100000, 'DRAFT', v_parts);
  INSERT INTO public.sales_document_lines (id, document_id, product_id, qty, unit_price) VALUES
    ('55555555-5555-5555-5555-555555555505', '55555555-5555-5555-5555-555555555503', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 2, 50000),
    ('55555555-5555-5555-5555-555555555506', '55555555-5555-5555-5555-555555555504', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 1, 100000);
  INSERT INTO public.partner_receivables (id, partner_id, source_document_id, amount, amount_paid, status) VALUES
    ('55555555-5555-5555-5555-555555555507', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '55555555-5555-5555-5555-555555555503', 100000, 0, 'UNPAID'),
    ('55555555-5555-5555-5555-555555555508', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '55555555-5555-5555-5555-555555555504', 100000, 0, 'UNPAID');
  INSERT INTO public.settlements (id, doc_code, party_kind, partner_id, total_amount, status) VALUES
    ('55555555-5555-5555-5555-555555555509', 'DS-SEED-0003', 'PARTNER', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 200000, 'CONFIRMED');
  INSERT INTO public.settlement_lines (id, settlement_id, receivable_id, amount) VALUES
    ('55555555-5555-5555-5555-555555555510', '55555555-5555-5555-5555-555555555509', '55555555-5555-5555-5555-555555555507', 100000),
    ('55555555-5555-5555-5555-555555555511', '55555555-5555-5555-5555-555555555509', '55555555-5555-5555-5555-555555555508', 100000);
  -- Thu DS xuyên ngành 150.000: R-L1 dầu 100.000 + R-L2 phụ tùng 50.000.
  INSERT INTO public.payments (payment_kind, payment_date, amount, method, settlement_id, fund_id, note, created_by)
  VALUES ('IN', '2026-09-12', 150000, 'BANK', '55555555-5555-5555-5555-555555555509', v_fund, 'L1 test', 'eb78abc2-584f-45b8-b63f-11c38f4299d0')
  RETURNING id INTO v_ds;
  INSERT INTO p3_ids VALUES ('L1', v_ds) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  IF (SELECT coalesce(sum(amount), 0) FROM public.payment_allocations WHERE payment_id = v_ds AND receivable_id = '55555555-5555-5555-5555-555555555507') <> 100000 THEN
    RAISE EXCEPTION 'FAIL L1: alloc R-L1 dầu <> 100.000';
  END IF;
  IF (SELECT coalesce(sum(amount), 0) FROM public.payment_allocations WHERE payment_id = v_ds AND receivable_id = '55555555-5555-5555-5555-555555555508') <> 50000 THEN
    RAISE EXCEPTION 'FAIL L2: alloc R-L2 phụ tùng <> 50.000';
  END IF;
  IF (SELECT business_line_id FROM public.payment_allocations WHERE payment_id = v_ds AND receivable_id = '55555555-5555-5555-5555-555555555507') <> v_oil THEN
    RAISE EXCEPTION 'FAIL L3: alloc R-L1 không mang ngành OIL';
  END IF;
  IF (SELECT business_line_id FROM public.payment_allocations WHERE payment_id = v_ds AND receivable_id = '55555555-5555-5555-5555-555555555508') <> v_parts THEN
    RAISE EXCEPTION 'FAIL L4: alloc R-L2 không mang ngành AUTO_PARTS';
  END IF;
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb78abc2-584f-45b8-b63f-11c38f4299d0', true);
DO $$
DECLARE
  v_l1 uuid; v_rev uuid; v_r1paid numeric; v_r1st text; v_r2paid numeric; v_r2st text;
  v_oil uuid; v_parts uuid;
BEGIN
  SELECT val INTO v_l1 FROM p3_ids WHERE key = 'L1';
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  SELECT public.reverse_payment(v_l1, 'Kiểm chứng L: đảo thu DS xuyên ngành') INTO v_rev;
  SELECT amount_paid, status INTO v_r1paid, v_r1st FROM public.partner_receivables WHERE id = '55555555-5555-5555-5555-555555555507';
  SELECT amount_paid, status INTO v_r2paid, v_r2st FROM public.partner_receivables WHERE id = '55555555-5555-5555-5555-555555555508';
  IF v_r1paid <> 0 OR v_r1st <> 'UNPAID' THEN RAISE EXCEPTION 'FAIL L5: R-L1 paid=% status=% (expect 0/UNPAID)', v_r1paid, v_r1st; END IF;
  IF v_r2paid <> 0 OR v_r2st <> 'UNPAID' THEN RAISE EXCEPTION 'FAIL L6: R-L2 paid=% status=% (expect 0/UNPAID)', v_r2paid, v_r2st; END IF;
  IF (SELECT business_line_id FROM public.payment_allocations WHERE payment_id = v_rev AND receivable_id = '55555555-5555-5555-5555-555555555507') <> v_oil THEN
    RAISE EXCEPTION 'FAIL L7: gương R-L1 không mang ngành OIL';
  END IF;
  IF (SELECT business_line_id FROM public.payment_allocations WHERE payment_id = v_rev AND receivable_id = '55555555-5555-5555-5555-555555555508') <> v_parts THEN
    RAISE EXCEPTION 'FAIL L8: gương R-L2 không mang ngành AUTO_PARTS';
  END IF;
  RAISE NOTICE 'PASS L: đảo DS xuyên ngành — mỗi khoản khôi phục đúng ngành của mình';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- M. Đảo sau khi đã có phiếu thanh toán khác (§12.9): chỉ trừ đúng
--    phiếu bị đảo, phiếu sau còn nguyên.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fund uuid; v_a uuid; v_b uuid;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  -- R-PART2 đang 0 sau F. Thu P-A 50.000, rồi P-B 50.000 -> 100.000.
  INSERT INTO public.payments (payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
  VALUES ('IN', '2026-09-12', 50000, 'BANK', '33333333-3333-3333-3333-333333333308', v_fund, 'M-A test', 'eb78abc2-584f-45b8-b63f-11c38f4299d0')
  RETURNING id INTO v_a;
  INSERT INTO p3_ids VALUES ('M-A', v_a) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  INSERT INTO public.payments (payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
  VALUES ('IN', '2026-09-12', 50000, 'BANK', '33333333-3333-3333-3333-333333333308', v_fund, 'M-B test', 'eb78abc2-584f-45b8-b63f-11c38f4299d0')
  RETURNING id INTO v_b;
  INSERT INTO p3_ids VALUES ('M-B', v_b) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  IF (SELECT amount_paid FROM public.partner_receivables WHERE id = '33333333-3333-3333-3333-333333333308') <> 100000 THEN
    RAISE EXCEPTION 'FAIL M0: R-PART2 sau 2 phiếu <> 100.000';
  END IF;
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb78abc2-584f-45b8-b63f-11c38f4299d0', true);
DO $$
DECLARE
  v_a uuid; v_b uuid; v_paid numeric;
BEGIN
  SELECT val INTO v_a FROM p3_ids WHERE key = 'M-A';
  SELECT val INTO v_b FROM p3_ids WHERE key = 'M-B';
  PERFORM public.reverse_payment(v_a, 'Kiểm chứng M: đảo phiếu đầu');
  SELECT amount_paid INTO v_paid FROM public.partner_receivables WHERE id = '33333333-3333-3333-3333-333333333308';
  IF v_paid <> 50000 THEN RAISE EXCEPTION 'FAIL M1: R-PART2 sau đảo P-A=% (expect 50000)', v_paid; END IF;
  IF (SELECT coalesce(sum(amount), 0) FROM public.payment_allocations WHERE payment_id = v_b) <> 50000 THEN
    RAISE EXCEPTION 'FAIL M2: phân bổ của P-B bị đổi sau khi đảo P-A';
  END IF;
  RAISE NOTICE 'PASS M: đảo phiếu đầu sau khi có phiếu sau — chỉ trừ đúng phiếu bị đảo';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- N. Bất biến tài chính cuối: SUM(alloc) = amount_paid mọi khoản;
--    số dư quỹ = mở đầu + tổng dòng tiền; không có phiếu có tham chiếu
--    mà thiếu phân bổ.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_bad integer; v_fund uuid; v_bal numeric; v_calc numeric;
BEGIN
  SELECT count(*) INTO v_bad FROM (
    SELECT pr.id FROM public.partner_receivables pr
     WHERE (SELECT coalesce(sum(amount), 0) FROM public.payment_allocations WHERE receivable_id = pr.id) <> pr.amount_paid
    UNION ALL
    SELECT sp.id FROM public.supplier_payables sp
     WHERE (SELECT coalesce(sum(amount), 0) FROM public.payment_allocations WHERE payable_id = sp.id) <> sp.amount_paid
  ) s;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'FAIL N1: % khoản có SUM(alloc) <> amount_paid', v_bad; END IF;
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  SELECT coalesce(balance, 0) INTO v_bal FROM public.v_cash_fund_balances WHERE fund_id = v_fund;
  SELECT opening_balance + coalesce(sum(amount), 0) INTO v_calc
    FROM public.cash_funds cf LEFT JOIN public.cash_movements cm ON cm.fund_id = cf.id
   WHERE cf.id = v_fund GROUP BY cf.opening_balance;
  IF v_bal <> v_calc THEN RAISE EXCEPTION 'FAIL N2: fund balance=% tính lại=%', v_bal, v_calc; END IF;
  SELECT count(*) INTO v_bad FROM public.payments p
   WHERE (p.payable_id IS NOT NULL OR p.receivable_id IS NOT NULL OR p.settlement_id IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM public.payment_allocations a WHERE a.payment_id = p.id);
  IF v_bad <> 0 THEN RAISE EXCEPTION 'FAIL N3: % phiếu có tham chiếu mà không có phân bổ', v_bad; END IF;
  RAISE NOTICE 'PASS N: SUM(alloc)=amount_paid mọi khoản; số dư quỹ khớp; mọi phiếu có phân bổ';
END $$;

-- ---------------------------------------------------------------------
-- O. Ngành mơ hồ -> fail-closed (§11.3): resolver RAISE cho PAY-P2
--    (phiếu mua PN2 hỗn hợp), và phiếu chi trực tiếp vào PAY-P2 cũng fail.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fund uuid;
BEGIN
  BEGIN
    PERFORM public.tvk_resolve_obligation_line('33333333-3333-3333-3333-333333333312', NULL);
    RAISE EXCEPTION 'FAIL O1: resolver không RAISE cho khoản hỗn hợp';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Không xác định được ngành hàng%' THEN RAISE; END IF;
  END;
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  BEGIN
    INSERT INTO public.payments (payment_kind, payment_date, amount, method, payable_id, fund_id, note, created_by)
    VALUES ('OUT', '2026-09-12', 1000, 'BANK', '33333333-3333-3333-3333-333333333312', v_fund, 'O2 mixed payable', 'eb78abc2-584f-45b8-b63f-11c38f4299d0');
    RAISE EXCEPTION 'FAIL O2: chi vào khoản mua hỗn hợp không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Không xác định được ngành hàng%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS O: khoản hỗn hợp -> fail-closed (resolver + phiếu chi đều RAISE)';
END $$;

-- Tổng kết cuối.
SELECT 'P3 TEST SUMMARY' AS label,
  (SELECT count(*) FROM public.payments) AS payments,
  (SELECT count(*) FROM public.payment_allocations) AS allocations,
  (SELECT count(*) FROM public.payments WHERE reversal_of_id IS NOT NULL) AS reversals,
  (SELECT count(*) FROM public.cash_movements WHERE movement_kind = 'REVERSAL') AS cash_reversals,
  (SELECT count(*) FROM public.cash_movements) AS cash_movements;
