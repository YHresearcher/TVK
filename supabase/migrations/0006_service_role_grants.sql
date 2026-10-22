-- =====================================================================
-- TVK 0006 — Table privileges for the service_role (account admin)
-- The OWNER account-management features (invite/create users, bans,
-- deletions via server actions) read and write profiles through the
-- Supabase service-role key. Like `authenticated` in 0005, service_role
-- also needs table privileges on objects created by raw SQL before it
-- can touch them (it bypasses RLS, not Postgres privileges).
-- =====================================================================

grant select, insert, update, delete
  on all tables in schema public
  to service_role;

grant usage, select, update
  on all sequences in schema public
  to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select, update on sequences to service_role;
