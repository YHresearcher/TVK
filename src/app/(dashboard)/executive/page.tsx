import Link from "next/link";
import { redirect } from "next/navigation";
import { ComposedChart, DonutChart, formatCompactVND, formatCompactVND2 } from "@/components/Charts";
import { getCashFlowRunway } from "@/lib/audit";
import {
  getCurrentProfile,
  getDashboard,
  getExecutiveReceivableAging,
  getPartnerConsignmentBars,
  getPerformanceSeries,
  getTopCategoriesProfitability,
} from "@/lib/queries";
import { formatNumber, formatVND, todayISO } from "@/lib/format";
import { SEMANTIC_COLORS } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["OWNER", "CEO", "ACCOUNTING"]);

const PERIOD_OPTIONS = [
  { key: "month", label: "Tháng này" },
  { key: "quarter", label: "Quý này" },
  { key: "year", label: "Năm nay" },
  { key: "30d", label: "30 ngày gần nhất" },
  { key: "all", label: "Toàn bộ dữ liệu" },
] as const;

function getPeriodRange(period: string): { from: string; to: string; label: string } {
  const today = todayISO();
  const [ty, tm] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");

  switch (period) {
    case "month":
      return { from: `${ty}-${pad(tm)}-01`, to: today, label: `Tháng ${tm}/${ty}` };
    case "quarter": {
      const qm = Math.floor((tm - 1) / 3) * 3 + 1;
      const qNum = Math.floor((tm - 1) / 3) + 1;
      return { from: `${ty}-${pad(qm)}-01`, to: today, label: `Quý ${qNum}/${ty}` };
    }
    case "year":
      return { from: `${ty}-01-01`, to: today, label: `Năm ${ty}` };
    case "30d": {
      const past = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
      return { from: past, to: today, label: "30 ngày gần nhất" };
    }
    case "all":
    default:
      return { from: "2020-01-01", to: today, label: "Toàn bộ thời gian" };
  }
}

export default async function ExecutivePage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const profileRes = await getCurrentProfile();
  const profile = profileRes.data;

  // Quyền truy cập: strictly read-only cho OWNER, CEO, ACCOUNTING
  if (!profile || !ALLOWED_ROLES.has(profile.role)) {
    redirect("/dashboard");
  }

  const selectedPeriod = PERIOD_OPTIONS.some((opt) => opt.key === searchParams.period)
    ? (searchParams.period as (typeof PERIOD_OPTIONS)[number]["key"])
    : "year";
  const range = getPeriodRange(selectedPeriod);

  // Truy vấn dữ liệu song song từ các nguồn chuẩn hoá
  const [
    dashboard,
    cashflow,
    trendSeries,
    receivableAging,
    distributors,
    topCategories,
  ] = await Promise.all([
    getDashboard(),
    getCashFlowRunway(),
    getPerformanceSeries(range.from, range.to),
    getExecutiveReceivableAging(),
    getPartnerConsignmentBars(),
    getTopCategoriesProfitability(range.from, range.to),
  ]);

  // Tính toán KPI chiến lược theo chuẩn đặc tả v1.1
  // Net Revenue, COGS, Gross Profit cho kỳ được chọn
  const periodRevenue = trendSeries.reduce((sum, item) => sum + item.revenue, 0);
  const periodCogs = trendSeries.reduce((sum, item) => sum + item.cogs, 0);
  const periodGrossProfit = periodRevenue - periodCogs;

  // 1. Biên lợi nhuận gộp (%) = Lợi nhuận gộp / Doanh thu thuần * 100 (mẫu số <= 0 trả về null)
  const grossMarginPct =
    periodRevenue > 0 ? ((periodGrossProfit / periodRevenue) * 100).toFixed(1) + "%" : "—";

  // 2. Vốn tồn kho TVK (giá vốn)
  const tvkInventoryCapital = dashboard.bookInventoryValue;
  const tvkOwnWarehouseCapital = dashboard.bookOwnedOwnValue;
  const tvkPartnerVirtualCapital = dashboard.bookAtPartnersOwnedValue;

  // 3. Tỷ lệ công nợ quá hạn (%) = Nợ quá hạn / Tổng nợ phải thu * 100 (mẫu số <= 0 trả về null)
  const overdueRatioPct =
    receivableAging.overdueRatio !== null
      ? receivableAging.overdueRatio.toFixed(1) + "%"
      : "—";

  // 4. Vòng quay tồn kho (Inventory Turnover) = Giá vốn hàng bán / Giá trị vốn tồn kho
  const inventoryTurnover =
    tvkInventoryCapital > 0 ? (periodCogs / tvkInventoryCapital).toFixed(2) + " vòng" : "—";

  // Dữ liệu phân bổ vốn tồn kho (Donut đơn vòng tinh gọn)
  const inventoryDonutSegments = [
    {
      label: "Kho TVK",
      value: tvkOwnWarehouseCapital,
      color: SEMANTIC_COLORS.profit, // Emerald
    },
    {
      label: "Kho đối tác",
      value: tvkPartnerVirtualCapital,
      color: SEMANTIC_COLORS.partnerInventory, // Cyan/Sky
    },
  ];

  // Trạng thái an toàn dòng tiền
  const safetyBadgeColor = {
    SAFE: "bg-emerald-50 text-emerald-800 border-emerald-200",
    WARNING: "bg-amber-50 text-amber-800 border-amber-200",
    DANGER: "bg-rose-50 text-rose-800 border-rose-200",
  }[cashflow.safetyStatus14];

  const safetyBadgeText = {
    SAFE: "An toàn thanh khoản",
    WARNING: "Cân bằng mong manh",
    DANGER: "Nguy cơ thâm hụt",
  }[cashflow.safetyStatus14];

  return (
    <div className="space-y-6 pb-12">
      {/* Header trang Bàn điều hành CEO */}
      <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Bàn điều hành CEO
            </h1>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 border border-slate-200">
              Chỉ xem (Strictly Read-Only)
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Giám sát toàn diện doanh thu, lợi nhuận gộp, vốn tồn kho, an toàn dòng tiền và rủi ro công nợ.
          </p>
        </div>

        {/* Bộ lọc kỳ phân tích */}
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {PERIOD_OPTIONS.map((opt) => (
            <Link
              key={opt.key}
              href={`/executive?period=${opt.key}`}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedPeriod === opt.key
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      {/* =========================================================================
          KHỐI 1: HÀNG KPI CHIẾN LƯỢC (6 CHỈ SỐ) - Chuẩn Impeccable (Không viền 4px)
      ========================================================================= */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {/* Doanh thu thuần */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Doanh thu thuần
          </p>
          <p className="mt-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {formatCompactVND2(periodRevenue)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {range.label} ({formatVND(periodRevenue)})
          </p>
        </div>

        {/* Lợi nhuận gộp */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Lợi nhuận gộp
          </p>
          <p className="mt-2 text-xl font-bold tracking-tight text-emerald-600 sm:text-2xl">
            {formatCompactVND2(periodGrossProfit)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Giá vốn: {formatCompactVND(periodCogs)}
          </p>
        </div>

        {/* Biên lợi nhuận gộp */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Biên LN gộp
          </p>
          <p className="mt-2 text-xl font-bold tracking-tight text-emerald-600 sm:text-2xl">
            {grossMarginPct}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {periodRevenue > 0 ? "LN gộp / Doanh thu" : "Chưa có doanh thu"}
          </p>
        </div>

        {/* Vốn tồn kho TVK */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Vốn tồn kho TVK
          </p>
          <p className="mt-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {formatCompactVND2(tvkInventoryCapital)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Kho TVK + Kho đối tác
          </p>
        </div>

        {/* Tỷ lệ công nợ quá hạn */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Nợ quá hạn
          </p>
          <p
            className={`mt-2 text-xl font-bold tracking-tight sm:text-2xl ${
              receivableAging.overdueTotal > 0 ? "text-rose-600" : "text-emerald-600"
            }`}
          >
            {overdueRatioPct}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {receivableAging.total > 0
              ? `${formatCompactVND(receivableAging.overdueTotal)} / ${formatCompactVND(receivableAging.total)}`
              : "Không có nợ"}
          </p>
        </div>

        {/* Vòng quay tồn kho */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Vòng quay tồn kho
          </p>
          <p className="mt-2 text-xl font-bold tracking-tight text-blue-600 sm:text-2xl">
            {inventoryTurnover}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Giá vốn / Tổng vốn tồn
          </p>
        </div>
      </div>

      {/* =========================================================================
          KHỐI 2: DỰ BÁO DÒNG TIỀN 14-30 NGÀY TỚI (CASH FLOW RUNWAY)
      ========================================================================= */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
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
                Dự báo Dòng tiền 14–30 ngày tới (Cash Flow Runway)
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Cân đối Tiền sẵn có hiện tại + Phải thu đến hạn − Phải trả NCC − Chi cố định vận hành dự kiến.
            </p>
          </div>

          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${safetyBadgeColor}`}
          >
            14 ngày: {safetyBadgeText}
          </span>
        </div>

        {/* Khuyến nghị điều hành */}
        <div className="mt-4 rounded-lg border border-slate-200/80 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-700">
          <strong className="text-slate-900">Khuyến nghị điều hành: </strong>
          {cashflow.recommendation}
        </div>

        {/* So sánh hai kỳ 14 ngày & 30 ngày */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* Kỳ 14 ngày */}
          <div className="rounded-lg border border-slate-200/70 bg-white p-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Kỳ 14 ngày tới
              </span>
              <span className="text-[11px] font-medium text-slate-500">Khẩn cấp</span>
            </div>

            <div className="mt-3 space-y-2 text-xs">
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
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-sm">
                <span className="text-slate-800">Dòng tiền ròng:</span>
                <span className={cashflow.net14 >= 0 ? "text-emerald-700" : "text-rose-700"}>
                  {cashflow.net14 >= 0 ? "+" : ""}
                  {formatVND(cashflow.net14)} đ
                </span>
              </div>
            </div>

            <div className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-500 flex justify-between">
              <span>Độ phủ ngân quỹ:</span>
              <span className="font-semibold text-slate-800">
                {Math.round(cashflow.safetyRatio14 * 100)}%
              </span>
            </div>
          </div>

          {/* Kỳ 30 ngày */}
          <div className="rounded-lg border border-slate-200/70 bg-white p-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Kỳ 30 ngày tới
              </span>
              <span className="text-[11px] font-medium text-slate-500">Toàn tháng</span>
            </div>

            <div className="mt-3 space-y-2 text-xs">
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
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-sm">
                <span className="text-slate-800">Dòng tiền ròng:</span>
                <span className={cashflow.net30 >= 0 ? "text-emerald-700" : "text-rose-700"}>
                  {cashflow.net30 >= 0 ? "+" : ""}
                  {formatVND(cashflow.net30)} đ
                </span>
              </div>
            </div>

            <div className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-500 flex justify-between">
              <span>Độ phủ ngân quỹ:</span>
              <span className="font-semibold text-slate-800">
                {Math.round(cashflow.safetyRatio30 * 100)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          KHỐI 3: BIỂU ĐỒ XU HƯỚNG KINH DOANH (FINANCIAL TRENDS)
      ========================================================================= */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Xu hướng kinh doanh (Financial Trends)
            </h2>
            <p className="text-xs text-slate-500">
              Doanh thu thuần ({range.label}: {formatVND(periodRevenue)}) · Giá vốn ({formatVND(periodCogs)}) · Biên lợi nhuận gộp ({grossMarginPct})
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[#2563EB]" />
              Doanh thu
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[#F59E0B]" />
              Giá vốn
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-4 bg-[#10B981] rounded-full" />
              Biên LN (%)
            </span>
          </div>
        </div>

        <ComposedChart data={trendSeries} />
      </div>

      {/* =========================================================================
          KHỐI 4: PHÂN BỔ VỐN TỒN KHO & CƠ CẤU TUỔI NỢ
      ========================================================================= */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Phân bổ vốn tồn kho (Donut đơn vòng tinh gọn + Bảng chi tiết) */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-6">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-900">
              Phân bổ vốn tồn kho
            </h2>
            <p className="text-xs text-slate-500">
              Đơn vòng tinh gọn: Chỉ tính hàng thuộc sở hữu của TVK (theo giá vốn lô).
            </p>
          </div>

          <div className="flex flex-col items-center justify-center pt-2 sm:flex-row sm:items-start sm:gap-6">
            <DonutChart
              segments={inventoryDonutSegments}
              centerLabel={formatCompactVND2(tvkInventoryCapital)}
              centerSub="Vốn sở hữu"
              size={180}
            />
          </div>

          {/* Bảng phân rã chi tiết */}
          <div className="mt-6 border-t border-slate-100 pt-4">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400">
                  <th className="pb-2 font-medium">Vị trí</th>
                  <th className="pb-2 font-medium text-right">Số lượng</th>
                  <th className="pb-2 font-medium text-right">Số lô</th>
                  <th className="pb-2 font-medium text-right">Vốn sở hữu</th>
                  <th className="pb-2 font-medium text-right">Tỷ trọng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                <tr>
                  <td className="py-2.5 font-medium flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#10B981]" />
                    Kho TVK
                  </td>
                  <td className="py-2.5 text-right font-mono">
                    {formatNumber(dashboard.ownedQty)}
                  </td>
                  <td className="py-2.5 text-right font-mono">
                    {dashboard.ownedLotCount}
                  </td>
                  <td className="py-2.5 text-right font-semibold text-slate-900">
                    {formatVND(tvkOwnWarehouseCapital)}
                  </td>
                  <td className="py-2.5 text-right font-medium text-slate-500">
                    {tvkInventoryCapital > 0
                      ? ((tvkOwnWarehouseCapital / tvkInventoryCapital) * 100).toFixed(1) + "%"
                      : "—"}
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 font-medium flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#0EA5E9]" />
                    Kho đối tác (Ký gửi đi)
                  </td>
                  <td className="py-2.5 text-right font-mono">
                    {formatNumber(dashboard.atPartnersQty)}
                  </td>
                  <td className="py-2.5 text-right font-mono">
                    {dashboard.atPartnersLotCount}
                  </td>
                  <td className="py-2.5 text-right font-semibold text-slate-900">
                    {formatVND(tvkPartnerVirtualCapital)}
                  </td>
                  <td className="py-2.5 text-right font-medium text-slate-500">
                    {tvkInventoryCapital > 0
                      ? ((tvkPartnerVirtualCapital / tvkInventoryCapital) * 100).toFixed(1) + "%"
                      : "—"}
                  </td>
                </tr>
                <tr className="font-bold text-slate-900 bg-slate-50/50">
                  <td className="py-2.5 pl-1.5">Tổng vốn tồn kho TVK</td>
                  <td className="py-2.5 text-right font-mono">
                    {formatNumber(dashboard.ownedQty + dashboard.atPartnersQty)}
                  </td>
                  <td className="py-2.5 text-right font-mono">
                    {dashboard.ownedLotCount + dashboard.atPartnersLotCount}
                  </td>
                  <td className="py-2.5 text-right">
                    {formatVND(tvkInventoryCapital)}
                  </td>
                  <td className="py-2.5 text-right">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Cơ cấu tuổi nợ phải thu (Receivables Aging) */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Cơ cấu tuổi nợ phải thu
              </h2>
              <p className="text-xs text-slate-500">
                Tổng công nợ: {formatVND(receivableAging.total)} · Quá hạn: {formatVND(receivableAging.overdueTotal)}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                receivableAging.overdueTotal > 0
                  ? "bg-rose-50 text-rose-700 border border-rose-200"
                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              }`}
            >
              Quá hạn: {overdueRatioPct}
            </span>
          </div>

          {/* Biểu đồ thanh ngang tỷ lệ tuổi nợ */}
          <div className="space-y-4 pt-2">
            {receivableAging.buckets.map((b) => (
              <div key={b.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: b.color }}
                    />
                    {b.label}
                  </span>
                  <div className="space-x-2 font-mono">
                    <span className="font-bold text-slate-900">{formatVND(b.amount)} đ</span>
                    <span className="text-slate-400">({b.pct.toFixed(1)}%)</span>
                  </div>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(b.pct, b.amount > 0 ? 2 : 0)}%`,
                      backgroundColor: b.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 border border-slate-200/70">
            <p>
              <strong>Lưu ý quản trị:</strong> Các khoản nợ &gt;30 ngày và &gt;60 ngày cần được rà soát và đôn đốc thu hồi ngay trước khi tiếp tục xuất các đơn hàng ký gửi mới.
            </p>
          </div>
        </div>
      </div>

      {/* =========================================================================
          KHỐI 5: HIỆU SUẤT ĐỐI TÁC / GARA & NHÓM HÀNG TẠO LỢI NHUẬN CAO NHẤT
      ========================================================================= */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Hiệu suất đối tác / gara (Distributor Performance) */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-6">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-900">
              Hiệu suất đối tác &amp; gara
            </h2>
            <p className="text-xs text-slate-500">
              Theo dõi tốc độ tiêu thụ hàng ký gửi và tổng vốn hàng đang giữ tại từng đối tác.
            </p>
          </div>

          {distributors.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Chưa có dữ liệu đối tác</p>
          ) : (
            <div className="space-y-4">
              {distributors.slice(0, 6).map((dist) => {
                const consumptionPct =
                  dist.sent > 0 ? ((dist.consumed / dist.sent) * 100).toFixed(1) : "—";
                const numPct = dist.sent > 0 ? (dist.consumed / dist.sent) * 100 : 0;
                return (
                  <div
                    key={dist.partnerId}
                    className="rounded-lg border border-slate-100 p-3 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800">{dist.partnerName}</span>
                      <span className="font-semibold text-slate-700">
                        Vốn giữ: {formatCompactVND2(dist.transferValue)}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Đã gửi: {formatNumber(dist.sent)}</span>
                      <span>Đã tiêu thụ: {formatNumber(dist.consumed)}</span>
                      <span>Còn giữ: {formatNumber(dist.remaining)}</span>
                      <span className="font-medium text-emerald-600">
                        Tiêu thụ: {consumptionPct}%
                      </span>
                    </div>

                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${Math.min(100, Math.max(numPct, dist.consumed > 0 ? 3 : 0))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Nhóm hàng tạo lợi nhuận cao nhất (Top Categories by Gross Profit) */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-6">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-900">
              Nhóm hàng tạo lợi nhuận cao nhất
            </h2>
            <p className="text-xs text-slate-500">
              Xếp hạng nhóm sản phẩm đóng góp lợi nhuận gộp cao nhất ({range.label}).
            </p>
          </div>

          {topCategories.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Chưa có dữ liệu giao dịch</p>
          ) : (
            <div className="space-y-3">
              {topCategories.slice(0, 6).map((cat, idx) => {
                const marginText =
                  cat.grossMargin !== null ? cat.grossMargin.toFixed(1) + "%" : "—";
                return (
                  <div
                    key={cat.group}
                    className="rounded-lg border border-slate-100 p-3 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-600">
                          #{idx + 1}
                        </span>
                        {cat.group}
                      </span>
                      <span className="font-bold text-emerald-700">
                        +{formatCompactVND2(cat.grossProfit)}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Doanh thu: {formatCompactVND(cat.revenue)}</span>
                      <span>Giá vốn: {formatCompactVND(cat.cogs)}</span>
                      <span>Số lượng: {formatNumber(cat.qty)}</span>
                      <span className="font-semibold text-emerald-600">
                        Biên LN: {marginText}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
