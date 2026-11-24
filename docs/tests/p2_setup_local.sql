-- =====================================================================
-- p2_setup_local.sql — Stub tối thiểu của Supabase (auth schema + roles)
-- để áp các migration TVK lên PostgreSQL 16 vanilla (KHÔNG phải live).
--
-- CHẠY (một lần, trước mọi migration, bằng role postgres superuser):
--   psql -d tvk_p2_test -v ON_ERROR_STOP=1 -f docs/tests/p2_setup_local.sql
--
-- Tạo:
--   - schema auth + bảng auth.users (id, email) để profiles FK được.
--   - hàm auth.uid() đọc request.jwt.claim.sub như Supabase Auth thật
--     (test mô phỏng user bằng: SELECT set_config('request.jwt.claim.sub',
--     '<uuid>', true); + SET LOCAL ROLE authenticated; — mẫu
--     docs/tests/p0_sales_view_rls_local.sql).
--   - 3 role Supabase: authenticated, anon, service_role (chỉ để các lệnh
--     GRANT / POLICY trong migration chạy được; không cấp quyền thật).
-- Không đụng dữ liệu nghiệp vụ; chỉ dùng cho database scratch local.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY,
  email text
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END $$;
