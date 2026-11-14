import Link from "next/link";
import { formatVND } from "@/lib/format";
import type { CashFlowRunway, ExecutiveAlertsResult } from "@/lib/audit";
import DownloadAlertsExcelButton from "@/components/DownloadAlertsExcelButton";

export default function ExecutiveControlSection({
  cashflow,
  alertsResult,
}: {
  cashflow: CashFlowRunway;
  alertsResult: ExecutiveAlertsResult;
}) {
  const { alerts, redCount, amberCount } = alertsResult;

  // Trạng thái an toàn dòng tiền
  const safetyColorMap = {
    SAFE: "bg-emerald-50 text-emerald-800 border-emerald-300 ring-emerald-500/20",
    WARNING: "bg-amber-50 text-amber-800 border-amber-300 ring-amber-500/20",
    DANGER: "bg-rose-50 text-rose-800 border-rose-300 ring-rose-500/20",
  };

  const safetyLabelMap = {
    SAFE: "An toàn (Đủ độ phủ)",
    WARNING: "Cảnh báo (Cân bằng mong manh)",
    DANGER: "Nguy cơ thâm hụt (Chi vượt thu)",
  };

  return (
    <section className="mt-8">
      {/* Header khối Executive Control */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              {redCount > 0 && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  redCount > 0 ? "bg-rose-500" : amberCount > 0 ? "bg-amber-500" : "bg-emerald-500"
                }`}
              />
            </span>
            <h2 className="text-base font-bold text-slate-900">
              Kiểm soát Dòng tiền & Cảnh báo Sai lệch
            </h2>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              CEO & Trợ lý
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Dự báo dòng tiền 14–30 ngày tới và tổng hợp các cảnh báo rủi ro vận hành cần giải trình.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/audit-center"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:text-blue-700"
          >
            <span>Mở Trung tâm Đối soát 3 Bên</span>
            <span aria-hidden="true">→</span>
          </Link>
          <DownloadAlertsExcelButton alerts={alerts} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* =========================================================================
            WIDGET 1: DỰ BÁO DÒNG TIỀN 14-30 NGÀY TỚI (CASH FLOW RUNWAY) - 7 cột
        ========================================================================= */}
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-6 xl:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Dự báo Dòng tiền (Cash Flow Runway)
              </h3>
              <p className="text-xs text-slate-500">
                So sánh Dòng tiền vào dự kiến vs Dòng tiền ra trả NCC ký gửi
              </p>
            </div>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                safetyColorMap[cashflow.safetyStatus14]
              }`}
            >
              14 ngày: {safetyLabelMap[cashflow.safetyStatus14]}
            </span>
          </div>

          {/* Khuyến nghị điều hành */}
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700 border border-slate-200 leading-relaxed">
            {cashflow.recommendation}
          </div>

          {/* Hai cột so sánh 14 ngày vs 30 ngày */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {/* Kỳ 14 ngày */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Kỳ 14 ngày tới
                </span>
                <span className="text-[11px] font-medium text-slate-500">Gần hạn</span>
              </div>

              <div className="mt-2.5 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-emerald-700">
                  <span className="font-medium">Tiền vào dự kiến (Thu):</span>
                  <span className="font-bold">+{formatVND(cashflow.inflow14)} đ</span>
                </div>
                <div className="flex items-center justify-between text-rose-700">
                  <span className="font-medium">Tiền ra dự kiến (Trả NCC):</span>
                  <span className="font-bold">-{formatVND(cashflow.outflow14)} đ</span>
                </div>
                <div className="border-t border-slate-200 pt-1.5 flex items-center justify-between font-bold">
                  <span className="text-slate-800">Dòng tiền ròng (Net):</span>
                  <span
                    className={
                      cashflow.net14 >= 0 ? "text-emerald-700 text-sm" : "text-rose-700 text-sm"
                    }
                  >
                    {cashflow.net14 >= 0 ? "+" : ""}
                    {formatVND(cashflow.net14)} đ
                  </span>
                </div>
              </div>

              {/* Phân rã nhanh */}
              <div className="mt-3 border-t border-slate-200/80 pt-2 text-[11px] text-slate-500 space-y-1">
                <div className="flex justify-between">
                  <span>Khoản thu quá hạn cần đôn đốc:</span>
                  <span className="font-semibold text-rose-600">{formatVND(cashflow.overdueReceivables)} đ</span>
                </div>
                <div className="flex justify-between">
                  <span>Khoản nợ NCC quá hạn cần trả:</span>
                  <span className="font-semibold text-rose-600">{formatVND(cashflow.overduePayables)} đ</span>
                </div>
              </div>
            </div>

            {/* Kỳ 30 ngày */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Kỳ 30 ngày tới
                </span>
                <span className="text-[11px] font-medium text-slate-500">Toàn tháng</span>
              </div>

              <div className="mt-2.5 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-emerald-700">
                  <span className="font-medium">Tiền vào dự kiến (Thu):</span>
                  <span className="font-bold">+{formatVND(cashflow.inflow30)} đ</span>
                </div>
                <div className="flex items-center justify-between text-rose-700">
                  <span className="font-medium">Tiền ra dự kiến (Trả NCC):</span>
                  <span className="font-bold">-{formatVND(cashflow.outflow30)} đ</span>
                </div>
                <div className="border-t border-slate-200 pt-1.5 flex items-center justify-between font-bold">
                  <span className="text-slate-800">Dòng tiền ròng (Net):</span>
                  <span
                    className={
                      cashflow.net30 >= 0 ? "text-emerald-700 text-sm" : "text-rose-700 text-sm"
                    }
                  >
                    {cashflow.net30 >= 0 ? "+" : ""}
                    {formatVND(cashflow.net30)} đ
                  </span>
                </div>
              </div>

              {/* Độ phủ ngân quỹ 30d */}
              <div className="mt-3 border-t border-slate-200/80 pt-2 text-[11px] text-slate-500">
                <div className="flex justify-between items-center mb-1">
                  <span>Chỉ số an toàn (Độ phủ):</span>
                  <span className="font-bold text-slate-800">
                    {cashflow.outflow30 > 0 ? `${Math.round(cashflow.safetyRatio30 * 100)}%` : "100%"}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${
                      cashflow.net30 >= 0 ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                    style={{
                      width: `${Math.min(
                        Math.max(cashflow.outflow30 > 0 ? (cashflow.inflow30 / cashflow.outflow30) * 100 : 100, 5),
                        100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>Dòng tiền thu chỉ tính các khoản phải thu đã xác nhận từ bán hàng và tiêu thụ đối tác.</span>
            <Link href="/receivables" className="font-medium text-blue-600 hover:underline">
              Chi tiết công nợ →
            </Link>
          </div>
        </div>

        {/* =========================================================================
            WIDGET 2: TRUNG TÂM BÁO ĐỘNG ĐÈN TÍN HIỆU (RED & AMBER FLAGS) - 5 cột
        ========================================================================= */}
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-6 xl:col-span-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Trung tâm Báo động Đèn tín hiệu
              </h3>
              <p className="text-xs text-slate-500">
                Gom cảnh báo lệch ký gửi, công nợ quá hạn và hạn trả lô
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">
                {redCount} Đỏ
              </span>
              <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                {amberCount} Vàng
              </span>
            </div>
          </div>

          {/* Danh sách các cảnh báo nổi bật */}
          <div className="mt-3 flex-1 overflow-y-auto max-h-[290px] pr-1 space-y-2.5">
            {alerts.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                Không có cảnh báo sai lệch hay quá hạn nghiêm trọng nào.
              </div>
            ) : (
              alerts.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  className={`rounded-lg border p-2.5 text-xs transition-colors ${
                    a.level === "RED"
                      ? "border-rose-200 bg-rose-50/50 hover:bg-rose-50"
                      : "border-amber-200 bg-amber-50/40 hover:bg-amber-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${a.level === "RED" ? "bg-rose-500" : "bg-amber-500"}`} />
                      <span>{a.partnerOrSupplier}</span>
                    </div>
                    <span className="shrink-0 font-mono font-bold text-rose-700">
                      {a.discrepancy}
                    </span>
                  </div>

                  <p className="mt-1 text-slate-600 leading-relaxed">{a.reason}</p>

                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                    <span>Mã: {a.docOrBatch}</span>
                    <span>{a.time}</span>
                  </div>
                </div>
              ))
            )}
            {alerts.length > 5 && (
              <p className="text-center text-xs text-slate-500 pt-1">
                và {alerts.length - 5} cảnh báo khác trong danh sách...
              </p>
            )}
          </div>

          {/* Footer widget kèm nút xuất Excel */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              Xuất danh sách để chuyển tiếp Zalo giải trình:
            </span>
            <DownloadAlertsExcelButton
              alerts={alerts}
              label="Tải danh sách lệch (.xlsx)"
              variant="danger"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
