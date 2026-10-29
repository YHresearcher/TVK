/**
 * Lightweight charts rendered as plain SVG on the server — no client JS,
 * no chart library. Values are formatted with compact Vietnamese units.
 */

export interface ChartDatum {
  label: string;
  value: number;
}

/** 3.980.000.000 → "3,98 tỷ", 1.250.000 → "1,2tr", 350.000 → "350k". */
export function formatCompactVND(v: number): string {
  const abs = Math.abs(v);
  const one = (n: number) =>
    n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
  if (abs >= 1e9) return `${one(v / 1e9)} tỷ`;
  if (abs >= 1e6) return `${one(v / 1e6)}tr`;
  if (abs >= 1e3) return `${Math.round(v / 1e3)}k`;
  return `${Math.round(v)}`;
}

export function BarChart({
  data,
  format = formatCompactVND,
  color = "#2563eb",
}: {
  data: ChartDatum[];
  format?: (v: number) => string;
  color?: string;
}) {
  const W = 640;
  const H = 250;
  const padTop = 26;
  const padBottom = 26;
  const padX = 6;
  const chartH = H - padTop - padBottom;
  const max = Math.max(0, ...data.map((d) => d.value));
  const slot = data.length ? (W - padX * 2) / data.length : W;
  const barW = Math.min(slot * 0.62, 44);
  const gridFracs = [0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {gridFracs.map((f) => {
        const y = padTop + chartH * (1 - f);
        return (
          <line
            key={f}
            x1={padX}
            x2={W - padX}
            y1={y}
            y2={y}
            stroke="#e2e8f0"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        );
      })}
      <line
        x1={padX}
        x2={W - padX}
        y1={padTop + chartH}
        y2={padTop + chartH}
        stroke="#cbd5e1"
        strokeWidth={1}
      />
      {data.map((d, i) => {
        const h = max > 0 ? (d.value / max) * chartH : 0;
        const x = padX + slot * i + (slot - barW) / 2;
        const y = padTop + chartH - h;
        const cx = padX + slot * i + slot / 2;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} rx={3} fill={color} />
            <text
              x={cx}
              y={Math.max(y - 5, 10)}
              textAnchor="middle"
              fontSize={10}
              fill="#475569"
            >
              {format(d.value)}
            </text>
            <text
              x={cx}
              y={padTop + chartH + 16}
              textAnchor="middle"
              fontSize={9.5}
              fill="#94a3b8"
            >
              {d.label}
            </text>
          </g>
        );
      })}
      {data.length === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={12} fill="#94a3b8">
          Chưa có dữ liệu
        </text>
      )}
    </svg>
  );
}

export interface GroupedDatum {
  label: string;
  a: number;
  b: number;
}

/** Biểu đồ cột đôi: nhóm A (xanh) và nhóm B (vàng) chung một thang đo. */
export function GroupedBarChart({
  data,
  labelA,
  labelB,
  format = formatCompactVND,
  colorA = "#2563eb",
  colorB = "#f59e0b",
}: {
  data: GroupedDatum[];
  labelA: string;
  labelB: string;
  format?: (v: number) => string;
  colorA?: string;
  colorB?: string;
}) {
  const W = 640;
  const H = 250;
  const padTop = 26;
  const padBottom = 26;
  const padX = 6;
  const chartH = H - padTop - padBottom;
  const max = Math.max(0, ...data.flatMap((d) => [d.a, d.b]));
  const slot = data.length ? (W - padX * 2) / data.length : W;
  const barW = Math.min(slot * 0.28, 30);
  const gridFracs = [0.25, 0.5, 0.75, 1];

  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: colorA }} />
          {labelA}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: colorB }} />
          {labelB}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
        {gridFracs.map((f) => {
          const y = padTop + chartH * (1 - f);
          return (
            <line
              key={f}
              x1={padX}
              x2={W - padX}
              y1={y}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          );
        })}
        <line
          x1={padX}
          x2={W - padX}
          y1={padTop + chartH}
          y2={padTop + chartH}
          stroke="#cbd5e1"
          strokeWidth={1}
        />
        {data.map((d, i) => {
          const hA = max > 0 ? (d.a / max) * chartH : 0;
          const hB = max > 0 ? (d.b / max) * chartH : 0;
          const cx = padX + slot * i + slot / 2;
          const xA = cx - barW - 2;
          const xB = cx + 2;
          return (
            <g key={i}>
              <rect x={xA} y={padTop + chartH - hA} width={barW} height={hA} rx={3} fill={colorA} />
              <rect x={xB} y={padTop + chartH - hB} width={barW} height={hB} rx={3} fill={colorB} />
              <text
                x={cx}
                y={Math.max(padTop + chartH - Math.max(hA, hB) - 5, 10)}
                textAnchor="middle"
                fontSize={10}
                fill="#475569"
              >
                {format(d.a)}
              </text>
              <text
                x={cx}
                y={padTop + chartH + 16}
                textAnchor="middle"
                fontSize={9.5}
                fill="#94a3b8"
              >
                {d.label}
              </text>
            </g>
          );
        })}
        {data.length === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={12} fill="#94a3b8">
            Chưa có dữ liệu
          </text>
        )}
      </svg>
    </div>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  segments,
  centerLabel,
  centerSub,
  format = formatCompactVND,
  size = 176,
}: {
  segments: DonutSegment[];
  centerLabel?: string;
  centerSub?: string;
  format?: (v: number) => string;
  size?: number;
}) {
  const stroke = 26;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + Math.max(s.value, 0), 0);
  let acc = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{ width: size, height: size }}
        className="shrink-0"
        role="img"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={stroke}
        />
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s, i) => {
              const frac = s.value / total;
              const dash = Math.max(frac * c - (segments.length > 1 ? 2 : 0), 0.5);
              const offset = -acc * c;
              acc += frac;
              return (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
            })}
        {centerLabel && (
          <text
            x={size / 2}
            y={size / 2 - (centerSub ? 2 : 0)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={19}
            fontWeight={700}
            fill="#0f172a"
          >
            {centerLabel}
          </text>
        )}
        {centerSub && (
          <text
            x={size / 2}
            y={size / 2 + 16}
            textAnchor="middle"
            fontSize={10}
            fill="#64748b"
          >
            {centerSub}
          </text>
        )}
      </svg>
      <ul className="min-w-44 flex-1 space-y-2">
        {segments.map((s, i) => {
          const pct = total > 0 ? (Math.max(s.value, 0) / total) * 100 : 0;
          return (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span className="flex-1 text-slate-600">{s.label}</span>
              <span className="font-medium text-slate-900">{format(s.value)}</span>
              <span className="w-12 text-right text-xs text-slate-400">
                {pct.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function HBarList({
  data,
  format = formatCompactVND,
}: {
  data: (ChartDatum & { color?: string })[];
  format?: (v: number) => string;
}) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (data.length === 0) {
    return <p className="py-4 text-center text-sm text-slate-400">Chưa có dữ liệu</p>;
  }
  return (
    <ul className="space-y-3">
      {data.map((d, i) => (
        <li key={i} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="min-w-0 text-xs text-slate-600 sm:w-44 sm:shrink-0 sm:truncate" title={d.label}>
            {d.label}
          </span>
          <span className="flex flex-1 items-center gap-3">
            <span className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
              <span
                className="block h-full rounded"
                style={{
                  width: `${max > 0 ? Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0) : 0}%`,
                  backgroundColor: d.color ?? "#2563eb",
                }}
              />
            </span>
            <span className="w-24 shrink-0 text-right text-sm font-medium text-slate-900">
              {format(d.value)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
