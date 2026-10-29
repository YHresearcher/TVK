"use client";

import Link from "next/link";
import { useState } from "react";
import { formatNumber, formatVND } from "@/lib/format";
import type { RingSegment, StockRings } from "@/lib/types";

/** Biểu đồ 3 vòng đồng tâm: sở hữu × vị trí × trạng thái. Ba vòng độc lập,
 *  cùng phạm vi hàng đang quản lý và cùng chuẩn giá vốn. Chạm/bấm một đoạn
 *  (hoặc một dòng chú giải) thì hiện chi tiết của đoạn đó bên dưới, kèm link
 *  mở danh sách tồn kho đã lọc khi vòng đó có bộ lọc tương ứng. */

const SIZE = 340;
const CENTER = SIZE / 2;
const STROKE = 20;
const GAP_DEG = 10;

const RING_DEFS = [
  { key: "ownership", title: "Quyền sở hữu", radius: 156 },
  { key: "location", title: "Vị trí", radius: 128 },
  { key: "status", title: "Trạng thái", radius: 100 },
] as const;

function pct(v: number, total: number): string {
  if (total <= 0) return "0,0%";
  return ((v / total) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + "%";
}

function polar(radius: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
}

function arcPath(radius: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(radius, startDeg);
  const [x2, y2] = polar(radius, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export default function MultiRingDonut({
  rings,
  canSeeMoney,
  centerLabel,
  centerLines,
}: {
  rings: StockRings;
  canSeeMoney: boolean;
  centerLabel: string;
  centerLines: [string, string];
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const displayOf = (s: RingSegment) => (canSeeMoney ? s.value : s.qty);
  const formatDisplay = (v: number) => (canSeeMoney ? formatVND(v) : `${formatNumber(v)} đơn vị`);

  const activeKey = hoverKey ?? selectedKey;
  // Hộp chi tiết chỉ theo LỰA CHỌN (bấm), không theo hover: rê chuột chỉ
  // làm mờ các đoạn khác, bấm lần nữa thì hộp đóng ngay cả khi chuột vẫn
  // đang đặt trên chip.
  let active: { ring: (typeof RING_DEFS)[number]; seg: RingSegment; total: number } | null = null;
  for (const def of RING_DEFS) {
    const segs = rings[def.key];
    const total = segs.reduce((a, s) => a + Math.max(displayOf(s), 0), 0);
    for (const s of segs) {
      if (`${def.key}:${s.key}` === selectedKey) active = { ring: def, seg: s, total };
    }
  }

  const toggleSelect = (key: string) => setSelectedKey((cur) => (cur === key ? null : key));

  return (
    <div>
      <div className="flex flex-col gap-5">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="mx-auto w-full max-w-[340px] shrink-0"
          role="img"
          aria-label="Biểu đồ cơ cấu tồn kho 3 vòng"
        >
          {RING_DEFS.map((def) => {
            const segs = rings[def.key].filter((s) => displayOf(s) > 0);
            const total = rings[def.key].reduce((a, s) => a + Math.max(displayOf(s), 0), 0);
            const sweepTotal = 360 - GAP_DEG * segs.length;
            let angle = 0;
            return (
              <g key={def.key}>
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={def.radius}
                  fill="none"
                  stroke="#f1f5f9"
                  strokeWidth={STROKE}
                />
                {segs.map((s) => {
                  const key = `${def.key}:${s.key}`;
                  const sweep = (Math.max(displayOf(s), 0) / total) * sweepTotal;
                  const start = angle;
                  angle += sweep + GAP_DEG;
                  const dim = activeKey !== null && activeKey !== key;
                  const common = {
                    fill: "none",
                    stroke: s.color,
                    strokeWidth: STROKE,
                    opacity: dim ? 0.3 : 1,
                    style: { cursor: "pointer", transition: "opacity 150ms" },
                    onMouseEnter: () => setHoverKey(key),
                    onMouseLeave: () => setHoverKey(null),
                    onClick: () => toggleSelect(key),
                  };
                  return segs.length === 1 ? (
                    <circle key={key} cx={CENTER} cy={CENTER} r={def.radius} {...common}>
                      <title>{s.label}</title>
                    </circle>
                  ) : (
                    <path key={key} d={arcPath(def.radius, start, start + sweep)} strokeLinecap="round" {...common}>
                      <title>{s.label}</title>
                    </path>
                  );
                })}
              </g>
            );
          })}
          <text x={CENTER} y={CENTER - 16} textAnchor="middle" fontSize="30" fontWeight="700" fill="#0f172a">
            {centerLabel}
          </text>
          <text x={CENTER} y={CENTER + 10} textAnchor="middle" fontSize="11" fill="#64748b">
            {centerLines[0]}
          </text>
          <text x={CENTER} y={CENTER + 26} textAnchor="middle" fontSize="11" fill="#64748b">
            {centerLines[1]}
          </text>
        </svg>

        <div className="min-w-0 flex-1 space-y-4">
          {RING_DEFS.map((def) => {
            const segs = rings[def.key];
            const total = segs.reduce((a, s) => a + Math.max(displayOf(s), 0), 0);
            return (
              <div key={def.key}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{def.title}</p>
                <div className="flex flex-wrap gap-2">
                  {segs.map((s) => {
                    const key = `${def.key}:${s.key}`;
                    const isActive = activeKey === key;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        aria-pressed={selectedKey === key}
                        onClick={() => toggleSelect(key)}
                        onMouseEnter={() => setHoverKey(key)}
                        onMouseLeave={() => setHoverKey(null)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm ${
                          isActive
                            ? "border-blue-600 bg-blue-50 font-medium text-blue-700"
                            : "border-slate-300 bg-white text-slate-700 hover:border-blue-500 hover:text-blue-700"
                        }`}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                        <span>{s.label}</span>
                        <span className="font-medium text-slate-900">{formatDisplay(displayOf(s))}</span>
                        <span className="text-xs text-slate-500">{pct(displayOf(s), total)}</span>
                      </button>
                    );
                  })}
                  {segs.length === 0 && <p className="text-sm text-slate-500">Chưa có số liệu.</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {active ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
          <p className="font-medium text-slate-900">
            {active.ring.title}: {active.seg.label}
          </p>
          <p className="mt-0.5 text-slate-700">
            {formatDisplay(displayOf(active.seg))} · {pct(displayOf(active.seg), active.total)} · {active.seg.lots} lô
          </p>
          {active.seg.href ? (
            <p className="mt-1.5">
              <Link href={active.seg.href} className="font-medium text-blue-700 hover:underline">
                Xem tồn kho đã lọc →
              </Link>
            </p>
          ) : (
            <p className="mt-1.5">
              <Link href="/inventory" className="font-medium text-blue-700 hover:underline">
                Xem tồn kho →
              </Link>
              <span className="text-xs text-slate-500"> (chưa có lọc theo trạng thái)</span>
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-xs text-slate-500">Bấm một đoạn hoặc chip để xem chi tiết.</p>
      )}
    </div>
  );
}
