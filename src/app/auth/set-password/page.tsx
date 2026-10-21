"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { btnCls, inputCls, labelCls } from "@/components/ui";

type Phase = "checking" | "ready" | "invalid" | "saving" | "done";

export default function SetPasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const configured = isSupabaseConfigured();

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setPhase("invalid");
      return;
    }
    (async () => {
      // Email links can fail with the reason in the URL fragment.
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (hash.get("error")) {
        setPhase("invalid");
        return;
      }
      // Auto-detection (PKCE code exchange / implicit tokens) may already
      // have established the session when the client initialized.
      const first = await supabase.auth.getSession();
      if (first.data.session) {
        setPhase("ready");
        return;
      }
      // PKCE flow: ?code=... in the query string.
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          setPhase("ready");
          return;
        }
      }
      // Implicit flow: tokens in the URL fragment (dashboard invite links).
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error) {
          window.history.replaceState(null, "", window.location.pathname);
          setPhase("ready");
          return;
        }
      }
      // Give auto-detection one last chance before declaring the link dead.
      await new Promise((r) => setTimeout(r, 1200));
      const again = await supabase.auth.getSession();
      setPhase(again.data.session ? "ready" : "invalid");
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    if (!supabase) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPhase("saving");
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setPhase("ready");
      setError(error.message);
      return;
    }
    setPhase("done");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-slate-900">TVK</h1>
        <p className="mt-1 text-sm text-slate-500">Set your password</p>

        {!configured || phase === "invalid" ? (
          <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            {configured
              ? "This link is invalid or has expired. Ask the shop owner to send a new invitation, or use “Forgot password” on the sign-in page."
              : "Supabase is not configured yet."}{" "}
            <Link href="/login" className="font-medium underline">
              Go to sign in
            </Link>
          </div>
        ) : phase === "checking" ? (
          <p className="mt-6 text-sm text-slate-500">Verifying your link…</p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className={labelCls}>New password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className={labelCls}>Confirm password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputCls}
                placeholder="Repeat the password"
              />
            </div>
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={phase === "saving"}
              className={`${btnCls} w-full`}
            >
              {phase === "saving" ? "Saving…" : "Save password and continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
