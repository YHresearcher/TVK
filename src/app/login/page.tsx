"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { flagPasswordResetRequestedAction } from "@/lib/actions";
import { btnCls, inputCls, labelCls } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const configured = isSupabaseConfigured();

  /** Emails are the auth identity; a bare username is resolved first. */
  async function resolveEmail(
    supabase: NonNullable<ReturnType<typeof createClient>>,
    rawId: string
  ): Promise<string | null> {
    const raw = rawId.trim();
    if (raw.includes("@")) return raw;
    const { data, error: rpcError } = await supabase.rpc("resolve_login_email", {
      p_username: raw.toLowerCase(),
    });
    if (rpcError || !data) return null;
    return String(data);
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    if (!supabase) return;
    setLoading(true);
    setError("");
    setNotice("");
    const email = await resolveEmail(supabase, identifier);
    if (!email) {
      setLoading(false);
      setError("Không tìm thấy tài khoản với email hoặc tên đăng nhập đó.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/set-password`,
    });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }
    // Gắn cờ bắt buộc đổi mật khẩu cho lần đăng nhập sau khi đặt lại.
    await flagPasswordResetRequestedAction(email);
    setLoading(false);
    setNotice("Đã gửi liên kết đặt lại mật khẩu — hãy kiểm tra email của bạn.");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    if (!supabase) return;
    setLoading(true);
    setError("");
    // Username sign-in: resolve the account email first (RPC from migration 0004).
    const loginEmail = await resolveEmail(supabase, identifier);
    if (!loginEmail) {
      setLoading(false);
      setError("Tên đăng nhập hoặc mật khẩu không đúng.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-slate-900">TVK</h1>
        <p className="mt-1 text-sm text-slate-500">
          Quản lý kho phụ tùng ô tô — đăng nhập để tiếp tục
        </p>
        {!configured ? (
          <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            Supabase chưa được cấu hình. Hãy đặt{" "}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> và{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> trong{" "}
            <code>.env.local</code> trước (xem <code>supabase/README.md</code>).
          </div>
        ) : (
          <form
            onSubmit={mode === "login" ? onSubmit : onForgot}
            className="mt-6 space-y-4"
          >
            <div>
              <label className={labelCls}>Email hoặc tên đăng nhập</label>
              <input
                type="text"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className={inputCls}
                placeholder="you@company.vn hoặc tên đăng nhập"
              />
            </div>
            {mode === "login" && (
              <div>
                <label className={labelCls}>Mật khẩu</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  placeholder="••••••••"
                />
              </div>
            )}
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            {notice && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {notice}
              </p>
            )}
            <button type="submit" disabled={loading} className={`${btnCls} w-full`}>
              {loading
                ? mode === "login"
                  ? "Đang đăng nhập…"
                  : "Đang gửi…"
                : mode === "login"
                  ? "Đăng nhập"
                  : "Gửi liên kết đặt lại"}
            </button>
            <p className="text-center text-sm">
              {mode === "login" ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setError("");
                    setNotice("");
                  }}
                  className="text-slate-500 underline hover:text-slate-700"
                >
                  Quên mật khẩu?
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError("");
                    setNotice("");
                  }}
                  className="text-slate-500 underline hover:text-slate-700"
                >
                  ← Quay lại đăng nhập
                </button>
              )}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
