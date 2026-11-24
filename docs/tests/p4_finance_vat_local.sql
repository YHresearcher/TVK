-- =====================================================================
-- p4_finance_vat_local.sql — Kiểm chứng migration 0028 (P4a cutover)
-- + 0029 (P4b finance + VAT) trên database local (KHÔNG phải live).
--
-- CHẠY (thứ tự bắt buộc):
--   1. Database local trống -> p2_setup_local.sql
--   2. Áp 0001–0024, p1_seed, 0025, p2_seed, 0026, p3_seed, 0027
--   3. psql -v ON_ERROR_STOP=1 -f docs/tests/p4_seed_local.sql
--   4. psql -v ON_ERROR_STOP=1 -f supabase/migrations/0028_allocation_cutover.sql
--   5. psql -v ON_ERROR_STOP=1 -f supabase/migrations/0029_finance_vat.sql
--   6. bash /tmp/tvk-p4-verify/p4_concurrency.sh (đồng thời VAT-11)
--   7. psql -v ON_ERROR_STOP=1 -f docs/tests/p4_finance_vat_local.sql
-- Mọi assertion fail đều RAISE EXCEPTION (psql dừng ngay nhờ ON_ERROR_STOP).
-- Chạy bằng role postgres (superuser) — các khối mô phỏng role dùng
-- SET LOCAL ROLE authenticated + JWT giả (mẫu p0/p2/p3).
--
-- Quy ước UUID (p1/p2/p3/p4 seed):
--   OWNER 158a181e-f50e-43ef-92b2-4841bdf468aa | ACCOUNTING ketoan eb78abc2-584f-45b8-b63f-11c38f4299d0
--   Đối tác Á Âu bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2 | Cty Test Khác 5555...5001
--   R-a1 ffffffff-...a1 (300.000, đã thu 100.000) | R-OIL 3333...3304 | R-PART2 3333...3308
--   PAY-P1 3333...3311 (2.000.000 mua thuần PT) | PAY-P2 3333...3312 (350.000 mua HỖN HỢP)
--   PAY-KG 3333...3313 (300.000 ký gửi đã bán)
--   BH-VAT-0001 5555...0201 (AUTO, CK 50.000) | BH-VAT-0002 5555...0202 (OIL)
--   KG-VAT-0001 5555...0203 (AUTO) | BH-VAT-0003 5555...0204 (HỖN HỢP, DRAFT)
--   BH-VAT-0004 5555...0205 (OIL) | BH-VAT-0005 5555...0206 (chưa phân loại)
--   BH-VAT-0006 5555...0207 (OIL, dòng 5555...0309 — VAT đồng thời)
--   BH-VAT-0007 5555...0208 (AUTO) | R-MIX 5555...0403 | R-VAT4 5555...0405
--   Quỹ 'Két tiền mặt' (seed 0022, số dư đầu kỳ 0).
-- =====================================================================

-- Bảng tạm giữ id các phiếu/hoá đơn tạo trong file kiểm chứng (DO block
-- không chia sẻ biến với nhau).
CREATE TEMP TABLE IF NOT EXISTS p4_ids (key text PRIMARY KEY, val uuid);
CREATE TEMP TABLE IF NOT EXISTS p4_base (key text PRIMARY KEY, val numeric);
-- Các khối mô phỏng role (SET LOCAL ROLE authenticated) cũng cần đọc.
GRANT ALL ON TABLE p4_ids TO authenticated;
GRANT ALL ON TABLE p4_base TO authenticated;

-- Baseline tài chính đầu file (trước mọi phiếu P4) để đối chiếu cuối.
INSERT INTO p4_base (key, val) VALUES
  ('rec_open', (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.partner_receivables)),
  ('pay_open', (SELECT coalesce(sum(amount - amount_paid), 0) FROM public.supplier_payables)),
  ('payments', (SELECT count(*) FROM public.payments)),
  ('movements', (SELECT count(*) FROM public.cash_movements))
ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;

-- ---------------------------------------------------------------------
-- A. P4a cấu trúc: trigger không còn cộng dồn, đúng 1 trigger ghi số dư.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fn text; v_trg integer;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_fn
    FROM pg_proc WHERE proname = 'apply_payment_to_balance' AND pronamespace = 'public'::regnamespace;
  IF v_fn IS NULL THEN RAISE EXCEPTION 'FAIL A0: không tìm thấy apply_payment_to_balance'; END IF;
  IF v_fn ILIKE '%amount_paid = amount_paid +%' OR v_fn ILIKE '%amount_paid = amount_paid -%' THEN
    RAISE EXCEPTION 'FAIL A1: trigger vẫn còn phép cộng dồn amount_paid';
  END IF;
  IF v_fn NOT ILIKE '%tvk_recompute_obligation_balance%' THEN
    RAISE EXCEPTION 'FAIL A2: trigger không gọi tvk_recompute_obligation_balance';
  END IF;
  SELECT count(*) INTO v_trg FROM pg_trigger
   WHERE tgrelid = 'public.payments'::regclass AND tgenabled <> 'D' AND tgname = 'trg_payments_apply';
  IF v_trg <> 1 THEN RAISE EXCEPTION 'FAIL A3: trg_payments_apply=% (expect 1)', v_trg; END IF;
  RAISE NOTICE 'PASS A (P4a cutover): trigger ghi số dư duy nhất, tính lại từ phân bổ, không cộng dồn';
END $$;

-- ---------------------------------------------------------------------
-- B. P4a guard: sửa trực tiếp amount_paid/status bị chặn; sửa trường
--    khác (due_date) vẫn được.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_old date;
BEGIN
  SELECT due_date INTO v_old FROM public.partner_receivables WHERE id = '55555555-5555-5555-5555-555555550401';
  BEGIN
    UPDATE public.partner_receivables SET amount_paid = 999 WHERE id = '55555555-5555-5555-5555-555555550401';
    RAISE EXCEPTION 'FAIL B1: UPDATE trực tiếp amount_paid không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%tổng phân bổ%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.partner_receivables SET status = 'PAID' WHERE id = '55555555-5555-5555-5555-555555550401';
    RAISE EXCEPTION 'FAIL B2: UPDATE trực tiếp status sai không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%Trạng thái công nợ%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.supplier_payables SET amount_paid = 1 WHERE id = '33333333-3333-3333-3333-333333333311';
    RAISE EXCEPTION 'FAIL B3: UPDATE trực tiếp amount_paid phải trả không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%tổng phân bổ%' THEN RAISE; END IF;
  END;
  UPDATE public.partner_receivables SET due_date = coalesce(due_date, CURRENT_DATE) + 1 WHERE id = '55555555-5555-5555-5555-555555550401';
  UPDATE public.partner_receivables SET due_date = v_old WHERE id = '55555555-5555-5555-5555-555555550401';
  RAISE NOTICE 'PASS B (P4a guard): sửa trực tiếp số dư/trạng thái bị chặn, sửa due_date vẫn được';
END $$;

-- ---------------------------------------------------------------------
-- C. Backfill ngành cho phải thu/phải trả (BAL-01).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_line uuid; v_oil uuid; v_parts uuid;
BEGIN
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  SELECT business_line_id INTO v_line FROM public.partner_receivables WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffa1';
  IF v_line <> v_parts THEN RAISE EXCEPTION 'FAIL C1: R-a1 line=% (expect AUTO_PARTS)', v_line; END IF;
  SELECT business_line_id INTO v_line FROM public.partner_receivables WHERE id = '33333333-3333-3333-3333-333333333304';
  IF v_line <> v_oil THEN RAISE EXCEPTION 'FAIL C2: R-OIL line không phải OIL'; END IF;
  SELECT business_line_id INTO v_line FROM public.partner_receivables WHERE id = '33333333-3333-3333-3333-333333333308';
  IF v_line <> v_parts THEN RAISE EXCEPTION 'FAIL C3: R-PART2 line không phải AUTO_PARTS'; END IF;
  SELECT business_line_id INTO v_line FROM public.supplier_payables WHERE id = '33333333-3333-3333-3333-333333333311';
  IF v_line <> v_parts THEN RAISE EXCEPTION 'FAIL C4: PAY-P1 line không phải AUTO_PARTS'; END IF;
  SELECT business_line_id INTO v_line FROM public.supplier_payables WHERE id = '33333333-3333-3333-3333-333333333313';
  IF v_line <> v_parts THEN RAISE EXCEPTION 'FAIL C5: PAY-KG line không phải AUTO_PARTS'; END IF;
  SELECT business_line_id INTO v_line FROM public.supplier_payables WHERE id = '33333333-3333-3333-3333-333333333312';
  IF v_line IS NOT NULL THEN RAISE EXCEPTION 'FAIL C6: PAY-P2 (mua hỗn hợp) phải giữ NULL, thực tế %', v_line; END IF;
  SELECT business_line_id INTO v_line FROM public.partner_receivables WHERE id = '55555555-5555-5555-5555-555555550403';
  IF v_line IS NOT NULL THEN RAISE EXCEPTION 'FAIL C7: R-MIX (chứng từ hỗn hợp) phải giữ NULL'; END IF;
  SELECT business_line_id INTO v_line FROM public.partner_receivables WHERE id = '55555555-5555-5555-5555-555555550405';
  IF v_line IS NOT NULL THEN RAISE EXCEPTION 'FAIL C8: R-VAT4 (chưa phân loại) phải giữ NULL'; END IF;
  RAISE NOTICE 'PASS C (BAL-01): backfill ngành đúng — đơn ngành có ngành, hỗn hợp/chưa phân loại giữ NULL';
END $$;

-- ---------------------------------------------------------------------
-- D. BL-014: v_unattributed_balances liệt kê đúng khoản chưa quy chiếu.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.v_unattributed_balances WHERE id = '55555555-5555-5555-5555-555555550403';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL D1: R-MIX không có trong v_unattributed_balances'; END IF;
  SELECT count(*) INTO v_n FROM public.v_unattributed_balances WHERE id = '55555555-5555-5555-5555-555555550405';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL D2: R-VAT4 không có trong v_unattributed_balances'; END IF;
  SELECT count(*) INTO v_n FROM public.v_unattributed_balances WHERE id = '33333333-3333-3333-3333-333333333312';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL D3: PAY-P2 không có trong v_unattributed_balances'; END IF;
  SELECT count(*) INTO v_n FROM public.v_unattributed_balances WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffa1';
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL D4: R-a1 (đã phân loại) không được nằm trong view'; END IF;
  SELECT count(*) INTO v_n FROM public.v_unattributed_balances WHERE kind = 'RECEIVABLE' AND remaining <> amount - amount_paid;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL D5: remaining trong view lệch amount - amount_paid'; END IF;
  RAISE NOTICE 'PASS D (BL-014): khoản chưa quy chiếu được liệt kê để chủ rà soát, không tự chia';
END $$;

-- ---------------------------------------------------------------------
-- E. Fill trigger: khoản công nợ mới tự điền ngành từ chứng từ gốc.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_line uuid; v_parts uuid; v_rid uuid;
BEGIN
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  -- KG-VAT-0001 chưa có khoản phải thu nào (KG chỉ sinh phải thu khi
  -- đối tác tiêu thụ) nên dùng được cho test này.
  INSERT INTO public.partner_receivables (partner_id, source_document_id, amount, amount_paid, status)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '55555555-5555-5555-5555-555555550203', 1000, 0, 'UNPAID')
  RETURNING id INTO v_rid;
  INSERT INTO p4_ids VALUES ('E1', v_rid) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  SELECT business_line_id INTO v_line FROM public.partner_receivables WHERE id = v_rid;
  IF v_line <> v_parts THEN RAISE EXCEPTION 'FAIL E1: khoản mới không tự điền AUTO_PARTS từ KG-VAT-0001'; END IF;
  DELETE FROM public.partner_receivables WHERE id = v_rid;
  RAISE NOTICE 'PASS E: khoản công nợ mới tự điền ngành từ chứng từ gốc';
END $$;

-- ---------------------------------------------------------------------
-- F. Guard ngành công nợ: đã chốt thì không đổi; NULL -> có thì được.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_parts uuid; v_oil uuid; v_pid uuid; v_line uuid;
BEGIN
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  BEGIN
    UPDATE public.partner_receivables SET business_line_id = v_oil WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffa1';
    RAISE EXCEPTION 'FAIL F1: đổi ngành khoản đã chốt không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%đã chốt%' THEN RAISE; END IF;
  END;
  -- Khoản phải trả mua hàng mới cho PN-SEED-0002 (phiếu nhập hỗn hợp):
  -- fill trigger đọc header phiếu nhập (NULL) nên khoản mới giữ NULL.
  INSERT INTO public.supplier_payables (supplier_id, amount, amount_paid, status, source_kind, purchase_receipt_id)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 5000, 0, 'UNPAID', 'PURCHASE', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2')
  RETURNING id INTO v_pid;
  SELECT business_line_id INTO v_line FROM public.supplier_payables WHERE id = v_pid;
  IF v_line IS NOT NULL THEN RAISE EXCEPTION 'FAIL F2: khoản từ phiếu nhập hỗn hợp phải NULL khi tạo'; END IF;
  UPDATE public.supplier_payables SET business_line_id = v_parts WHERE id = v_pid;
  SELECT business_line_id INTO v_line FROM public.supplier_payables WHERE id = v_pid;
  IF v_line <> v_parts THEN RAISE EXCEPTION 'FAIL F3: bổ sung ngành cho khoản NULL không được'; END IF;
  DELETE FROM public.supplier_payables WHERE id = v_pid;
  RAISE NOTICE 'PASS F: ngành đã chốt không đổi được; khoản NULL được bổ sung ngành';
END $$;

-- ---------------------------------------------------------------------
-- VAT-03: hoá đơn trộn hai ngành bị chặn (BL-015 bảng §21.2).
--   Dùng dòng KG-VAT-0001 (AUTO) + dòng BH-VAT-0004 (OIL), cả hai
--   chưa ghi hoá đơn.
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_inv uuid;
BEGIN
  BEGIN
    SELECT public.create_vat_invoice('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'HD-P4-MIX', 'P4', '2026-09-08', 'TVK',
      ARRAY['55555555-5555-5555-5555-555555550304'::uuid, '55555555-5555-5555-5555-555555550307'::uuid]) INTO v_inv;
    RAISE EXCEPTION 'FAIL VAT03: hoá đơn trộn ngành không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%một ngành%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS VAT-03: hoá đơn trộn Dầu nhớt + Phụ tùng bị chặn';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- VAT-05: ghi hoá đơn sai đối tác bị chặn (dòng KG-VAT-0001 của Á Âu
--   nhưng partner truyền vào là Cty Test Khác).
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_inv uuid;
BEGIN
  BEGIN
    SELECT public.create_vat_invoice('55555555-5555-5555-5555-555555550001', 'HD-P4-WRONG', 'P4', '2026-09-08', 'TVK',
      ARRAY['55555555-5555-5555-5555-555555550304'::uuid]) INTO v_inv;
    RAISE EXCEPTION 'FAIL VAT05: hoá đơn sai đối tác không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%cùng một đối tác%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS VAT-05: hoá đơn sai đối tác bị chặn';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- VAT-06: dòng của chứng từ NHÁP bị chặn (BH-SEED-0003, DRAFT).
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_inv uuid;
BEGIN
  BEGIN
    SELECT public.create_vat_invoice('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'HD-P4-DRAFT', 'P4', '2026-09-08', 'TVK',
      ARRAY['33333333-3333-3333-3333-333333333303'::uuid]) INTO v_inv;
    RAISE EXCEPTION 'FAIL VAT06: dòng chứng từ nháp không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%ĐÃ XÁC NHẬN%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS VAT-06: dòng chứng từ nháp bị chặn';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- VAT-07: trùng dòng trong danh sách bị chặn.
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_inv uuid;
BEGIN
  BEGIN
    SELECT public.create_vat_invoice('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'HD-P4-DUP', 'P4', '2026-09-08', 'TVK',
      ARRAY['55555555-5555-5555-5555-555555550301'::uuid, '55555555-5555-5555-5555-555555550301'::uuid]) INTO v_inv;
    RAISE EXCEPTION 'FAIL VAT07: trùng dòng không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%bị trùng%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS VAT-07: trùng dòng trong danh sách bị chặn';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- VAT-09: dòng thuộc sản phẩm chưa phân loại ngành bị chặn
--   (BH-VAT-0005, sản phẩm SP-CHUA-PL).
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_inv uuid;
BEGIN
  BEGIN
    SELECT public.create_vat_invoice('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'HD-P4-UNCL', 'P4', '2026-09-08', 'TVK',
      ARRAY['55555555-5555-5555-5555-555555550308'::uuid]) INTO v_inv;
    RAISE EXCEPTION 'FAIL VAT09: dòng chưa phân loại ngành không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%chưa phân loại%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS VAT-09: dòng thuộc sản phẩm chưa phân loại bị chặn';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- VAT-10: Kế toán chỉ có quyền Phụ tùng thì không ghi hoá đơn Dầu nhớt
--   (dòng BH-VAT-0004, OIL) — kiểm tra quyền ngành trong RPC.
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb78abc2-584f-45b8-b63f-11c38f4299d0', true);
DO $$
DECLARE
  v_inv uuid;
BEGIN
  BEGIN
    SELECT public.create_vat_invoice('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'HD-P4-NOPERM', 'P4', '2026-09-08', 'TVK',
      ARRAY['55555555-5555-5555-5555-555555550307'::uuid]) INTO v_inv;
    RAISE EXCEPTION 'FAIL VAT10: Kế toán ghi hoá đơn ngành không có quyền không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%không có quyền%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS VAT-10: quyền ngành trong create_vat_invoice hoạt động (Kế toán không ghi được hoá đơn Dầu)';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- VAT-01: ghi hoá đơn cho BH-VAT-0001 (AUTO, giảm giá 50.000).
--   Kỳ vọng: chia giảm giá L1 30.000 / L2 20.000 (tỷ lệ, đúng tổng);
--   L1: cơ sở 270.000 -> trước thuế 250.000, VAT 20.000;
--   L2: cơ sở 180.000 -> trước thuế 166.666,67, VAT 13.333,33;
--   header: trước thuế 416.666,67 + VAT 33.333,33 = 450.000.
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_inv uuid; v_parts uuid;
  v_bt numeric; v_vat numeric; v_tot numeric; v_line uuid;
  v_d1 numeric; v_b1 numeric; v_bt1 numeric; v_v1 numeric;
  v_d2 numeric; v_b2 numeric; v_bt2 numeric; v_v2 numeric;
  v_n integer;
BEGIN
  SELECT id INTO v_parts FROM public.business_lines WHERE code = 'AUTO_PARTS';
  SELECT public.create_vat_invoice('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'HD-P4-0001', 'P4', '2026-09-08', 'TVK',
    ARRAY['55555555-5555-5555-5555-555555550301'::uuid, '55555555-5555-5555-5555-555555550302'::uuid]) INTO v_inv;
  INSERT INTO p4_ids VALUES ('VAT01', v_inv) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  SELECT business_line_id, total_before_tax, total_vat, total_amount INTO v_line, v_bt, v_vat, v_tot
    FROM public.vat_invoices WHERE id = v_inv;
  IF v_line <> v_parts THEN RAISE EXCEPTION 'FAIL VAT01-1: header line không phải AUTO_PARTS'; END IF;
  IF v_tot <> 450000 THEN RAISE EXCEPTION 'FAIL VAT01-2: header total=% (expect 450000)', v_tot; END IF;
  IF v_bt <> 416666.67 THEN RAISE EXCEPTION 'FAIL VAT01-3: before_tax=% (expect 416666.67)', v_bt; END IF;
  IF v_vat <> 33333.33 THEN RAISE EXCEPTION 'FAIL VAT01-4: vat=% (expect 33333.33)', v_vat; END IF;
  IF v_bt + v_vat <> v_tot THEN RAISE EXCEPTION 'FAIL VAT01-5: trước-thuế + VAT lệch tổng'; END IF;
  SELECT discount_amount, amount, amount_before_tax, vat_amount
    INTO v_d1, v_b1, v_bt1, v_v1 FROM public.vat_invoice_lines
   WHERE vat_invoice_id = v_inv AND sales_document_line_id = '55555555-5555-5555-5555-555555550301';
  SELECT discount_amount, amount, amount_before_tax, vat_amount
    INTO v_d2, v_b2, v_bt2, v_v2 FROM public.vat_invoice_lines
   WHERE vat_invoice_id = v_inv AND sales_document_line_id = '55555555-5555-5555-5555-555555550302';
  IF v_d1 <> 30000 OR v_d2 <> 20000 THEN RAISE EXCEPTION 'FAIL VAT01-6: chia giảm giá L1=% L2=% (expect 30000/20000)', v_d1, v_d2; END IF;
  IF v_d1 + v_d2 <> 50000 THEN RAISE EXCEPTION 'FAIL VAT01-7: tổng giảm giá đã chia lệch discount chứng từ'; END IF;
  IF v_b1 <> 270000 OR v_bt1 <> 250000 OR v_v1 <> 20000 THEN RAISE EXCEPTION 'FAIL VAT01-8: tách VAT L1 sai (%/%/%)', v_b1, v_bt1, v_v1; END IF;
  IF v_b2 <> 180000 OR v_bt2 <> 166666.67 OR v_v2 <> 13333.33 THEN RAISE EXCEPTION 'FAIL VAT01-9: tách VAT L2 sai (%/%/%)', v_b2, v_bt2, v_v2; END IF;
  SELECT count(*) INTO v_n FROM public.vat_invoice_lines WHERE vat_invoice_id = v_inv AND is_active;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL VAT01-10: số dòng hoá đơn=% (expect 2)', v_n; END IF;
  RAISE NOTICE 'PASS VAT-01: hoá đơn Phụ tùng chia giảm giá đúng tổng + tách VAT 8%% đúng từng dòng';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- VAT-08: ghi lại dòng đã có hoá đơn bị chặn (dòng L1 của VAT-01).
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_inv uuid;
BEGIN
  BEGIN
    SELECT public.create_vat_invoice('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'HD-P4-AGAIN', 'P4', '2026-09-08', 'TVK',
      ARRAY['55555555-5555-5555-5555-555555550301'::uuid]) INTO v_inv;
    RAISE EXCEPTION 'FAIL VAT08: ghi lại dòng đã có hoá đơn không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%đã được ghi nhận%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS VAT-08: dòng đã có hoá đơn không ghi lại được';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- VAT-02: ghi hoá đơn cho BH-VAT-0002 (OIL, không giảm giá).
--   Kỳ vọng: cơ sở 200.000 -> trước thuế 185.185,19, VAT 14.814,81.
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_inv uuid; v_oil uuid;
  v_bt numeric; v_vat numeric; v_tot numeric; v_line uuid;
BEGIN
  SELECT id INTO v_oil FROM public.business_lines WHERE code = 'OIL';
  SELECT public.create_vat_invoice('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'HD-P4-0002', 'P4', '2026-09-08', 'TVK',
    ARRAY['55555555-5555-5555-5555-555555550303'::uuid]) INTO v_inv;
  INSERT INTO p4_ids VALUES ('VAT02', v_inv) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  SELECT business_line_id, total_before_tax, total_vat, total_amount INTO v_line, v_bt, v_vat, v_tot
    FROM public.vat_invoices WHERE id = v_inv;
  IF v_line <> v_oil THEN RAISE EXCEPTION 'FAIL VAT02-1: header line không phải OIL'; END IF;
  IF v_tot <> 200000 OR v_bt <> 185185.19 OR v_vat <> 14814.81 THEN
    RAISE EXCEPTION 'FAIL VAT02-2: tách VAT sai total=% bt=% vat=% (expect 200000/185185.19/14814.81)', v_tot, v_bt, v_vat;
  END IF;
  RAISE NOTICE 'PASS VAT-02: hoá đơn Dầu nhớt tách VAT 8%% đúng';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- VAT-04: ghi hoá đơn cho BH-VAT-0004 (OIL).
--   Kỳ vọng: cơ sở 100.000 -> trước thuế 92.592,59, VAT 7.407,41.
-- ---------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_inv uuid;
  v_bt numeric; v_vat numeric; v_tot numeric;
BEGIN
  SELECT public.create_vat_invoice('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'HD-P4-0004', 'P4', '2026-09-08', 'TVK',
    ARRAY['55555555-5555-5555-5555-555555550307'::uuid]) INTO v_inv;
  INSERT INTO p4_ids VALUES ('VAT04', v_inv) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  SELECT total_before_tax, total_vat, total_amount INTO v_bt, v_vat, v_tot
    FROM public.vat_invoices WHERE id = v_inv;
  IF v_tot <> 100000 OR v_bt <> 92592.59 OR v_vat <> 7407.41 THEN
    RAISE EXCEPTION 'FAIL VAT04: tách VAT sai total=% bt=% vat=% (expect 100000/92592.59/7407.41)', v_tot, v_bt, v_vat;
  END IF;
  RAISE NOTICE 'PASS VAT-04: hoá đơn Dầu nhớt thứ hai tách VAT đúng';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- VAT-11: kết quả đồng thời (script p4_concurrency.sh chạy trước file
--   này): dòng BH-VAT-0006 chỉ có đúng 1 hoá đơn (HD-CC-0001),
--   HD-CC-0002 không tồn tại; tách VAT đúng 50.000 -> 46.296,30 +
--   3.703,70.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_n integer; v_inv uuid;
  v_bt numeric; v_vat numeric; v_tot numeric;
BEGIN
  SELECT count(*) INTO v_n FROM public.vat_invoice_lines
   WHERE sales_document_line_id = '55555555-5555-5555-5555-555555550309' AND is_active;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL VAT11-1: dòng đồng thời có % hoá đơn active (expect 1)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.vat_invoices WHERE invoice_no = 'HD-CC-0002';
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL VAT11-2: HD-CC-0002 tồn tại — phiên thứ hai không bị chặn'; END IF;
  SELECT id, total_before_tax, total_vat, total_amount INTO v_inv, v_bt, v_vat, v_tot
    FROM public.vat_invoices WHERE invoice_no = 'HD-CC-0001';
  IF v_tot <> 50000 OR v_bt <> 46296.30 OR v_vat <> 3703.70 THEN
    RAISE EXCEPTION 'FAIL VAT11-3: tách VAT HD-CC-0001 sai total=% bt=% vat=%', v_tot, v_bt, v_vat;
  END IF;
  INSERT INTO p4_ids VALUES ('VAT11', v_inv) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  RAISE NOTICE 'PASS VAT-11 (đồng thời): hai phiên cùng ghi một dòng -> đúng 1 hoá đơn, phiên còn lại bị chặn';
END $$;

-- ---------------------------------------------------------------------
-- BL15-01: đảo phiếu đã có hoá đơn GTGT bị chặn.
--   Thu 450.000 cho R-VAT1 (chứng từ BH-VAT-0001 đã có HD-P4-0001
--   từ VAT-01) rồi đảo -> phải bị chặn, nêu đúng số hoá đơn.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fund uuid; v_pay uuid;
  v_paid numeric; v_st text;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  INSERT INTO public.payments (payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
  VALUES ('IN', '2026-09-09', 450000, 'BANK', '55555555-5555-5555-5555-555555550401', v_fund, 'BL15-01 thu R-VAT1', 'eb78abc2-584f-45b8-b63f-11c38f4299d0')
  RETURNING id INTO v_pay;
  INSERT INTO p4_ids VALUES ('BL15PAY', v_pay) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  SELECT amount_paid, status INTO v_paid, v_st FROM public.partner_receivables WHERE id = '55555555-5555-5555-5555-555555550401';
  IF v_paid <> 450000 OR v_st <> 'PAID' THEN RAISE EXCEPTION 'FAIL BL15-01a: sau thu R-VAT1 paid=% status=% (expect 450000/PAID)', v_paid, v_st; END IF;
  RAISE NOTICE 'PASS BL15-01a: phiếu thu qua trigger cắt (P4a) vẫn cập nhật số dư đúng';
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb78abc2-584f-45b8-b63f-11c38f4299d0', true);
DO $$
DECLARE
  v_pay uuid; v_rev uuid;
BEGIN
  SELECT val INTO v_pay FROM p4_ids WHERE key = 'BL15PAY';
  BEGIN
    SELECT public.reverse_payment(v_pay, 'Kiểm chứng BL-015: đảo khi đã có hoá đơn') INTO v_rev;
    RAISE EXCEPTION 'FAIL BL15-01b: đảo phiếu đã có hoá đơn GTGT không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%hoá đơn GTGT%HD-P4-0001%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS BL15-01 (BL-015): đảo khi chứng từ đã có hoá đơn GTGT còn hiệu lực bị chặn, nêu đúng số hoá đơn';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- BL15-02: đảo phiếu CHƯA có hoá đơn vẫn được (R-VAT6, BH-VAT-0007).
--   Thu 200.000 -> đảo -> số dư về 0, phân bổ gương âm, dòng tiền đảo.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fund uuid; v_pay uuid;
  v_paid numeric; v_st text; v_alloc integer; v_sum numeric; v_mov integer;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  INSERT INTO public.payments (payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
  VALUES ('IN', '2026-09-09', 200000, 'BANK', '55555555-5555-5555-5555-555555550407', v_fund, 'BL15-02 thu R-VAT6', 'eb78abc2-584f-45b8-b63f-11c38f4299d0')
  RETURNING id INTO v_pay;
  INSERT INTO p4_ids VALUES ('BL15PAY2', v_pay) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb78abc2-584f-45b8-b63f-11c38f4299d0', true);
DO $$
DECLARE
  v_pay uuid; v_rev uuid;
  v_paid numeric; v_st text; v_alloc integer; v_sum numeric; v_mov integer;
BEGIN
  SELECT val INTO v_pay FROM p4_ids WHERE key = 'BL15PAY2';
  SELECT public.reverse_payment(v_pay, 'Kiểm chứng BL15-02: đảo khi chưa có hoá đơn') INTO v_rev;
  INSERT INTO p4_ids VALUES ('BL15REV2', v_rev) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  SELECT amount_paid, status INTO v_paid, v_st FROM public.partner_receivables WHERE id = '55555555-5555-5555-5555-555555550407';
  IF v_paid <> 0 OR v_st <> 'UNPAID' THEN RAISE EXCEPTION 'FAIL BL15-02a: sau đảo R-VAT6 paid=% status=% (expect 0/UNPAID)', v_paid, v_st; END IF;
  SELECT count(*), coalesce(sum(amount), 0) INTO v_alloc, v_sum
    FROM public.payment_allocations WHERE receivable_id = '55555555-5555-5555-5555-555555550407';
  IF v_alloc <> 2 OR v_sum <> 0 THEN RAISE EXCEPTION 'FAIL BL15-02b: phân bổ R-VAT6 count=% sum=% (expect 2/0)', v_alloc, v_sum; END IF;
  SELECT count(*) INTO v_mov FROM public.cash_movements WHERE payment_id = v_rev AND movement_kind = 'REVERSAL';
  IF v_mov <> 1 THEN RAISE EXCEPTION 'FAIL BL15-02c: thiếu dòng tiền đảo cho phiếu đảo R-VAT6'; END IF;
  RAISE NOTICE 'PASS BL15-02: đảo khi chưa có hoá đơn vẫn được — số dư về 0, phân bổ gương âm';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- BL15-03: phải trả MUA HÀNG (không có sales_document) không bao giờ
--   bị chặn bởi BL-015: chi 100.000 cho PAY-P1 rồi đảo -> được.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fund uuid; v_pay uuid;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  INSERT INTO public.payments (payment_kind, payment_date, amount, method, payable_id, fund_id, note, created_by)
  VALUES ('OUT', '2026-09-09', 100000, 'BANK', '33333333-3333-3333-3333-333333333311', v_fund, 'BL15-03 chi PAY-P1', 'eb78abc2-584f-45b8-b63f-11c38f4299d0')
  RETURNING id INTO v_pay;
  INSERT INTO p4_ids VALUES ('BL15PAY3', v_pay) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb78abc2-584f-45b8-b63f-11c38f4299d0', true);
DO $$
DECLARE
  v_pay uuid; v_rev uuid;
  v_paid numeric;
BEGIN
  SELECT val INTO v_pay FROM p4_ids WHERE key = 'BL15PAY3';
  SELECT public.reverse_payment(v_pay, 'Kiểm chứng BL15-03: đảo chi mua hàng') INTO v_rev;
  SELECT amount_paid INTO v_paid FROM public.supplier_payables WHERE id = '33333333-3333-3333-3333-333333333311';
  IF v_paid <> 0 THEN RAISE EXCEPTION 'FAIL BL15-03: sau đảo PAY-P1 paid=% (expect 0)', v_paid; END IF;
  RAISE NOTICE 'PASS BL15-03: phải trả mua hàng đảo được (không có hoá đơn GTGT bán hàng để chặn)';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- Y. Thanh toán cho khoản phải thu hỗn hợp bị resolver chặn (fail-closed):
--   R-MIX (BH-VAT-0003, 2 ngành) không ghi được phiếu thu.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fund uuid;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  BEGIN
    INSERT INTO public.payments (payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
    VALUES ('IN', '2026-09-09', 50000, 'BANK', '55555555-5555-5555-5555-555555550403', v_fund, 'Y thu R-MIX', 'eb78abc2-584f-45b8-b63f-11c38f4299d0');
    RAISE EXCEPTION 'FAIL Y: thu tiền cho khoản hỗn hợp không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%Không xác định được ngành hàng%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS Y: phiếu thu cho khoản công nợ hỗn hợp bị chặn — phải phân loại chứng từ gốc trước (BL-014)';
END $$;

-- ---------------------------------------------------------------------
-- U. P4a sau các phiếu: mọi khoản đều thỏa amount_paid = SUM(phân bổ).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM (
    SELECT p.id FROM public.supplier_payables p
     WHERE (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.payable_id = p.id) <> p.amount_paid
    UNION ALL
    SELECT r.id FROM public.partner_receivables r
     WHERE (SELECT coalesce(sum(a.amount), 0) FROM public.payment_allocations a WHERE a.receivable_id = r.id) <> r.amount_paid
  ) s;
  IF v_bad > 0 THEN RAISE EXCEPTION 'FAIL U: % khoản công nợ lệch SUM(phân bổ) sau các phiếu P4', v_bad; END IF;
  RAISE NOTICE 'PASS U (P4a): sau thu/đảo, mọi khoản công nợ đều thỏa amount_paid = SUM(phân bổ)';
END $$;

-- ---------------------------------------------------------------------
-- V. Snapshot đối chiếu bất biến (BL-017).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_period uuid;
BEGIN
  INSERT INTO public.reconciliation_periods (id, period_type, name, from_date, to_date, status)
  VALUES ('66666666-6666-6666-6666-666666666601', 'MONTH', 'Kỳ test P4 09/2026', '2026-09-01', '2026-09-30', 'OPEN')
  RETURNING id INTO v_period;
  INSERT INTO p4_ids VALUES ('PERIOD', v_period) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  INSERT INTO public.reconciliation_entries (period_id, data_group, item_key, item_name, tvk_amount, accounting_amount, discrepancy_status)
  VALUES (v_period, 'RECEIVABLE', 'REC_TEST', 'Phải thu test', 100000, 100000, 'MATCHED');
END $$;

-- Block 2: tạo bản chụp qua RPC (OWNER).
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_period uuid; v_snap uuid;
BEGIN
  SELECT val INTO v_period FROM p4_ids WHERE key = 'PERIOD';
  SELECT public.create_reconciliation_snapshot(v_period, 'Bản chốt test P4', 'ghi chú test') INTO v_snap;
  INSERT INTO p4_ids VALUES ('SNAP', v_snap) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  RAISE NOTICE 'PASS V0: tạo bản chụp đối chiếu qua RPC được';
END $$;
COMMIT;

-- Block 3 (superuser, bypass RLS): trigger chặn UPDATE/DELETE + FK RESTRICT.
DO $$
DECLARE
  v_period uuid; v_snap uuid;
BEGIN
  SELECT val INTO v_period FROM p4_ids WHERE key = 'PERIOD';
  SELECT val INTO v_snap FROM p4_ids WHERE key = 'SNAP';
  -- V1: UPDATE bản chụp -> chặn (trigger, mọi role kể cả service role).
  BEGIN
    UPDATE public.reconciliation_snapshots SET note = 'sửa lén' WHERE id = v_snap;
    RAISE EXCEPTION 'FAIL V1: UPDATE bản chụp đối chiếu không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%bất biến%' THEN RAISE; END IF;
  END;
  -- V2: DELETE bản chụp -> chặn.
  BEGIN
    DELETE FROM public.reconciliation_snapshots WHERE id = v_snap;
    RAISE EXCEPTION 'FAIL V2: DELETE bản chụp đối chiếu không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%bất biến%' THEN RAISE; END IF;
  END;
  -- V3: DELETE kỳ đang có bản chụp -> chặn (FK RESTRICT).
  BEGIN
    DELETE FROM public.reconciliation_periods WHERE id = v_period;
    RAISE EXCEPTION 'FAIL V3: xóa kỳ đang có bản chụp không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '23503' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS V1-V3: trigger bất biến chặn UPDATE/DELETE; FK RESTRICT chặn xóa kỳ';
END $$;

-- Block 4 (OWNER): bản chụp hiệu chỉnh mới + RLS chặn sửa trực tiếp.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_period uuid; v_snap uuid; v_snap2 uuid; v_n integer; v_note text;
BEGIN
  SELECT val INTO v_period FROM p4_ids WHERE key = 'PERIOD';
  SELECT val INTO v_snap FROM p4_ids WHERE key = 'SNAP';
  -- V4: tạo bản chụp hiệu chỉnh mới cho cùng kỳ vẫn được.
  SELECT public.create_reconciliation_snapshot(v_period, 'Bản chốt hiệu chỉnh P4', 'sửa bằng bản mới') INTO v_snap2;
  SELECT count(*) INTO v_n FROM public.reconciliation_snapshots WHERE period_id = v_period;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL V4: số bản chụp của kỳ=% (expect 2)', v_n; END IF;
  -- V5: không còn policy UPDATE/DELETE trên snapshots.
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'reconciliation_snapshots' AND cmd IN ('UPDATE', 'DELETE');
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL V5: còn % policy UPDATE/DELETE trên snapshots', v_n; END IF;
  -- V6: OWNER sửa trực tiếp -> RLS chặn (0 dòng bị đổi, ghi chú nguyên vẹn).
  UPDATE public.reconciliation_snapshots SET note = 'sửa lén qua RLS' WHERE id = v_snap;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL V6: UPDATE trực tiếp đổi % dòng (expect 0 — RLS chặn)', v_n; END IF;
  SELECT note INTO v_note FROM public.reconciliation_snapshots WHERE id = v_snap;
  IF v_note <> 'ghi chú test' THEN RAISE EXCEPTION 'FAIL V6b: ghi chú bản chụp bị đổi thành %', v_note; END IF;
  RAISE NOTICE 'PASS V4-V6 (BL-017): bản chụp bất biến; sửa sai bằng bản chụp mới; RLS chặn sửa trực tiếp';
END $$;
COMMIT;

-- ---------------------------------------------------------------------
-- W. View dòng tiền theo quỹ x ngành (Model A/B).
--   Quỹ Két x AUTO: thu vào 450.000 (R-VAT1) + 200.000 (R-VAT6)
--   - 200.000 (đảo R-VAT6) = 450.000; chi ra 100.000 (PAY-P1)
--   - 100.000 (đảo PAY-P1) = 0; ròng 450.000; 5 phiếu.
--   Không có dòng OIL (chưa có phiếu nào cho Dầu).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_fund uuid;
  v_in numeric; v_out numeric; v_net numeric; v_cnt integer; v_n integer;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  SELECT in_amount, out_amount, net_amount, payment_count
    INTO v_in, v_out, v_net, v_cnt
    FROM public.v_cash_flow_by_line
   WHERE fund_id = v_fund
     AND line_id = (SELECT id FROM public.business_lines WHERE code = 'AUTO_PARTS');
  IF v_in IS NULL THEN RAISE EXCEPTION 'FAIL W1: thiếu dòng Két x Phụ tùng trong v_cash_flow_by_line'; END IF;
  IF v_in <> 450000 OR v_out <> 0 OR v_net <> 450000 OR v_cnt <> 5 THEN
    RAISE EXCEPTION 'FAIL W2: Két x Phụ tùng in=% out=% net=% count=% (expect 450000/0/450000/5)', v_in, v_out, v_net, v_cnt;
  END IF;
  SELECT count(*) INTO v_n FROM public.v_cash_flow_by_line
   WHERE line_id = (SELECT id FROM public.business_lines WHERE code = 'OIL');
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL W3: có dòng Dầu trong view dù chưa có phiếu Dầu nào'; END IF;
  RAISE NOTICE 'PASS W: v_cash_flow_by_line đúng theo quỹ x ngành, phiếu đảo tự triệt tiêu';
END $$;

-- ---------------------------------------------------------------------
-- X. Bất biến tài chính cuối: chỉ R-VAT1 (thu 450.000, đảo bị chặn)
--   làm giảm dư nợ phải thu; phải trả không đổi; số phiếu/movements
--   tăng đúng 5 (1 thu R-VAT1 + 2 thu/đảo R-VAT6 + 2 chi/đảo PAY-P1).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_rec0 numeric; v_pay0 numeric; v_pmt0 numeric; v_mov0 numeric;
  v_rec numeric; v_pay numeric; v_pmt numeric; v_mov numeric;
BEGIN
  SELECT val INTO v_rec0 FROM p4_base WHERE key = 'rec_open';
  SELECT val INTO v_pay0 FROM p4_base WHERE key = 'pay_open';
  SELECT val INTO v_pmt0 FROM p4_base WHERE key = 'payments';
  SELECT val INTO v_mov0 FROM p4_base WHERE key = 'movements';
  SELECT coalesce(sum(amount - amount_paid), 0) INTO v_rec FROM public.partner_receivables;
  SELECT coalesce(sum(amount - amount_paid), 0) INTO v_pay FROM public.supplier_payables;
  SELECT count(*) INTO v_pmt FROM public.payments;
  SELECT count(*) INTO v_mov FROM public.cash_movements;
  IF v_rec <> v_rec0 - 450000 THEN RAISE EXCEPTION 'FAIL X1: dư nợ phải thu=% (expect baseline % - 450000)', v_rec, v_rec0; END IF;
  IF v_pay <> v_pay0 THEN RAISE EXCEPTION 'FAIL X2: dư nợ phải trả đổi: % vs baseline %', v_pay, v_pay0; END IF;
  IF v_pmt <> v_pmt0 + 5 THEN RAISE EXCEPTION 'FAIL X3: số phiếu=% (expect baseline % + 5)', v_pmt, v_pmt0; END IF;
  IF v_mov <> v_mov0 + 5 THEN RAISE EXCEPTION 'FAIL X4: số dòng tiền=% (expect baseline % + 5)', v_mov, v_mov0; END IF;
  RAISE NOTICE 'PASS X: bất biến tài chính giữ nguyên trừ đúng khoản thu R-VAT1 đã chốt (450.000)';
END $$;

-- ---------------------------------------------------------------------
-- REV. Quyền đảo mới (quyết của chủ 23/11 21:48): OWNER cũng được đảo
--   (cùng Kế toán); SALES / WAREHOUSE / CEO vẫn bị chặn; BL-015 vẫn
--   chặn OWNER khi đã có hoá đơn. Chạy SAU mục X để không phá đếm W/X
--   (REV tự triệt tiêu: thu + đảo R-VAT7, thu R-VAT2 bị chặn đảo).
--   Dùng R-VAT7 (5555...0407, đã thu + đảo 1 lần ở BL15-02, đang UNPAID)
--   cho REV-01/02 và R-VAT2 (5555...0402, đã có HD-P4-0002) cho REV-03.
-- ---------------------------------------------------------------------
-- REV-01/02 setup: thu lại 200.000 cho R-VAT7 (người thu: Kế toán).
DO $$
DECLARE
  v_fund uuid; v_pay uuid;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  INSERT INTO public.payments (payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
  VALUES ('IN', '2026-09-09', 200000, 'BANK', '55555555-5555-5555-5555-555555550407', v_fund, 'REV thu lại R-VAT7', 'eb78abc2-584f-45b8-b63f-11c38f4299d0')
  RETURNING id INTO v_pay;
  INSERT INTO p4_ids VALUES ('REVPAY', v_pay) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
END $$;

-- REV-02a: SALES đảo -> chặn.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44b1f9c9-f3f6-48ad-a575-2c32092f2130', true);
DO $$
DECLARE
  v_pay uuid; v_rev uuid;
BEGIN
  SELECT val INTO v_pay FROM p4_ids WHERE key = 'REVPAY';
  BEGIN
    SELECT public.reverse_payment(v_pay, 'SALES thử đảo') INTO v_rev;
    RAISE EXCEPTION 'FAIL REV-02a: SALES đảo không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%Chỉ Chủ cửa hàng và Kế toán%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS REV-02a: SALES đảo bút toán bị chặn';
END $$;
COMMIT;

-- REV-02b: WAREHOUSE đảo -> chặn.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '07d6557e-4444-4561-849a-0db13579439e', true);
DO $$
DECLARE
  v_pay uuid; v_rev uuid;
BEGIN
  SELECT val INTO v_pay FROM p4_ids WHERE key = 'REVPAY';
  BEGIN
    SELECT public.reverse_payment(v_pay, 'Thủ kho thử đảo') INTO v_rev;
    RAISE EXCEPTION 'FAIL REV-02b: WAREHOUSE đảo không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%Chỉ Chủ cửa hàng và Kế toán%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS REV-02b: WAREHOUSE đảo bút toán bị chặn';
END $$;
COMMIT;

-- REV-02c: CEO đảo -> chặn.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e3436179-bf18-4745-8843-f5cecb139e07', true);
DO $$
DECLARE
  v_pay uuid; v_rev uuid;
BEGIN
  SELECT val INTO v_pay FROM p4_ids WHERE key = 'REVPAY';
  BEGIN
    SELECT public.reverse_payment(v_pay, 'CEO thử đảo') INTO v_rev;
    RAISE EXCEPTION 'FAIL REV-02c: CEO đảo không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%Chỉ Chủ cửa hàng và Kế toán%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS REV-02c: CEO đảo bút toán bị chặn';
END $$;
COMMIT;

-- REV-01: OWNER đảo thành công + log đảo ghi đủ trường.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_pay uuid; v_rev uuid;
  v_paid numeric; v_st text; v_alloc integer; v_sum numeric; v_mov integer;
  v_code text; v_note text; v_by uuid; v_at timestamptz; v_name text; v_orig uuid;
BEGIN
  SELECT val INTO v_pay FROM p4_ids WHERE key = 'REVPAY';
  SELECT doc_code INTO v_code FROM public.payments WHERE id = v_pay;
  SELECT public.reverse_payment(v_pay, 'Kiểm chứng REV-01: OWNER đảo') INTO v_rev;
  INSERT INTO p4_ids VALUES ('REVREV', v_rev) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
  SELECT amount_paid, status INTO v_paid, v_st FROM public.partner_receivables WHERE id = '55555555-5555-5555-5555-555555550407';
  IF v_paid <> 0 OR v_st <> 'UNPAID' THEN RAISE EXCEPTION 'FAIL REV-01a: sau OWNER đảo R-VAT7 paid=% status=% (expect 0/UNPAID)', v_paid, v_st; END IF;
  SELECT count(*), coalesce(sum(amount), 0) INTO v_alloc, v_sum
    FROM public.payment_allocations WHERE receivable_id = '55555555-5555-5555-5555-555555550407';
  IF v_alloc <> 4 OR v_sum <> 0 THEN RAISE EXCEPTION 'FAIL REV-01b: phân bổ R-VAT7 count=% sum=% (expect 4/0)', v_alloc, v_sum; END IF;
  SELECT count(*) INTO v_mov FROM public.cash_movements WHERE payment_id = v_rev AND movement_kind = 'REVERSAL';
  IF v_mov <> 1 THEN RAISE EXCEPTION 'FAIL REV-01c: thiếu dòng tiền đảo cho phiếu đảo của OWNER'; END IF;
  -- REV-04 (log đảo): phiếu đảo ghi đúng phiếu gốc, lý do, người đảo, thời gian.
  SELECT note, created_by, created_at, reversal_of_id
    INTO v_note, v_by, v_at, v_orig FROM public.payments WHERE id = v_rev;
  IF v_orig <> v_pay THEN RAISE EXCEPTION 'FAIL REV-04a: phiếu đảo không trỏ về phiếu gốc'; END IF;
  IF v_note <> 'Đảo của ' || v_code || ': Kiểm chứng REV-01: OWNER đảo' THEN
    RAISE EXCEPTION 'FAIL REV-04b: ghi chú phiếu đảo=% (thiếu lý do)', v_note; END IF;
  IF v_by <> '158a181e-f50e-43ef-92b2-4841bdf468aa' THEN
    RAISE EXCEPTION 'FAIL REV-04c: người đảo=% (expect OWNER)', v_by; END IF;
  IF v_at IS NULL THEN RAISE EXCEPTION 'FAIL REV-04d: thiếu thời gian đảo'; END IF;
  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_by;
  IF v_name <> 'Thanh Phan' THEN RAISE EXCEPTION 'FAIL REV-04e: tên người đảo=% (expect Thanh Phan)', v_name; END IF;
  RAISE NOTICE 'PASS REV-01/04: OWNER đảo được; log đảo ghi đủ phiếu gốc, lý do, người đảo (Thanh Phan), thời gian';
END $$;
COMMIT;

-- REV-03: OWNER đảo phiếu đã có hoá đơn GTGT vẫn bị BL-015 chặn.
DO $$
DECLARE
  v_fund uuid; v_pay uuid;
BEGIN
  SELECT id INTO v_fund FROM public.cash_funds WHERE name = 'Két tiền mặt' LIMIT 1;
  INSERT INTO public.payments (payment_kind, payment_date, amount, method, receivable_id, fund_id, note, created_by)
  VALUES ('IN', '2026-09-09', 200000, 'BANK', '55555555-5555-5555-5555-555555550402', v_fund, 'REV thu R-VAT2 (đã có hoá đơn)', 'eb78abc2-584f-45b8-b63f-11c38f4299d0')
  RETURNING id INTO v_pay;
  INSERT INTO p4_ids VALUES ('REVPAY3', v_pay) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val;
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '158a181e-f50e-43ef-92b2-4841bdf468aa', true);
DO $$
DECLARE
  v_pay uuid; v_rev uuid;
BEGIN
  SELECT val INTO v_pay FROM p4_ids WHERE key = 'REVPAY3';
  BEGIN
    SELECT public.reverse_payment(v_pay, 'OWNER thử đảo phiếu đã có hoá đơn') INTO v_rev;
    RAISE EXCEPTION 'FAIL REV-03: OWNER đảo phiếu đã có hoá đơn không bị chặn';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0001' OR SQLERRM NOT ILIKE '%hoá đơn GTGT%HD-P4-0002%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS REV-03 (BL-015): OWNER đảo phiếu đã có hoá đơn GTGT vẫn bị chặn, nêu đúng số hoá đơn';
END $$;
COMMIT;

-- Tổng kết.
SELECT 'P4 FINANCE+VAT LOCAL: ALL PASS' AS result,
  (SELECT count(*) FROM public.vat_invoices) AS vat_invoices,
  (SELECT count(*) FROM public.vat_invoice_lines WHERE is_active) AS vat_lines,
  (SELECT count(*) FROM public.payment_allocations) AS allocations,
  (SELECT count(*) FROM public.reconciliation_snapshots) AS snapshots;
