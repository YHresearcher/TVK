"use client";

import { formatDate, formatVND } from "@/lib/format";
import type { CashFlowRunway } from "@/lib/audit";
import type { AnyRow } from "@/lib/types";

interface CashflowOverviewProps {
  fundBalances: AnyRow[];
  cashflow: CashFlowRunway;
}

export default function CashflowOverview({
  fundBalances,
  cashflow,
}: CashflowOverviewProps) {
  // 1. Phân loại và tính tổng số dư ngân quỹ thực tế
  const activeFunds = fundBalances.filter((f) => f.is_active !== false);
  const totalAvailable = activeFunds.reduce((sum, f) => sum + Number(f.balance ?? 0), 0);
  const totalCash = activeFunds
    .filter((f) => f.kind === "CASH")
    .reduce((sum, f) => sum + Number(f.balance ?? 0), 0);
  const totalBank = activeFunds
    .filter((f) => f.kind === "BANK")
    .reduce((sum, f) => sum + Number(f.balance ?? 0), 0);

  const safetyBadgeColor =
    cashflow.safetyStatus14 === "DANGER"
      ? "bg-rose-50 text-rose-700 border-rose-300 ring-rose-500/20"
      : cashflow.safetyStatus14 === "WARNING"
      ? "bg-amber-50 text-amber-700 border-amber-300 ring-amber-500/20"
      : "bg-emerald-50 text-emerald-700 border-emerald-300 ring-emerald-500/20";

  const safetyBadgeText =
    cashflow.safetyStatus14 === "DANGER"
      ? "Báo động thâm hụt"
      : cashflow.safetyStatus14 === "WARNING"
      ? "Cảnh báo thanh khoản"
      : "Ngân quỹ an toàn";

  return (
    <div className="space-y-6">
      {/* 4 Thẻ KPI Ngân Quỹ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Tổng tiền sẵn có */}
        <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-indigo-50/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">
              Tổng tiền sẵn có
            </span>
            <span className="rounded-full bg-blue-100 p-1.5 text-blue-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
          </div>
          <div className="mt-2">
            <p className="text-2xl font-black text-slate-900">
              {formatVND(totalAvailable)} <span className="text-sm font-normal text-slate-500">đ</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {activeFunds.length} quỹ tiền đang hoạt động
            </p>
          </div>
        </div>

        {/* Tiền mặt tại két */}
        <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-teal-50/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
              Tiền mặt tại két
            </span>
            <span className="rounded-full bg-emerald-100 p-1.5 text-emerald-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </span>
          </div>
          <div className="mt-2">
            <p className="text-2xl font-black text-emerald-900">
              {formatVND(totalCash)} <span className="text-sm font-normal text-emerald-600">đ</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Sẵn sàng chi tiêu tiền mặt ngay
            </p>
          </div>
        </div>

        {/* Tiền gửi ngân hàng */}
        <div className="rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50/80 to-blue-50/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-sky-700 uppercase tracking-wider">
              Tiền gửi ngân hàng
            </span>
            <span className="rounded-full bg-sky-100 p-1.5 text-sky-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
              </svg>
            </span>
          </div>
          <div className="mt-2">
            <p className="text-2xl font-black text-sky-900">
              {formatVND(totalBank)} <span className="text-sm font-normal text-sky-600">đ</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Tài khoản thanh toán ngân hàng
            </p>
          </div>
        </div>

        {/* Dòng tiền ròng 14 ngày tới */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Dự báo ròng 14 ngày
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${safetyBadgeColor}`}>
              {Math.round(cashflow.safetyRatio14 * 100)}%
            </span>
          </div>
          <div className="mt-2">
            <p className={`text-2xl font-black ${cashflow.net14 >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {cashflow.net14 >= 0 ? "+" : ""}
              {formatVND(cashflow.net14)} <span className="text-sm font-normal text-slate-500">đ</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {safetyBadgeText}
            </p>
          </div>
        </div>
      </div>

      {/* Danh sách từng quỹ tiền chi tiết & Dự báo dòng tiền 14-30 ngày */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Bảng chi tiết từng quỹ (7 cột trên lg) */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-6 xl:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Danh Sách Quỹ Tiền & Số Dư Thực Tế
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Số dư hiện tại = Số dư đầu kỳ + Tổng thu − Tổng chi thực tế ghi nhận
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {fundBalances.length} tài khoản/két
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead>
                <tr className="bg-slate-50/80 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="px-3 py-2.5">Quỹ tiền</th>
                  <th className="px-3 py-2.5">Loại</th>
                  <th className="px-3 py-2.5">Ngày đầu kỳ</th>
                  <th className="px-3 py-2.5 text-right">Dư đầu kỳ</th>
                  <th className="px-3 py-2.5 text-right text-emerald-700">Tổng thu</th>
                  <th className="px-3 py-2.5 text-right text-rose-700">Tổng chi</th>
                  <th className="px-3 py-2.5 text-right font-bold text-slate-900">Số dư hiện tại</th>
                  <th className="px-3 py-2.5 text-center">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {fundBalances.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-400">
                      Chưa có quỹ tiền nào được thiết lập.
                    </td>
                  </tr>
                ) : (
                  fundBalances.map((fund) => {
                    const balance = Number(fund.balance ?? 0);
                    const opening = Number(fund.opening_balance ?? 0);
                    const totalIn = Number(fund.total_in ?? 0);
                    const totalOut = Number(fund.total_out ?? 0);
                    const isActive = fund.is_active !== false;

                    return (
                      <tr key={fund.fund_id || fund.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-3 py-3 font-bold text-slate-900">
                          {fund.fund_name || fund.name}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            fund.kind === "CASH"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-sky-50 text-sky-700 border border-sky-200"
                          }`}>
                            {fund.kind === "CASH" ? "Két tiền mặt" : "Ngân hàng"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-500 whitespace-nowrap">
                          {fund.opening_balance_date ? formatDate(fund.opening_balance_date) : "01/01/2026"}
                        </td>
                        <td className="px-3 py-3 text-right text-slate-600">
                          {formatVND(opening)} đ
                        </td>
                        <td className="px-3 py-3 text-right text-emerald-700">
                          +{formatVND(totalIn)} đ
                        </td>
                        <td className="px-3 py-3 text-right text-rose-700">
                          -{formatVND(totalOut)} đ
                        </td>
                        <td className="px-3 py-3 text-right font-black text-slate-900">
                          {formatVND(balance)} đ
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isActive
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}>
                            {isActive ? "Hoạt động" : "Tạm ngưng"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Card widget: Dự báo Dòng tiền 14-30 ngày (5 cột trên lg, đồng bộ 100% với /executive) */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-6 xl:col-span-5">
          <div className="flex flex-col gap-2 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 relative">
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      cashflow.safetyStatus14 === "DANGER"
                        ? "bg-rose-500 animate-pulse"
                        : cashflow.safetyStatus14 === "WARNING"
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`}
                  />
                </span>
                <h2 className="text-base font-bold text-slate-900">
                  Dự Báo Dòng Tiền (Cash Flow Runway)
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Tiền sẵn có + Thu đến hạn − Trả NCC − Chi cố định dự kiến
              </p>
            </div>

            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${safetyBadgeColor}`}>
              14 ngày: {safetyBadgeText}
            </span>
          </div>

          {/* Khuyến nghị điều hành */}
          <div className="mt-3.5 rounded-lg border border-slate-200/80 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
            <strong className="text-slate-900">Khuyến nghị điều hành: </strong>
            {cashflow.recommendation}
          </div>

          {/* So sánh hai kỳ 14 ngày & 30 ngày */}
          <div className="mt-4 space-y-4">
            {/* Kỳ 14 ngày */}
            <div className="rounded-lg border border-slate-200/70 bg-slate-50/50 p-3.5">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Kỳ 14 ngày tới (Gần hạn)
                </span>
                <span className="text-[11px] font-semibold text-slate-500">Khẩn cấp</span>
              </div>

              <div className="mt-2.5 space-y-1.5 text-xs">
                <div className="flex justify-between text-blue-700">
                  <span>Tiền sẵn có hiện tại:</span>
                  <span className="font-bold">+{formatVND(cashflow.currentAvailableCash)} đ</span>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>Phải thu đến hạn (Thu nợ gara):</span>
                  <span className="font-bold">+{formatVND(cashflow.inflow14)} đ</span>
                </div>
                <div className="flex justify-between text-rose-700">
                  <span>Phải trả NCC đến hạn (Trả nợ NCC):</span>
                  <span className="font-bold">-{formatVND(cashflow.outflow14)} đ</span>
                </div>
                <div className="flex justify-between text-amber-700">
                  <span>Chi cố định dự kiến (Vận hành cố định):</span>
                  <span className="font-bold">-{formatVND(cashflow.fixedCost14)} đ</span>
                </div>
                <div className="border-t border-slate-200 pt-1.5 flex justify-between font-bold text-sm">
                  <span className="text-slate-900">Dòng tiền ròng dự báo:</span>
                  <span className={cashflow.net14 >= 0 ? "text-emerald-700" : "text-rose-700"}>
                    {cashflow.net14 >= 0 ? "+" : ""}
                    {formatVND(cashflow.net14)} đ
                  </span>
                </div>
              </div>

              <div className="mt-2.5 border-t border-slate-200 pt-1.5 text-[11px] text-slate-500 flex justify-between">
                <span>Độ phủ ngân quỹ:</span>
                <span className="font-bold text-slate-900">
                  {Math.round(cashflow.safetyRatio14 * 100)}%
                </span>
              </div>
            </div>

            {/* Kỳ 30 ngày */}
            <div className="rounded-lg border border-slate-200/70 bg-slate-50/50 p-3.5">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Kỳ 30 ngày tới (Toàn tháng)
                </span>
                <span className="text-[11px] font-semibold text-slate-500">Trung hạn</span>
              </div>

              <div className="mt-2.5 space-y-1.5 text-xs">
                <div className="flex justify-between text-blue-700">
                  <span>Tiền sẵn có hiện tại:</span>
                  <span className="font-bold">+{formatVND(cashflow.currentAvailableCash)} đ</span>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>Phải thu đến hạn (Thu nợ gara):</span>
                  <span className="font-bold">+{formatVND(cashflow.inflow30)} đ</span>
                </div>
                <div className="flex justify-between text-rose-700">
                  <span>Phải trả NCC đến hạn (Trả nợ NCC):</span>
                  <span className="font-bold">-{formatVND(cashflow.outflow30)} đ</span>
                </div>
                <div className="flex justify-between text-amber-700">
                  <span>Chi cố định dự kiến (Vận hành cố định):</span>
                  <span className="font-bold">-{formatVND(cashflow.fixedCost30)} đ</span>
                </div>
                <div className="border-t border-slate-200 pt-1.5 flex justify-between font-bold text-sm">
                  <span className="text-slate-900">Dòng tiền ròng dự báo:</span>
                  <span className={cashflow.net30 >= 0 ? "text-emerald-700" : "text-rose-700"}>
                    {cashflow.net30 >= 0 ? "+" : ""}
                    {formatVND(cashflow.net30)} đ
                  </span>
                </div>
              </div>

              <div className="mt-2.5 border-t border-slate-200 pt-1.5 text-[11px] text-slate-500 flex justify-between">
                <span>Độ phủ ngân quỹ:</span>
                <span className="font-bold text-slate-900">
                  {Math.round(cashflow.safetyRatio30 * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
