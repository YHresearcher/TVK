"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { inputCls } from "@/components/ui";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export default function UsernameForm({
  profileId,
  username,
  canEdit,
}: {
  profileId: string;
  username: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(username ?? "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canEdit) return <span>{username ?? "—"}</span>;

  async function save() {
    const supabase = createClient();
    if (!supabase) return;
    const v = value.trim().toLowerCase();
    if (v && !USERNAME_RE.test(v)) {
      setMsg("3–32 ký tự: a–z, 0–9, dấu chấm, gạch dưới, gạch ngang.");
      return;
    }
    setBusy(true);
    setMsg("");
    const { error } = await supabase
      .from("profiles")
      .update({ username: v || null })
      .eq("id", profileId);
    setBusy(false);
    if (error) {
      setMsg(
        error.code === "23505" || error.message.includes("profiles_username")
          ? "Tên đăng nhập này đã có người dùng."
          : error.message
      );
      return;
    }
    setMsg("Đã lưu.");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="—"
        className={`${inputCls} w-36`}
      />
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? "Đang lưu…" : "Lưu"}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}
