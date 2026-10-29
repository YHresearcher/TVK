"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { DonutChart, formatCompactVND } from "@/components/Charts";
import { formatNumber, formatVND } from "@/lib/format";

export interface CompositionSegmentInput {
  label: string;
  color: string;
  qty: number;
  real: number;
  cost: number;
  wholesale: number;
  retail: number;
}

type Basis = "real" | "cost" | "wholesale" | "retail";

const BASIS_LABELS: Record<Basis, string> = {
  real: "Giá trị thật (quản trị)",
  cost: "Giá vốn",
  wholesale: "Giá sỉ",
  retail: "Giá lẻ",
};

const BASIS_NOTES: Record<Basis, string> = {
  real: "Hàng trong kho tính theo giá bán (lẻ trước, sỉ sau); hàng tại đối tác theo giá chuyển giao.",
  cost: "Mọi nhóm đều tính theo giá vốn lô — cùng một chuẩn kế toán.",
  wholesale: "Hàng trong kho tính theo giá sỉ; hàng tại đối tác theo giá chuyển giao (không có giá sỉ).",
  retail: "Hàng trong kho tính theo giá lẻ; hàng tại đối tác theo giá chuyển giao (không có giá lẻ).",
};

function pct(n: number): string {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + "%";
}

export default function StockCompositionCard({
  segments,
  tierValues,
  ownedBookValue,
  ownedQty,
  canSeeMoney,
  canSeeCost,
}: {
  segments: CompositionSegmentInput[];
  tierValues: { cost: number; wholesale: number; retail: number };
  ownedBookValue: number;
  ownedQty: number;
  canSeeMoney: boolean;
  canSeeCost: boolean;
}) {
  const [basis, setBasis] = useState<Basis>("real");
  const valueOf = (s: CompositionSegmentInput) => (canSeeMoney ? s[basis] : s.qty);
  const donutSegments = segments.map((s) => ({ label: s.label, value: valueOf(s), color: s.color }));
  const total = donutSegments.reduce((a, s) => a + Math.max(s.value, 0), 0);
  const { cost, wholesale, retail } = tierValues;
  const marginPct = retail > 0 ? ((retail - cost) / retail) * 100 : 0;

  return (
    <Card title="Cơ cấu tồn kho" tone="violet">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tổng giá trị hàng TVK sở hữu</p>
          <p className="mt-1 text-2xl font-bold leading-tight text-slate-900">
            {canSeeMoney ? formatVND(ownedBookValue) : `${formatNumber(ownedQty)} cái`}
          </p>
          <p className="text-xs text-slate-500">
            {canSeeMoney ? "Theo giá vốn — kho TVK + hàng tại đối tác, không gồm hàng nhận ký gửi" : "Hàng TVK tại kho và tại đối tác, không gồm hàng nhận ký gửi"}
          </p>
        </div>
        <details className="relative shrink-0">
          <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full border border-slate-300 text-sm text-slate-500 hover:bg-slate-50" title="Cách tính">
            ⓘ
          </summary>
          <div className="absolute right-0 top-8 z-10 w-72 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-lg">
            <p>Ba nhóm không trùng nhau, phủ hết hàng đang quản lý: hàng TVK tại kho, hàng TVK tại đối tác, và hàng nhận ký gửi (của nhà cung cấp, TVK chỉ giữ hộ).</p>
            <p className="mt-2">Hàng giữ hộ không phải tài sản của cửa hàng. Hàng tại đối tác tính theo giá chuyển giao mới nhất của từng lô, trừ khi xem theo giá vốn thì tính theo giá vốn lô.</p>
            <p className="mt-2">Ba mức giá dưới đây chỉ tính hàng của TVK trong kho, chưa gồm hàng ở đối tác.</p>
          </div>
        </details>
      </div>

      {canSeeMoney && (
        <div className="mt-4 flex items-center gap-2">
          <label htmlFor="donut-basis" className="text-sm text-slate-600">Cơ sở định giá</label>
          <select
            id="donut-basis"
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
            value={basis}
            onChange={(e) => setBasis(e.target.value as Basis)}
          >
            {(Object.keys(BASIS_LABELS) as Basis[]).map((b) => (
              <option key={b} value={b}>{BASIS_LABELS[b]}</option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-4">
        <DonutChart
          segments={donutSegments}
          format={canSeeMoney ? formatCompactVND : (v) => formatNumber(v)}
          centerLabel={canSeeMoney ? formatCompactVND(total) : formatNumber(total)}
          centerSub="Tổng hàng đang quản lý"
          size={136}
        />
        {canSeeMoney && (
          <p className="mt-2 text-xs leading-relaxed text-slate-500">{BASIS_NOTES[basis]}</p>
        )}
      </div>

      {canSeeCost && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Giá trị hàng TVK tại kho</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Giá vốn</p>
              <p className="mt-1 text-lg font-bold leading-tight text-slate-900">{formatCompactVND(cost)}</p>
              <p className="mt-0.5 text-xs text-slate-500">Giá trị vốn tồn kho</p>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Giá sỉ</p>
              <p className="mt-1 text-lg font-bold leading-tight text-slate-900">{formatCompactVND(wholesale)}</p>
              <p className="mt-0.5 text-xs text-slate-500">+{formatCompactVND(wholesale - cost)} ({cost > 0 ? pct(((wholesale - cost) / cost) * 100) : "—"})</p>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Giá lẻ</p>
              <p className="mt-1 text-lg font-bold leading-tight text-slate-900">{formatCompactVND(retail)}</p>
              <p className="mt-0.5 text-xs text-slate-500">+{formatCompactVND(retail - cost)} ({cost > 0 ? pct(((retail - cost) / cost) * 100) : "—"})</p>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Biên lợi nhuận gộp tiềm năng theo giá lẻ: {pct(marginPct)} — lý thuyết nếu bán toàn bộ hàng ở giá lẻ,
            chưa trừ chiết khấu, chi phí và hao hụt; không phải lợi nhuận đã thực hiện.
          </p>
        </div>
      )}

      <p className="mt-4 text-sm">
        <Link href="/inventory" className="font-medium text-blue-700 hover:underline">
          Xem chi tiết tồn kho →
        </Link>
      </p>
    </Card>
  );
}
