"use client";

import { formatVND } from "@/lib/format";
import type { MonthlyCashflowSummaryRow } from "@/lib/queries";

interface CashflowMonthlyReportProps {
  summary: MonthlyCashflowSummaryRow[];
}

export default function CashflowMonthlyReport({
  summary,
}: CashflowMonthlyReportProps) {
  // Tính tổng 6 tháng
  const totals = summary.reduce(
    (acc, row) => {
      acc.actualIn += row.actualIn;
      acc.actualOut += row.actualOut;
      acc.netCashflow += row.netCashflow;
      acc.revenue += row.revenue;
      acc.cogs += row.cogs;
      acc.grossProfit += row.grossProfit;
      acc.operatingExpense += row.operatingExpense;
      acc.netManagementProfit += row.netManagementProfit;
      return acc;
    },
    {
      actualIn: 0,
      actualOut: 0,
      netCashflow: 0,
      revenue: 0,
      cogs: 0,
      grossProfit: 0,
      operatingExpense: 0,
      netManagementProfit: 0,
    }
  );

  // Tìm giá trị max để scale biểu đồ trực quan
  const maxVal = Math.max(
    ...summary.map((s) => Math.max(s.actualIn, s.actualOut, s.revenue, Math.abs(s.netManagementProfit))),
    1000000
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Tổng Hợp Thực Thu – Thực Chi & Lãi Ròng Quản Trị Theo Tháng
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Đối chiếu giữa Dòng tiền thực thu - thực chi (Cash Flow) và Kết quả kinh doanh dồn tích (Lãi ròng quản trị = Lãi gộp − Chi phí vận hành).
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-emerald-500" />
            <span className="text-slate-600 font-medium">Thực thu</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-rose-500" />
            <span className="text-slate-600 font-medium">Thực chi</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-blue-600" />
            <span className="text-slate-600 font-medium">Lãi ròng quản trị</span>
          </div>
        </div>
      </div>

      {/* Biểu đồ so sánh trực quan tháng */}
      <div className="mt-6">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-4">
          Biểu Đồ Xu Hướng 6 Tháng Gần Nhất
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {summary.map((row) => {
            const inPct = Math.min(100, Math.round((row.actualIn / maxVal) * 100));
            const outPct = Math.min(100, Math.round((row.actualOut / maxVal) * 100));
            const profitPct = Math.min(100, Math.round((Math.max(0, row.netManagementProfit) / maxVal) * 100));

            return (
              <div
                key={row.monthKey}
                className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 flex flex-col justify-between"
              >
                <div className="text-center border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-900">{row.monthLabel}</span>
                  <p className={`text-[11px] font-bold mt-0.5 ${row.netCashflow >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    Net: {row.netCashflow >= 0 ? "+" : ""}{formatVND(row.netCashflow)} đ
                  </p>
                </div>

                {/* Thanh so sánh cột */}
                <div className="my-3 flex items-end justify-center gap-2 h-28 pt-2">
                  {/* Cột Thu */}
                  <div className="flex flex-col items-center gap-1 w-5 h-full justify-end">
                    <div
                      className="w-full rounded-t bg-emerald-500 transition-all hover:bg-emerald-600"
                      style={{ height: `${Math.max(4, inPct)}%` }}
                      title={`Thực thu: +${formatVND(row.actualIn)} đ`}
                    />
                    <span className="text-[9px] text-emerald-800 font-semibold">Thu</span>
                  </div>

                  {/* Cột Chi */}
                  <div className="flex flex-col items-center gap-1 w-5 h-full justify-end">
                    <div
                      className="w-full rounded-t bg-rose-500 transition-all hover:bg-rose-600"
                      style={{ height: `${Math.max(4, outPct)}%` }}
                      title={`Thực chi: -${formatVND(row.actualOut)} đ`}
                    />
                    <span className="text-[9px] text-rose-800 font-semibold">Chi</span>
                  </div>

                  {/* Cột Lãi ròng quản trị */}
                  <div className="flex flex-col items-center gap-1 w-5 h-full justify-end">
                    <div
                      className={`w-full rounded-t transition-all ${
                        row.netManagementProfit >= 0 ? "bg-blue-600 hover:bg-blue-700" : "bg-purple-500 hover:bg-purple-600"
                      }`}
                      style={{ height: `${Math.max(4, profitPct)}%` }}
                      title={`Lãi ròng QT: ${formatVND(row.netManagementProfit)} đ`}
                    />
                    <span className="text-[9px] text-blue-800 font-semibold">Lãi</span>
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-2 text-[10px] space-y-1 text-slate-600">
                  <div className="flex justify-between">
                    <span>Doanh thu:</span>
                    <span className="font-semibold text-slate-900">{formatVND(row.revenue)} đ</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Lãi ròng QT:</span>
                    <span className={`font-bold ${row.netManagementProfit >= 0 ? "text-blue-700" : "text-rose-700"}`}>
                      {formatVND(row.netManagementProfit)} đ
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bảng số liệu chi tiết đối chiếu */}
      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
          <thead>
            <tr className="bg-slate-50/90 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
              <th className="px-3.5 py-3">Tháng</th>
              <th className="px-3.5 py-3 text-right text-emerald-800 bg-emerald-50/50">Thực thu (1)</th>
              <th className="px-3.5 py-3 text-right text-rose-800 bg-rose-50/50">Thực chi (2)</th>
              <th className="px-3.5 py-3 text-right font-bold">Tiền còn lại (1-2)</th>
              <th className="px-3.5 py-3 text-right text-slate-700">Doanh thu bán</th>
              <th className="px-3.5 py-3 text-right text-slate-700">Giá vốn (COGS)</th>
              <th className="px-3.5 py-3 text-right text-slate-800 font-semibold">Lãi gộp</th>
              <th className="px-3.5 py-3 text-right text-amber-800 bg-amber-50/30">Chi phí vận hành</th>
              <th className="px-3.5 py-3 text-right text-blue-900 bg-blue-50/50 font-bold">Lãi ròng quản trị</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
            {summary.map((row) => (
              <tr key={row.monthKey} className="hover:bg-slate-50/70 transition-colors">
                <td className="px-3.5 py-3 font-bold text-slate-900 whitespace-nowrap">
                  {row.monthLabel}
                </td>
                <td className="px-3.5 py-3 text-right font-semibold text-emerald-700 bg-emerald-50/30 whitespace-nowrap">
                  +{formatVND(row.actualIn)} đ
                </td>
                <td className="px-3.5 py-3 text-right font-semibold text-rose-700 bg-rose-50/30 whitespace-nowrap">
                  -{formatVND(row.actualOut)} đ
                </td>
                <td className="px-3.5 py-3 text-right font-bold whitespace-nowrap">
                  <span className={row.netCashflow >= 0 ? "text-emerald-700" : "text-rose-700"}>
                    {row.netCashflow >= 0 ? "+" : ""}{formatVND(row.netCashflow)} đ
                  </span>
                </td>
                <td className="px-3.5 py-3 text-right text-slate-800 whitespace-nowrap">
                  {formatVND(row.revenue)} đ
                </td>
                <td className="px-3.5 py-3 text-right text-slate-600 whitespace-nowrap">
                  {formatVND(row.cogs)} đ
                </td>
                <td className="px-3.5 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">
                  {formatVND(row.grossProfit)} đ
                </td>
                <td className="px-3.5 py-3 text-right text-amber-700 bg-amber-50/20 whitespace-nowrap">
                  -{formatVND(row.operatingExpense)} đ
                </td>
                <td className="px-3.5 py-3 text-right font-black bg-blue-50/30 whitespace-nowrap">
                  <span className={row.netManagementProfit >= 0 ? "text-blue-700" : "text-rose-700"}>
                    {row.netManagementProfit >= 0 ? "+" : ""}{formatVND(row.netManagementProfit)} đ
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300">
              <td className="px-3.5 py-3.5 uppercase tracking-wider text-xs">
                Tổng cộng ({summary.length} tháng)
              </td>
              <td className="px-3.5 py-3.5 text-right text-emerald-800 whitespace-nowrap">
                +{formatVND(totals.actualIn)} đ
              </td>
              <td className="px-3.5 py-3.5 text-right text-rose-800 whitespace-nowrap">
                -{formatVND(totals.actualOut)} đ
              </td>
              <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                <span className={totals.netCashflow >= 0 ? "text-emerald-800" : "text-rose-800"}>
                  {totals.netCashflow >= 0 ? "+" : ""}{formatVND(totals.netCashflow)} đ
                </span>
              </td>
              <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                {formatVND(totals.revenue)} đ
              </td>
              <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                {formatVND(totals.cogs)} đ
              </td>
              <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                {formatVND(totals.grossProfit)} đ
              </td>
              <td className="px-3.5 py-3.5 text-right text-amber-800 whitespace-nowrap">
                -{formatVND(totals.operatingExpense)} đ
              </td>
              <td className="px-3.5 py-3.5 text-right text-blue-900 whitespace-nowrap">
                <span className={totals.netManagementProfit >= 0 ? "text-blue-900" : "text-rose-900"}>
                  {totals.netManagementProfit >= 0 ? "+" : ""}{formatVND(totals.netManagementProfit)} đ
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
