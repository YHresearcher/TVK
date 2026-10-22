import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for OWNER account administration (invite/create users,
 * bans, deletions). The service-role key bypasses RLS, so this module must
 * only ever be imported by server-side code (server actions) — never by a
 * client component. The key itself lives in SUPABASE_SERVICE_ROLE_KEY
 * (no NEXT_PUBLIC_ prefix, set only on the server / Vercel env).
 */
export function isAdminConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
