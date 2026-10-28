"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  deleteUserAction,
  inviteUserAction,
  resetUserPasswordAction,
  setUserActiveAction,
  updateUserInfoAction,
  updateUserRoleAction,
} from "@/lib/actions";
import { btnCls, inputCls, labelCls } from "@/components/ui";
import { ROLE_LABELS, type AnyRow } from "@/lib/types";

const ROLES = Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[];

const smallBtn =
  "rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";
const dangerBtn =
  "rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40";

function UserRow({ u, isSelf }: { u: AnyRow; isSelf: boolean }) {
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState("");
  const router = useRouter();

  // Gọi action trực tiếp để lỗi (vd: trùng tên đăng nhập) hiện ngay
  // trong form thay vì vỡ cả trang — action ném lỗi thì bắt ở đây.
  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");
    try {
      await updateUserInfoAction(new FormData(e.currentTarget));
      setEditing(false);
      router.refresh();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Không lưu được, thử lại."
      );
    }
  }
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-52 flex-1">
        <p className="text-sm font-medium text-slate-900">
          {u.full_name}
          {isSelf && (
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-500">
              Tài khoản của bạn
            </span>
          )}
        </p>
        <p className="text-xs text-slate-500">
          {u.username ? `@${u.username} · ` : ""}
          {u.email ?? "—"} · {u.is_active ? "Đang hoạt động" : "Đã khoá"}
        </p>
      </div>

      <form action={updateUserRoleAction}>
        <input type="hidden" name="profile_id" value={u.id} />
        <select
          name="role"
          defaultValue={u.role}
          disabled={isSelf}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700 disabled:opacity-40"
          title="Đổi vai trò"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </form>

      <form action={setUserActiveAction}>
        <input type="hidden" name="profile_id" value={u.id} />
        <input type="hidden" name="active" value={u.is_active ? "0" : "1"} />
        <button type="submit" disabled={isSelf} className={smallBtn}>
          {u.is_active ? "Khoá" : "Mở khoá"}
        </button>
      </form>

      <form
        action={resetUserPasswordAction}
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Gửi email đặt lại mật khẩu cho ${u.email ?? u.full_name}?`
            )
          )
            e.preventDefault();
        }}
      >
        <input type="hidden" name="email" value={u.email ?? ""} />
        <button type="submit" className={smallBtn}>
          Đặt lại mật khẩu
        </button>
      </form>

      <form
        action={deleteUserAction}
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Xoá hẳn tài khoản ${u.full_name} (${u.email ?? ""})? Thao tác này không khôi phục được.`
            )
          )
            e.preventDefault();
        }}
      >
        <input type="hidden" name="profile_id" value={u.id} />
        <button type="submit" disabled={isSelf} className={dangerBtn}>
          Xoá
        </button>
      </form>
        <button type="button" onClick={() => { setEditing(!editing); setFormError(""); }} className={smallBtn}>
          {editing ? "Đóng" : "Sửa"}
        </button>
      </div>
      {editing && (
        <form onSubmit={handleSave} className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <input type="hidden" name="profile_id" value={u.id} />
          <div>
            <label className={labelCls}>Họ tên</label>
            <input name="full_name" defaultValue={u.full_name ?? ""} required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tên đăng nhập</label>
            <input name="username" defaultValue={u.username ?? ""} placeholder="Để trống = không có tên đăng nhập" className={inputCls} />
          </div>
          <button type="submit" className={btnCls}>Lưu thay đổi</button>
          <button type="button" onClick={() => setEditing(false)} className={smallBtn}>Huỷ</button>
          {formError && (
            <p className="w-full text-sm text-red-600">{formError}</p>
          )}
        </form>
      )}
    </div>
  );
}

export default function UserAdminPanel({
  users,
  meId,
  adminReady,
}: {
  users: AnyRow[];
  meId: string;
  adminReady: boolean;
}) {
  const [mode, setMode] = useState<"invite" | "password">("invite");

  if (!adminReady) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        Tính năng quản lý tài khoản chưa được bật trên máy chủ (thiếu khoá quản
        trị Supabase). Liên hệ người quản trị hệ thống để cấu hình
        SUPABASE_SERVICE_ROLE_KEY.
      </div>
    );
  }

  return (
    <div>
      <form
        action={inviteUserAction}
        className="grid gap-3 border-b border-slate-100 pb-5 sm:grid-cols-2"
      >
        <div>
          <label className={labelCls}>Email</label>
          <input
            name="email"
            type="email"
            required
            placeholder="nhanvien@cuahang.vn"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Họ tên</label>
          <input
            name="full_name"
            required
            placeholder="Nguyễn Văn A"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Tên đăng nhập (tuỳ chọn)</label>
          <input
            name="username"
            placeholder="vd: banhang1"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Vai trò</label>
          <select name="role" defaultValue="SALES" className={inputCls}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Cách tạo tài khoản</label>
          <select
            name="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as "invite" | "password")}
            className={inputCls}
          >
            <option value="invite">Gửi email mời — người dùng tự đặt mật khẩu</option>
            <option value="password">Đặt mật khẩu tạm ngay</option>
          </select>
        </div>
        {mode === "password" && (
          <div>
            <label className={labelCls}>Mật khẩu tạm (ít nhất 8 ký tự)</label>
            <input
              name="password"
              type="text"
              required
              placeholder="Trao tận tay cho nhân viên"
              className={inputCls}
            />
          </div>
        )}
        <div className="sm:col-span-2">
          <button type="submit" className={btnCls}>
            Tạo tài khoản
          </button>
        </div>
      </form>

      <div className="divide-y divide-slate-100">
        {users.map((u) => (
          <UserRow key={u.id} u={u} isSelf={u.id === meId} />
        ))}
      </div>
    </div>
  );
}
