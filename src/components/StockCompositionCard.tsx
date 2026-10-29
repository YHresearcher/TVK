"use client";

import Link from "next/link";
import { Card } from "@/components/ui";
import { formatCompactVND2 } from "@/components/Charts";
import MultiRingDonut from "@/components/MultiRingDonut";
import { formatNumber, formatVND } from "@/lib/format";
import type { StockRings } from "@/lib/types";

function pct(n: number): string {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + "%";
}

/** Thẻ cơ cấu tồn kho: biểu đồ 3 vòng đồng tâm (sở hữu × vị trí × trạng
 *  thái), cả ba vòng cùng phạm vi (toàn bộ hàng đang quản lý, kể cả hàng
 *  giữ hộ) và cùng chuẩn giá vốn lô. Ở giữa vòng là TỔNG GIÁ TRỊ HÀNG ĐANG
 *  QUẢN LÝ theo giá vốn, kèm dòng tách rõ hàng TVK sở hữu với hàng giữ hộ.
 *  Ba mức giá vốn/sỉ/lẻ bên dưới chỉ tính hàng của TVK trong kho — đó là ba
 *  cách định giá cùng một lượng hàng, không phải ba phần của một tổng nên
 *  không vẽ thành vòng. */
export default function StockCompositionCard({
  rings,
  tierValues,
  ownedBookValue,
  ownedQty,
  managedBookValue,
  custodyBookValue,
  custodyQty,
  canSeeMoney,
  canSeeCost,
}: {
  rings: StockRings;
  tierValues: { cost: number; wholesale: number; retail: number };
  ownedBookValue: number;
  ownedQty: number;
  managedBookValue: number;
  custodyBookValue: number;
  custodyQty: number;
  canSeeMoney: boolean;
  canSeeCost: boolean;
}) {
  const { cost, wholesale, retail } = tierValues;
  const marginPct = retail > 0 ? ((retail - cost) / retail) * 100 : 0;

  return (
    <Card title="Cơ cấu tồn kho" tone="violet">
      <div className="flex justify-end">
        <details className="relative shrink-0">
          <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full border border-slate-300 text-sm text-slate-500 hover:bg-slate-50" title="Cách tính">
            ⓘ
          </summary>
          <div className="absolute right-0 top-8 z-10 w-72 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-lg">
            <p>Ba vòng là ba chiều của cùng một lượng hàng, đều theo giá vốn lô. Hàng giữ hộ không phải tài sản.</p>
            <p className="mt-2">&ldquo;Giữ cho chứng từ nháp&rdquo; là lượng hàng trên chứng từ nháp, tối đa bằng tồn thực tế. Ba mức giá dưới chỉ tính hàng trong kho.</p>
          </div>
        </details>
      </div>

      <div className="mt-4">
        <MultiRingDonut
          rings={rings}
          canSeeMoney={canSeeMoney}
          centerLabel={canSeeMoney ? formatCompactVND2(managedBookValue) : `${formatNumber(ownedQty + custodyQty)} đơn vị`}
          centerLines={
            canSeeMoney
              ? ["Tổng giá trị hàng đang quản lý", "theo giá vốn"]
              : ["Tổng hàng đang quản lý", "kể cả hàng giữ hộ"]
          }
        />
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          {canSeeMoney
            ? `Trong đó: hàng TVK sở hữu ${formatVND(ownedBookValue)} · hàng giữ hộ ${formatVND(custodyBookValue)} (không phải tài sản).`
            : `Trong đó: hàng TVK ${formatNumber(ownedQty)} đơn vị · giữ hộ ${formatNumber(custodyQty)} đơn vị.`}
        </p>
      </div>

      {canSeeCost && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Giá trị hàng TVK tại kho</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Giá vốn</p>
              <p className="mt-1 text-lg font-bold leading-tight text-slate-900">{formatCompactVND2(cost)}</p>
              <p className="mt-0.5 text-xs text-slate-500">Giá trị vốn tồn kho</p>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Giá sỉ</p>
              <p className="mt-1 text-lg font-bold leading-tight text-slate-900">{formatCompactVND2(wholesale)}</p>
              <p className="mt-0.5 text-xs text-slate-500">+{formatCompactVND2(wholesale - cost)} ({cost > 0 ? pct(((wholesale - cost) / cost) * 100) : "—"})</p>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Giá lẻ</p>
              <p className="mt-1 text-lg font-bold leading-tight text-slate-900">{formatCompactVND2(retail)}</p>
              <p className="mt-0.5 text-xs text-slate-500">+{formatCompactVND2(retail - cost)} ({cost > 0 ? pct(((retail - cost) / cost) * 100) : "—"})</p>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Biên tiềm năng theo giá lẻ: {pct(marginPct)} (lý thuyết, chưa trừ chi phí).
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
