"use client";

import { useState, type ReactNode } from "react";

const TONE_TOP: Record<string, string> = {
  blue: "border-t-blue-600",
  sky: "border-t-sky-500",
  amber: "border-t-amber-500",
  emerald: "border-t-emerald-500",
  violet: "border-t-violet-500",
  rose: "border-t-rose-500",
  slate: "border-t-slate-400",
};

export type CollapsibleTone = "blue" | "sky" | "amber" | "emerald" | "violet" | "rose" | "slate";

/**
 * Thẻ thu gọn mặc định trên Tổng quan: chỉ hiện tiêu đề, bấm để mở xem
 * đầy đủ. Dữ liệu vẫn đầy đủ, chỉ gọn giao diện — CEO nhìn lướt không
 * bị ngập số, cần thì mở ra xem.
 */
export default function CollapsibleCard({
  title,
  tone,
  children,
  hint = "Bấm để xem",
}: {
  title: string;
  tone?: CollapsibleTone;
  children: ReactNode;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={
        tone
          ? `rounded-lg border border-slate-200 border-t-4 bg-white shadow-sm ${TONE_TOP[tone]}`
          : "rounded-lg border border-slate-200 bg-white shadow-sm"
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs whitespace-nowrap text-slate-500">
          <span>{open ? "Thu gọn" : hint}</span>
          <span aria-hidden="true" className={`inline-block transition-transform ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </span>
      </button>
      {open && <div className="border-t border-slate-100 p-4">{children}</div>}
    </div>
  );
}
