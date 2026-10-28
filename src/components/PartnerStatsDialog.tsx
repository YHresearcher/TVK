"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { inputCls, labelCls } from "@/components/ui";
import { formatNumber, formatVND } from "@/lib/format";
import type { PartnerStat } from "@/lib/queries";

/** Chọn đối tác là mở cửa sổ bật lên xem nhanh 5 số liệu, không tải lại
 *  trang. Cuối cửa sổ có link mở trang chi tiết của đối tác đó. */
export default function PartnerStatsDialog({ partners }: { partners: PartnerStat[] }) {
  const [selectedId, setSelectedId] = useState("");
  const selected = partners.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const rows: { label: string; sub: string; value: string }[] = selected
    ? [
        { label: "Số dư còn phải thu", sub: "Đối tác còn nợ TVK", value: formatVND(selected.outstanding) },
        { label: "Đã thanh toán", sub: "Tổng tiền đã thu", value: formatVND(selected.totalPaid) },
        { label: "Hoá đơn đã xuất", sub: "Hoá đơn đang hiệu lực", value: formatNumber(selected.invoiceCount) },
        { label: "Giá trị hoá đơn", sub: "Tổng tiền hoá đơn đang hiệu lực", value: formatVND(selected.invoiceTotal) },
        { label: "Hàng còn ở đối tác", sub: "Số cái đang ở chỗ đối tác", value: formatNumber(selected.stillAtPartner) },
      ]
    : [];

  return (
    <div>
      <label className={labelCls}>Chọn đối tác</label>
      <select
        value={selectedId}
        className={inputCls}
        onChange={(e) => setSelectedId(e.target.value)}
      >
        <option value="">— Chọn đối tác —</option>
        {partners.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
          onClick={() => setSelectedId("")}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Thống kê ${selected.name}`}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">{selected.name}</h2>
              <button
                type="button"
                aria-label="Đóng"
                autoFocus
                onClick={() => setSelectedId("")}
                className="rounded-md px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100"
              >
                ×
              </button>
            </div>
            <dl className="divide-y divide-slate-100">
              {rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-4 py-2.5">
                  <div>
                    <dt className="text-sm font-medium text-slate-800">{r.label}</dt>
                    <dd className="text-xs text-slate-500">{r.sub}</dd>
                  </div>
                  <dd className="text-base font-semibold text-slate-900">{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-slate-100 pt-4 text-sm">
              <Link
                href={`/partners/${selected.id}`}
                className="font-medium text-blue-700 hover:underline"
              >
                Mở trang chi tiết {selected.name} →
              </Link>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
