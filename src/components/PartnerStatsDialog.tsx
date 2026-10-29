"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { labelCls } from "@/components/ui";
import { formatNumber, formatVND } from "@/lib/format";
import type { PartnerStat } from "@/lib/queries";

/** Bấm tên đối tác là mở cửa sổ bật lên xem nhanh 5 số liệu, không tải lại
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
        { label: "Hàng còn ở đối tác", sub: "Số đơn vị đang ở chỗ đối tác", value: formatNumber(selected.stillAtPartner) },
      ]
    : [];

  return (
    <div>
      <p className={labelCls}>Chọn đối tác</p>
      {partners.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa có đối tác.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {partners.map((p) => {
            const active = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedId(p.id)}
                className={
                  active
                    ? "rounded-full border border-blue-600 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700"
                    : "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-blue-500 hover:text-blue-700"
                }
              >
                {p.name}
              </button>
            );
          })}
        </div>
      )}

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
