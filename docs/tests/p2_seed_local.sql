-- =====================================================================
-- p2_seed_local.sql — Seed dữ liệu cho kiểm chứng migration 0026 (P2)
-- trên database local (KHÔNG phải live).
--
-- CHẠY: sau khi áp 0001–0025 + p1_seed_local.sql, TRƯỚC 0026:
--   psql -d tvk_p2_test -v ON_ERROR_STOP=1 -f docs/tests/p2_seed_local.sql
-- Sau đó chạy 0026, rồi chạy docs/tests/p2_operational_local.sql.
--
-- Tạo 5 tài khoản THẬT (đúng uuid + username như live, để 0026 seed
-- theo username tìm được đủ 5/5) + tài khoản kiểm chứng:
--   - test-chuagan (SALES, chưa gán ngành nào) -> sau 0026 phải thấy 0 dòng.
--   - test-chidau (SALES) -> file kiểm chứng sẽ gán OIL để thử fail-closed.
--   - test-tat (SALES, is_active=false, sẽ được gán OIL) -> vẫn bị chặn.
-- Tài khoản ghost (authenticated, không có profile) dùng uuid
-- 00000000-0000-4000-8000-000000000000 (không tạo profile).
-- Không đụng dữ liệu nghiệp vụ của p1_seed (sản phẩm/lô/chứng từ giữ nguyên).
-- =====================================================================

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('158a181e-f50e-43ef-92b2-4841bdf468aa', 'p.nhatthanh87@gmail.com'),
  ('44b1f9c9-f3f6-48ad-a575-2c32092f2130', 'p.nhatthanh87+banhang@gmail.com'),
  ('07d6557e-4444-4561-849a-0db13579439e', 'p.nhatthanh87+kho@gmail.com'),
  ('eb78abc2-584f-45b8-b63f-11c38f4299d0', 'p.nhatthanh87+ketoan@gmail.com'),
  ('e3436179-bf18-4745-8843-f5cecb139e07', 'p.nhatthanh87+ceo@gmail.com'),
  ('77777777-7777-7777-7777-777777777777', 'test-chuagan@test.local'),
  ('88888888-8888-8888-8888-888888888888', 'test-chidau@test.local'),
  ('99999999-9999-9999-9999-999999999999', 'test-tat@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, username, full_name, role, is_active) VALUES
  ('158a181e-f50e-43ef-92b2-4841bdf468aa', 'p.nhatthanh87@gmail.com', 'thanhphan', 'Thanh Phan', 'OWNER', true),
  ('44b1f9c9-f3f6-48ad-a575-2c32092f2130', 'p.nhatthanh87+banhang@gmail.com', 'banhang', 'Nhân viên bán hàng', 'SALES', true),
  ('07d6557e-4444-4561-849a-0db13579439e', 'p.nhatthanh87+kho@gmail.com', 'kho', 'Thủ kho', 'WAREHOUSE', true),
  ('eb78abc2-584f-45b8-b63f-11c38f4299d0', 'p.nhatthanh87+ketoan@gmail.com', 'ketoan', 'Kế toán', 'ACCOUNTING', true),
  ('e3436179-bf18-4745-8843-f5cecb139e07', 'p.nhatthanh87+ceo@gmail.com', 'ceo', 'CEO', 'CEO', true),
  ('77777777-7777-7777-7777-777777777777', 'test-chuagan@test.local', 'test-chuagan', 'Bán hàng chưa gán', 'SALES', true),
  ('88888888-8888-8888-8888-888888888888', 'test-chidau@test.local', 'test-chidau', 'Bán hàng chỉ dầu', 'SALES', true),
  ('99999999-9999-9999-9999-999999999999', 'test-tat@test.local', 'test-tat', 'Bán hàng đã tắt', 'SALES', false)
ON CONFLICT (id) DO NOTHING;

-- Baseline tài chính trước 0026 (phải bằng sau 0026): lấy từ p1 seed.
DO $$
DECLARE
  v_payables integer; v_receivables integer; v_payments integer; v_movements integer;
BEGIN
  SELECT count(*) INTO v_payables FROM public.supplier_payables;
  SELECT count(*) INTO v_receivables FROM public.partner_receivables;
  SELECT count(*) INTO v_payments FROM public.payments;
  SELECT count(*) INTO v_movements FROM public.stock_movements;
  RAISE NOTICE 'P2 SEED BASELINE | payables=% receivables=% payments=% movements=%', v_payables, v_receivables, v_payments, v_movements;
END $$;

COMMIT;
