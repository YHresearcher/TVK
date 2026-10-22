-- 0009: forced password change.
-- profiles.must_change_password is set TRUE when an account is created
-- with a temporary/default password, or when a password reset is
-- requested (self-service "Quên mật khẩu" or OWNER-triggered reset).
-- The app layout redirects flagged users to /auth/change-password and
-- blocks the dashboard until they set a new password that meets the
-- strength standard enforced in src/lib/password-policy.ts
-- (>= 12 chars, lower + upper + digit + symbol).
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;
