"use client";

import { useEffect, useState } from "react";
import { HELP_SECTIONS } from "@/lib/help-content";
import { ROLE_LABELS, type AppRole } from "@/lib/types";

/**
 * Nút "Trợ giúp" ở góc trên: mở cửa sổ hướng dẫn chỉ gồm các mục dành
 * cho vai trò của người đang đăng nhập (mục "ALL" luôn hiển thị).
 */
export default function HelpButton({ role }: { role: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  const roleLabel = ROLE_LABELS[role as AppRole] ?? (role || "người dùng");
  const sections = HELP_SECTIONS.filter(
    (s) => s.roles.includes("ALL") || s.roles.includes(role)
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
          ?
        </span>
        Trợ giúp
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-bold text-slate-900">
                Trợ giúp — hướng dẫn cho vai trò {roleLabel}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Đóng trợ giúp"
                className="rounded-md px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-6">
              {sections.map((s) => (
                <section key={s.id}>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-800">
                    {s.title}
                  </h3>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
                    {s.points.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </section>
              ))}
              {sections.length === 0 && (
                <p className="text-sm text-slate-500">
                  Chưa có nội dung trợ giúp cho vai trò này.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
