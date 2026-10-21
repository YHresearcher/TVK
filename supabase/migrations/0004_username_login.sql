-- =====================================================================
-- TVK 0004 — Username login
-- Supabase Auth identities stay email-based (invites, password reset,
-- account management all keep working by email). This migration adds an
-- optional short `username` per profile plus a resolver the login page
-- calls BEFORE sign-in (as the anon role) to translate username -> email.
-- Usernames are stored lowercase; uniqueness is case-insensitive.
-- Accepted trade-off for this internal shop app (a handful of staff
-- accounts): the resolver reveals the email behind an exact username.
-- =====================================================================

alter table profiles add column if not exists username text;

alter table profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

create unique index if not exists profiles_username_lower_key
  on profiles (lower(username))
  where username is not null;

create or replace function public.resolve_login_email(p_username text)
returns text
language sql
security definer
set search_path = public
as $$
  select email
  from profiles
  where username is not null
    and lower(username) = lower(trim(p_username))
    and is_active
    and email is not null
  limit 1;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;
