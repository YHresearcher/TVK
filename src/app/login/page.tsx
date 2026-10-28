"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { flagPasswordResetRequestedAction } from "@/lib/actions";

const BRONZE = "#A78B5B";

const inputCls =
  "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200";
const labelCls = "block text-sm font-medium text-stone-600 mb-1.5";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-100 px-4 py-10">
      {/* Backdrop: faint dot pattern, soft warm glow, faint watermark */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(rgba(120,113,108,0.14) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-stone-200 opacity-60 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none whitespace-nowrap text-[16rem] font-black leading-none text-stone-900/[0.04]">
        TVK
      </div>

      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-[0_20px_50px_-20px_rgba(28,25,23,0.25)] sm:p-10">
          <div className="text-center">
            <p className="text-5xl font-black tracking-tight text-stone-900">
              TVK<span style={{ color: BRONZE }}>.</span>
            </p>
            <p className="mt-2 text-xs font-medium uppercase tracking-[0.3em] text-stone-500">
              Tân Vạn Khang
            </p>
            <p className="mt-4 text-sm leading-relaxed text-stone-500">
              Quản lý kho phụ tùng ô tô — tồn kho, hàng ký gửi, rõ ràng
              từng lô.
            </p>
          </div>

          <h1 className="mt-8 text-xl font-bold tracking-tight text-stone-900">
            {mode === "login" ? "Đăng nhập" : "Quên mật khẩu"}
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            {mode === "login"
              ? "Chào mừng trở lại — đăng nhập để tiếp tục."
              : "Nhập email hoặc tên đăng nhập, hệ thống sẽ gửi liên kết đặt lại về email của bạn."}
          </p>

          {!configured ? (
            <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-800">
              Supabase chưa được cấu hình. Hãy đặt{" "}
              <code>NEXT_PUBLIC_SUPABASE_URL</code> và{" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> trong{" "}
              <code>.env.local</code> trước (xem <code>supabase/README.md</code>).
            </div>
          ) : (
            <form
              onSubmit={mode === "login" ? onSubmit : onForgot}
              className="mt-6 space-y-5"
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
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${inputCls} pr-16`}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-stone-500 hover:text-stone-800"
                    >
                      {showPassword ? "Ẩn" : "Hiện"}
                    </button>
                  </div>
                </div>
              )}
              {error && (
                <p className="rounded-xl border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </p>
              )}
              {notice && (
                <p className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {notice}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-stone-900 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-stone-800 disabled:opacity-50"
              >
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
                    className="font-medium text-stone-600 underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
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
                    className="font-medium text-stone-600 underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
                  >
                    ← Quay lại đăng nhập
                  </button>
                )}
              </p>
            </form>
          )}
          <p className="mt-8 text-center text-xs text-stone-400">
            Chưa có tài khoản? Liên hệ quản trị viên để được cấp.
          </p>
        </div>
        <p className="mt-6 text-center text-xs text-stone-400">
          TVK management system by Thanh Phan · version 1.0
        </p>
      </div>
    </div>
  );
}
