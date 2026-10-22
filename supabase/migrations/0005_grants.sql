-- =====================================================================
-- TVK 0005 — Table privileges for the API roles (bug fix)
-- Migrations 0001–0003 enabled RLS and created policies but never
-- GRANTed table privileges to the PostgREST roles. Without a GRANT,
-- Postgres rejects every table query with 42501 before RLS is even
-- evaluated. Symptom in the app: after sign-in the app could not read
-- `profiles`, treated the user as profile-less and bounced between
-- /login and /dashboard (Chrome: "This page isn't working").
-- RLS policies remain the real access gate; these grants only let the
-- API reach the tables at all. The app never reads tables before
-- sign-in (the only pre-login call is the resolve_login_email RPC,
-- granted in 0004), so `anon` intentionally gets no table privileges.
-- =====================================================================

grant select, insert, update, delete
  on all tables in schema public
  to authenticated;

grant usage, select, update
  on all sequences in schema public
  to authenticated;

-- Same treatment for objects created later by the postgres role
-- (views are included in "tables" for privilege purposes).
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select, update on sequences to authenticated;
