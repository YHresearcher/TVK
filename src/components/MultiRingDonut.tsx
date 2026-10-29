"use client";

import Link from "next/link";
import { useState } from "react";
import { formatNumber, formatVND } from "@/lib/format";
import type { RingSegment, StockRings } from "@/lib/types";

/** Biểu đồ 3 vòng đồng tâm: sở hữu × vị trí × trạng thái. Ba vòng độc lập,
 *  cùng phạm vi hàng đang quản lý và cùng chuẩn giá vốn. Chạm/bấm một đoạn
 *  (hoặc một dòng chú giải) thì hiện chi tiết của đoạn đó bên dưới, kèm link
 *  mở danh sách tồn kho đã lọc khi vòng đó có bộ lọc tương ứng. */

const SIZE = 300;
const CENTER = SIZE / 2;
const STROKE = 18;
const GAP_DEG = 4;

const RING_DEFS = [
  { key: "ownership", title: "Quyền sở hữu", radius: 141 },
  { key: "location", title: "Vị trí", radius: 117 },
  { key: "status", title: "Trạng thái", radius: 93 },
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
  let active: { ring: (typeof RING_DEFS)[number]; seg: RingSegment; total: number } | null = null;
  for (const def of RING_DEFS) {
    const segs = rings[def.key];
    const total = segs.reduce((a, s) => a + Math.max(displayOf(s), 0), 0);
    for (const s of segs) {
      if (`${def.key}:${s.key}` === activeKey) active = { ring: def, seg: s, total };
    }
  }

  const toggleSelect = (key: string) => setSelectedKey((cur) => (cur === key ? null : key));

  return (
    <div>
      <div className="flex flex-col gap-5">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="mx-auto w-full max-w-[300px] shrink-0"
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
                    <path key={key} d={arcPath(def.radius, start, start + sweep)} {...common}>
                      <title>{s.label}</title>
                    </path>
                  );
                })}
              </g>
            );
          })}
          <text x={CENTER} y={CENTER - 14} textAnchor="middle" fontSize="26" fontWeight="700" fill="#0f172a">
            {centerLabel}
          </text>
          <text x={CENTER} y={CENTER + 8} textAnchor="middle" fontSize="10.5" fill="#64748b">
            {centerLines[0]}
          </text>
          <text x={CENTER} y={CENTER + 22} textAnchor="middle" fontSize="10.5" fill="#64748b">
            {centerLines[1]}
          </text>
        </svg>

        <div className="min-w-0 flex-1 space-y-5">
          {RING_DEFS.map((def) => {
            const segs = rings[def.key];
            const total = segs.reduce((a, s) => a + Math.max(displayOf(s), 0), 0);
            return (
              <div key={def.key}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{def.title}</p>
                <ul className="space-y-1">
                  {segs.map((s) => {
                    const key = `${def.key}:${s.key}`;
                    const isActive = activeKey === key;
                    return (
                      <li key={s.key}>
                        <button
                          type="button"
                          aria-pressed={selectedKey === key}
                          onClick={() => toggleSelect(key)}
                          onMouseEnter={() => setHoverKey(key)}
                          onMouseLeave={() => setHoverKey(null)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${
                            isActive ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                          <span className="min-w-0 flex-1">{s.label}</span>
                          <span className="shrink-0 font-medium text-slate-900">{formatDisplay(displayOf(s))}</span>
                          <span className="w-11 shrink-0 text-right text-xs text-slate-500">{pct(displayOf(s), total)}</span>
                        </button>
                      </li>
                    );
                  })}
                  {segs.length === 0 && <li className="text-sm text-slate-500">Chưa có số liệu.</li>}
                </ul>
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
        <p className="mt-4 text-xs text-slate-500">Bấm vào một đoạn trên biểu đồ hoặc một dòng chú giải để xem giá trị, tỷ trọng và số lô.</p>
      )}
    </div>
  );
}
