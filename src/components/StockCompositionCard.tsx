"use client";

import Link from "next/link";
import { Card } from "@/components/ui";
import { formatCompactVND, formatCompactVND2 } from "@/components/Charts";
import MultiRingDonut from "@/components/MultiRingDonut";
import { formatNumber } from "@/lib/format";
import type { StockRings } from "@/lib/types";

function pct(n: number): string {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + "%";
}

/** Thẻ cơ cấu tồn kho: biểu đồ 3 vòng đồng tâm (sở hữu × vị trí × trạng
 *  thái), cả ba vòng cùng tính theo giá vốn lô. Ở giữa vòng là tổng giá trị
 *  hàng TVK sở hữu theo giá vốn (kho TVK + hàng tại đối tác, không gồm
 *  hàng nhận ký gửi). Ba mức giá vốn/sỉ/lẻ bên dưới chỉ tính hàng của TVK
 *  trong kho — đó là ba cách định giá cùng một lượng hàng, không phải ba
 *  phần của một tổng nên không vẽ thành vòng. */
export default function StockCompositionCard({
  rings,
  tierValues,
  ownedBookValue,
  ownedQty,
  canSeeMoney,
  canSeeCost,
}: {
  rings: StockRings;
  tierValues: { cost: number; wholesale: number; retail: number };
  ownedBookValue: number;
  ownedQty: number;
  canSeeMoney: boolean;
  canSeeCost: boolean;
}) {
  const { cost, wholesale, retail } = tierValues;
  const marginPct = retail > 0 ? ((retail - cost) / retail) * 100 : 0;

  return (
    <Card title="Cơ cấu tồn kho" tone="violet">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-slate-500">
          Ba vòng độc lập, cùng phạm vi hàng đang quản lý, cùng tính theo giá vốn.
        </p>
        <details className="relative shrink-0">
          <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full border border-slate-300 text-sm text-slate-500 hover:bg-slate-50" title="Cách tính">
            ⓘ
          </summary>
          <div className="absolute right-0 top-8 z-10 w-72 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-lg">
            <p>Ba vòng thể hiện ba chiều độc lập của cùng một lượng hàng đang quản lý, đều tính theo giá vốn lô: quyền sở hữu (của TVK / nhận ký gửi), vị trí (kho TVK / kho đối tác), trạng thái (bán được / giữ cho chứng từ nháp).</p>
            <p className="mt-2">Hàng nhận ký gửi là hàng giữ hộ, không phải tài sản của cửa hàng. &ldquo;Giữ cho chứng từ nháp&rdquo; là số lượng các dòng chứng từ nháp (bán hàng, gửi ký gửi, phân bổ) đang trỏ vào lô, tối đa bằng tồn thực tế của lô.</p>
            <p className="mt-2">Ba mức giá dưới đây chỉ tính hàng của TVK trong kho, chưa gồm hàng ở đối tác.</p>
          </div>
        </details>
      </div>

      <div className="mt-4">
        <MultiRingDonut
          rings={rings}
          canSeeMoney={canSeeMoney}
          centerLabel={canSeeMoney ? formatCompactVND(ownedBookValue) : `${formatNumber(ownedQty)} cái`}
          centerLines={
            canSeeMoney
              ? ["Tổng giá trị hàng TVK sở hữu", "theo giá vốn"]
              : ["Hàng TVK tại kho", "và tại đối tác"]
          }
        />
        {canSeeMoney && (
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Ở giữa: tổng giá trị hàng TVK sở hữu theo giá vốn, kể cả hàng đang ở đối tác, không gồm hàng nhận ký gửi.
          </p>
        )}
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
