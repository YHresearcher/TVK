"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import PasswordRules from "@/components/PasswordRules";
import { validatePassword } from "@/lib/password-policy";

type Phase = "checking" | "ready" | "nosession" | "saving";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const configured = isSupabaseConfigured();

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setPhase("nosession");
      return;
    }
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user?.email) {
        setEmail(data.session.user.email);
        setPhase("ready");
      } else {
        setPhase("nosession");
      }
    })();
  }, []);

  async function onSignOut() {
    const supabase = createClient();
    await supabase?.auth.signOut();
    router.push("/login");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    if (!supabase) return;
    const problems = validatePassword(password);
    if (problems.length) {
      setError(`Mật khẩu mới chưa đạt chuẩn: ${problems.join("; ")}.`);
      return;
    }
    if (password !== confirm) {
      setError("Mật khẩu nhập lại không khớp.");
      return;
    }
    if (password === current) {
      setError("Mật khẩu mới phải khác mật khẩu hiện tại.");
      return;
    }
    setPhase("saving");
    setError("");
    // Xác minh mật khẩu hiện tại trước khi đổi.
    const verify = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (verify.error) {
      setPhase("ready");
      setError("Mật khẩu hiện tại không đúng.");
      return;
    }
    const { error: updError } = await supabase.auth.updateUser({ password });
    if (updError) {
      setPhase("ready");
      setError(updError.message);
      return;
    }
    // Đổi xong: gỡ cờ bắt buộc đổi mật khẩu trong hồ sơ của chính mình.
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      await supabase
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", userData.user.id);
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-stone-900">TVK</h1>
        <p className="mt-1 text-sm text-stone-500">Tân Vạn Khang · Đổi mật khẩu</p>

        {!configured || phase === "nosession" ? (
          <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            Bạn cần đăng nhập trước khi đổi mật khẩu.{" "}
            <Link href="/login" className="font-medium underline">
              Đi tới đăng nhập
            </Link>
          </div>
        ) : phase === "checking" ? (
          <p className="mt-6 text-sm text-slate-500">Đang kiểm tra phiên đăng nhập…</p>
        ) : (
          <>
            <p className="mt-4 rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-600">
              Tài khoản của bạn đang dùng mật khẩu tạm, hoặc vừa yêu cầu đặt
              lại mật khẩu. Hãy đặt mật khẩu mới đạt chuẩn bên dưới để tiếp
              tục vào hệ thống.
            </p>
            <form onSubmit={onSubmit} className="mt-5 space-y-4">
              <div>
                <label className={labelCls}>Mật khẩu hiện tại</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Mật khẩu mới</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  placeholder="Ít nhất 8 ký tự, đủ chữ thường / HOA / số / ký tự đặc biệt"
                />
                <div className="mt-2">
                  <PasswordRules password={password} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Xác nhận mật khẩu mới</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={inputCls}
                />
              </div>
              {error && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
              )}
              <button type="submit" disabled={phase === "saving"} className={btnCls}>
                {phase === "saving" ? "Đang đổi…" : "Đổi mật khẩu và tiếp tục"}
              </button>
              <button type="button" onClick={onSignOut} className={btnGhostCls}>
                Đăng xuất
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
