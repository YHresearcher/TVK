import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, tdCls, thCls } from "@/components/ui";
import CollapsibleCard from "@/components/CollapsibleCard";
import NoBusinessLineNotice from "@/components/NoBusinessLineNotice";
import { getBusinessLineContext } from "@/lib/business-lines";
import { ComposedChart, formatCompactVND, GroupedBarChart, HBarList, StackedBarList } from "@/components/Charts";
import PartnerStatsDialog from "@/components/PartnerStatsDialog";
import QuickShortcuts from "@/components/QuickShortcuts";
import StockCompositionCard from "@/components/StockCompositionCard";
import ExecutiveControlSection from "@/components/ExecutiveControlSection";
import { getCashFlowRunway, getExecutiveAlerts } from "@/lib/audit";
import {
  getCashFundBalances,
  getCurrentProfile,
  getDashboard,
  getDebtByLine,
  getGroupPerformance,
  getInventoryValueByGroup,
  getLineComparison,
  getPartnerConsignmentBars,
  getPerformanceSeries,
  getReceivableAgingBars,
  getSlowMoving,
  listLedgerMovements,
  listPartnerStats,
} from "@/lib/queries";
import { checkLineTotals, sumDebtByLine } from "@/lib/reporting";
import { formatDate, formatNumber, formatVND, todayISO } from "@/lib/format";
import { MOVEMENT_KIND_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

type StatTone = "blue" | "sky" | "amber" | "emerald" | "violet" | "rose";

// Thẻ số liệu Minimal Enterprise: nền trắng, vạch màu dọc bên trái.
const STAT_TONE_BAR: Record<StatTone, string> = {
  blue: "border-l-blue-600",
  sky: "border-l-sky-500",
  amber: "border-l-amber-500",
  emerald: "border-l-emerald-500",
  violet: "border-l-violet-500",
  rose: "border-l-rose-500",
};

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: StatTone }) {
  return (
    <div
      className={
        tone
          ? `min-w-0 rounded-lg border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${STAT_TONE_BAR[tone]}`
          : "min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      }
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold leading-tight text-slate-900 sm:text-2xl">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function LayerHeading({ title, desc, accent }: { title: string; desc: string; accent?: string }) {
  return (
    <div className={`mb-4 border-l-4 pl-3 ${accent ?? "border-slate-300"}`}>
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-500">{desc}</p>
    </div>
  );
}

// Thẻ KPI nổi bật ở đầu Tổng quan: nền màu theo ý nghĩa (xanh lá = tốt,
// cam = cần chú ý, đỏ = rủi ro, xanh dương = tiền, tím = hàng hoá), số
// lớn, nhãn kỳ rõ. Chỉ trình bày — mọi số đều lấy từ getDashboard.
function HeroKpi({
  label,
  value,
  sub,
  box,
  num,
  big = false,
}: {
  label: string;
  value: string;
  sub?: string;
  box: string;
  num: string;
  big?: boolean;
}) {
  return (
    <div className={`min-w-0 rounded-xl border p-4 shadow-sm sm:p-5 ${box}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className={`mt-1 font-bold leading-tight ${big ? "text-[32px] sm:text-4xl" : "text-[26px] sm:text-[32px]"} ${num}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs opacity-80">{sub}</p>}
    </div>
  );
}

const PERIODS = [
  { key: "7d", label: "7 ngày" },
  { key: "14d", label: "14 ngày" },
  { key: "30d", label: "30 ngày" },
  { key: "90d", label: "90 ngày" },
  { key: "month", label: "Tháng này" },
  { key: "quarter", label: "Quý này" },
  { key: "all", label: "Tất cả" },
] as const;

function periodRange(period: string, fromParam?: string, toParam?: string): { from: string; to: string } {
  const today = todayISO();
  const [ty, tm] = today.split("-").map(Number);
  const todayNum = Math.floor(Date.UTC(ty, tm - 1, Number(today.split("-")[2])) / 86400000);
  const isoOfNum = (n: number) => {
    const dt = new Date(n * 86400000);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  };
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  switch (period) {
    case "7d":
      return { from: isoOfNum(todayNum - 6), to: today };
    case "14d":
      return { from: isoOfNum(todayNum - 13), to: today };
    case "30d":
      return { from: isoOfNum(todayNum - 29), to: today };
    case "month":
      return { from: `${ty}-${pad(tm)}-01`, to: today };
    case "quarter": {
      const qm = Math.floor((tm - 1) / 3) * 3 + 1;
      return { from: `${ty}-${pad(qm)}-01`, to: today };
    }
    case "all":
      return { from: "2000-01-01", to: today };
    case "custom":
      return valid(fromParam) && valid(toParam) && (fromParam as string) <= (toParam as string)
        ? { from: fromParam as string, to: toParam as string }
        : { from: isoOfNum(todayNum - 89), to: today };
    default:
      return { from: isoOfNum(todayNum - 89), to: today };
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { period?: string; from?: string; to?: string };
}) {
  const profile = await getCurrentProfile();
  const canSeeMoney = ["OWNER", "ACCOUNTING", "CEO"].includes(profile.data?.role ?? "");
  // Giá vốn / lợi nhuận: Chủ, Kế toán và CEO được coi (chỉ xem đối với CEO).
  const canSeeCost = ["OWNER", "ACCOUNTING", "CEO"].includes(profile.data?.role ?? "");
  const period = searchParams?.period ?? "90d";
  const { from, to } = periodRange(period, searchParams?.from, searchParams?.to);
  // P2: tài khoản chưa gán ngành thì dừng ở đây — không tải dữ liệu.
  const ctx = await getBusinessLineContext();
  if (ctx.mode === "NONE") {
    return (
      <>
        <PageHeader title="Tổng quan" />
        <NoBusinessLineNotice />
      </>
    );
  }
  const lineFilter = ctx.mode === "LINE" ? ctx.lineId : undefined;
  const isAll = ctx.mode === "ALL";
  const [d, partnerStats, groupPerf, slow, recent, perf, groupValue, consBars, agingBars, cashflow, alertsResult, cashBalancesRes, debtByLine, lineComparison] = await Promise.all([
    getDashboard(lineFilter),
    listPartnerStats(),
    getGroupPerformance(lineFilter),
    getSlowMoving(90, lineFilter),
    listLedgerMovements(8, lineFilter),
    canSeeCost ? getPerformanceSeries(from, to, lineFilter) : Promise.resolve([]),
    canSeeCost ? getInventoryValueByGroup(lineFilter) : Promise.resolve([]),
    canSeeMoney ? getPartnerConsignmentBars(lineFilter) : Promise.resolve([]),
    canSeeMoney ? getReceivableAgingBars(lineFilter) : Promise.resolve([]),
    canSeeMoney ? getCashFlowRunway() : Promise.resolve(null),
    canSeeMoney ? getExecutiveAlerts() : Promise.resolve(null),
    canSeeMoney ? getCashFundBalances() : Promise.resolve({ configured: true, data: [] }),
    canSeeMoney && isAll ? getDebtByLine() : Promise.resolve([]),
    canSeeMoney && isAll ? getLineComparison() : Promise.resolve([]),
  ]);
  const cashBalances = cashBalancesRes.data ?? [];
  const totalCash = cashBalances.reduce((a, f) => a + Number(f.balance ?? 0), 0);
  const grossMargin = d.revenueAll > 0 ? Math.round((d.grossProfitAll / d.revenueAll) * 100) : 0;
  const cogsAll = d.revenueAll - d.grossProfitAll;
  // Gross Margin: lãi gộp trên doanh thu thuần. Markup on Cost: lãi gộp
  // trên giá vốn hàng đã bán. Chỉ đổi tên gọi, cách tính giữ nguyên.
  const roiAll = cogsAll > 0 ? Math.round((d.grossProfitAll / cogsAll) * 100) : 0;
  // Tỷ trọng vốn theo vị trí trên tổng hàng TVK sở hữu (giá vốn).
  const bookShare = (v: number) =>
    d.bookInventoryValue > 0
      ? `${((v / d.bookInventoryValue) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}% tổng hàng sở hữu`
      : "—";
  // Hiệu suất ký gửi: đã tiêu thụ trên đã gửi (phiếu GK + báo cáo BT đã
  // xác nhận). "Đã bán" trực tiếp không nằm ở khối này.
  const sentQty = d.flows.sentQty;
  const consumedQty = d.flows.consumedQty;
  const consumeRate = sentQty > 0 ? Math.round((consumedQty / sentQty) * 100) : 0;
  if (!d.configured) {
    return (
      <>
        <PageHeader title="Tổng quan" />
        <NotConfigured />
      </>
    );
  }
  const role = profile.data?.role ?? "";

  // Mức độ phải thu quá hạn cho thẻ hero (chỉ tô đỏ khi thực sự nghiêm
  // trọng: quá hạn chiếm từ một nửa số phải thu còn nợ trở lên).
  const overdueRatio = d.receivablesOutstanding > 0 ? d.overdueReceivables / d.receivablesOutstanding : 0;
  const overdueSev = d.overdueReceivables === 0 ? "ok" : overdueRatio >= 0.5 ? "bad" : "watch";

  // P5 — số liệu cho 2 bảng theo ngành ở tầng 1 (chỉ chế độ ALL; khi đã
  // chọn một ngành thì mọi số trên trang đã là của ngành đó).
  const comparisonOil = lineComparison.find((r) => r.lineCode === "OIL");
  const comparisonParts = lineComparison.find((r) => r.lineCode === "AUTO_PARTS");
  const comparisonAll = lineComparison.find((r) => r.lineCode === "ALL");
  const revenueCheck = checkLineTotals(
    [comparisonOil?.revenue ?? 0, comparisonParts?.revenue ?? 0],
    comparisonAll?.revenue ?? 0,
  );
  const debtByCode = (code: string | null) => ({
    recv: sumDebtByLine(
      debtByLine.filter((r) => r.lineCode === code),
      "RECEIVABLE",
    ),
    pay: sumDebtByLine(
      debtByLine.filter((r) => r.lineCode === code),
      "PAYABLE",
    ),
  });
  const debtOil = debtByCode("OIL");
  const debtParts = debtByCode("AUTO_PARTS");
  const debtUncl = debtByCode(null);
  const debtAll = {
    recv: sumDebtByLine(debtByLine, "RECEIVABLE"),
    pay: sumDebtByLine(debtByLine, "PAYABLE"),
  };
  const hasUnclassifiedDebt = debtByLine.some((r) => r.lineCode === null);
  const debtTableRows = [
    { label: "Dầu nhớt", recv: debtOil.recv, pay: debtOil.pay, bold: false },
    { label: "Phụ tùng", recv: debtParts.recv, pay: debtParts.pay, bold: false },
    ...(hasUnclassifiedDebt
      ? [{ label: "Chưa phân loại", recv: debtUncl.recv, pay: debtUncl.pay, bold: false }]
      : []),
    { label: "Toàn doanh nghiệp", recv: debtAll.recv, pay: debtAll.pay, bold: true },
  ];

  // Khối Executive Control: Cảnh báo đỏ & Dòng tiền 14-30 ngày cho CEO / Shadow Controller.
  // Nằm trong tầng 1, ngay sau dãy KPI hero để CEO thấy vấn đề sớm.
  const executiveSection =
    !canSeeMoney || !cashflow || !alertsResult ? null : (
      <ExecutiveControlSection cashflow={cashflow} alertsResult={alertsResult} />
    );

  // Tầng 1 — Tổng quan điều hành: 5 giây nắm tình hình. Tiền tổng chỉ
  // Chủ cửa hàng, Kế toán và CEO thấy (canSeeMoney); Bán hàng và Thủ kho
  // không thấy tầng này. Lợi nhuận gộp chặn thêm một lớp (canSeeCost).
  // Dãy KPI hero: 5 số theo thứ tự Doanh thu → Lãi gộp → Tiền mặt &
  // ngân hàng → Phải thu quá hạn → Giá trị hàng sở hữu (giá vốn). Phải
  // trả không vào dãy hero — xem ở bảng Công nợ theo ngành bên dưới.
  const layer1 = !canSeeMoney ? null : (
    <section>
      <LayerHeading title="Tổng quan điều hành" desc="Doanh thu, lãi gộp, tiền mặt, phải thu quá hạn và giá trị hàng sở hữu." accent="border-blue-600" />
      <div className="grid gap-4">
        <HeroKpi label="Doanh thu" value={formatVND(d.revenueAll)} sub={`Từ trước tới nay · ${formatNumber(d.orderCountAll)} đơn đã xác nhận`} box="border-slate-200 border-l-4 border-l-blue-700 bg-white text-slate-600" num="text-slate-900" big />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {canSeeCost && (
            <HeroKpi label="Lãi gộp" value={formatVND(d.grossProfitAll)} sub={`Lũy kế · Lãi ${grossMargin}% trên doanh thu`} box="border-emerald-200 bg-emerald-50 text-emerald-900" num="text-emerald-700" />
          )}
          <HeroKpi label="Tiền mặt & ngân hàng" value={cashBalances.length > 0 ? formatVND(totalCash) : "Chưa thiết lập"} sub={cashBalances.length > 0 ? "Số dư hiện tại" : "Thêm quỹ ở Cài đặt → Quỹ tiền"} box="border-sky-200 bg-sky-50 text-sky-900" num="text-sky-800" />
          <HeroKpi
            label="Phải thu quá hạn"
            value={formatVND(d.overdueReceivables)}
            sub={
              overdueSev === "ok"
                ? "Không có khoản quá hạn"
                : overdueSev === "bad"
                  ? "Quá hạn nghiêm trọng — cần đôn đốc ngay"
                  : "Đã quá hạn — cần đôn đốc thu hồi"
            }
            box={
              overdueSev === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : overdueSev === "bad"
                  ? "border-rose-200 bg-rose-50 text-rose-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
            }
            num={overdueSev === "ok" ? "text-emerald-700" : overdueSev === "bad" ? "text-rose-700" : "text-amber-700"}
          />
          <HeroKpi label="Giá trị hàng sở hữu" value={formatVND(d.bookInventoryValue)} sub="Theo giá vốn lô" box="border-violet-200 bg-violet-50 text-violet-900" num="text-violet-800" />
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Chưa tách thuế GTGT.</p>
      {executiveSection}
      {isAll && lineComparison.length > 0 && (
        <div className="mt-4">
          <Card title="So sánh theo ngành" tone="blue">
            <TableWrap>
              <thead><tr><th className={thCls}>Ngành</th><th className={thCls}>Doanh thu</th><th className={thCls}>Lãi gộp</th><th className={thCls}>Tồn kho (giá vốn)</th><th className={thCls}>Phải thu còn nợ</th><th className={thCls}>Phải trả còn nợ</th></tr></thead>
              <tbody>
                {lineComparison.map((r) => (
                  <tr key={r.lineLabel} className={`border-t border-slate-100 ${r.lineCode === "ALL" ? "bg-slate-50 font-bold" : ""}`}>
                    <td className={tdCls}>{r.lineLabel}</td>
                    <td className={tdCls}>{formatVND(r.revenue)}</td>
                    <td className={tdCls}>{formatVND(r.profit)}</td>
                    <td className={tdCls}>{formatVND(r.inventoryValue)}</td>
                    <td className={tdCls}>{formatVND(r.receivableOutstanding)}</td>
                    <td className={tdCls}>{formatVND(r.payableOutstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {revenueCheck.matches
                ? "Tổng các ngành = toàn doanh nghiệp (BL-020: khớp, chênh lệch 0đ)."
                : `Tổng Dầu nhớt + Phụ tùng lệch ${formatVND(Math.abs(revenueCheck.diff))} so với toàn doanh nghiệp — đúng bằng doanh thu chưa phân loại ngành (BL-020).`}
              {" "}Tồn kho tính theo giá vốn lô, chỉ hàng TVK sở hữu.
            </p>
          </Card>
        </div>
      )}
      {isAll && debtByLine.length > 0 && (
        <div className="mt-4">
          <Card title="Công nợ theo ngành" tone="rose">
            <TableWrap>
              <thead><tr><th className={thCls}>Ngành</th><th className={thCls}>Phải thu còn nợ</th><th className={thCls}>Phải thu quá hạn</th><th className={thCls}>Phải trả còn nợ</th><th className={thCls}>Phải trả quá hạn</th></tr></thead>
              <tbody>
                {debtTableRows.map((r) => (
                  <tr key={r.label} className={`border-t border-slate-100 ${r.bold ? "bg-slate-50 font-bold" : ""}`}>
                    <td className={tdCls}>{r.label}</td>
                    <td className={tdCls}>{formatVND(r.recv.outstanding)}</td>
                    <td className={tdCls}>{formatVND(r.recv.overdue)}</td>
                    <td className={tdCls}>{formatVND(r.pay.outstanding)}</td>
                    <td className={tdCls}>{formatVND(r.pay.overdue)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {hasUnclassifiedDebt
                ? `Còn công nợ chưa phân loại ngành: phải thu ${formatVND(debtUncl.recv.outstanding)}, phải trả ${formatVND(debtUncl.pay.outstanding)} — tổng Dầu nhớt + Phụ tùng lệch đúng bằng số này (BL-020).`
                : "Tổng các ngành = toàn doanh nghiệp (BL-020: khớp, chênh lệch 0đ)."}
            </p>
          </Card>
        </div>
      )}
      {cashBalances.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tiền mặt & ngân hàng</p>
          <div className="mt-2 space-y-1 text-sm">
            {cashBalances.map((f) => (
              <div key={f.fund_id} className="flex items-baseline justify-between gap-2">
                <span>
                  {f.fund_name}{" "}
                  <span className="text-xs text-slate-500">({f.kind === "CASH" ? "Tiền mặt" : "Ngân hàng"})</span>
                </span>
                <span className="font-bold">{formatVND(f.balance)}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-2 border-t border-slate-100 pt-1 font-bold">
              <span>Tổng tiền đang có</span>
              <span>{formatVND(totalCash)}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );

  // Tầng 2 — Tài sản và hàng hóa: của TVK, được ký gửi, gửi đối tác.
  const layer2 = (
    <section className="mt-8">
      <LayerHeading title="Tài sản và hàng hóa" desc="Hàng hoá của TVK, hàng được ký gửi và hàng đang gửi ở đối tác — tách biệt theo từng lô." accent="border-sky-500" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Tồn kho (số lượng)" value={`${formatNumber(d.ownedQty)} đơn vị`} sub={`${formatVND(d.ownedValue)} theo giá bán · ${formatNumber(d.ownedLotCount)} lô`} tone="emerald" />
        <StatCard label="Hàng nhận ký gửi (số lượng)" value={`${formatNumber(d.consignedQty)} đơn vị`} sub={`${formatVND(d.consignedValue)} được nhà cung cấp ký gửi · ${formatNumber(d.consignedLotCount)} lô`} tone="amber" />
        <StatCard label="Hàng TVK tại đối tác" value={`${formatNumber(d.atPartnersQty)} đơn vị`} sub={`${formatVND(d.atPartnersValue)} theo giá chuyển giao · ${formatNumber(d.atPartnersLotCount)} lô`} tone="sky" />
      </div>
      {canSeeCost && (
        <div className="mt-4">
          <Card title="Tính theo giá vốn (tiền nhập hàng)" tone="slate">
            <p className="mb-3 text-sm leading-relaxed text-slate-600">
              Theo giá vốn; hàng được ký gửi không phải tài sản, không gộp vào tổng.
            </p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Tổng tiền hàng trong kho (giá vốn)" value={formatVND(d.bookOwnedOwnValue)} sub={bookShare(d.bookOwnedOwnValue)} />
              <StatCard label="Hàng TVK đang gửi ở đối tác" value={formatVND(d.bookAtPartnersOwnedValue)} sub={bookShare(d.bookAtPartnersOwnedValue)} />
              <StatCard label="Tổng hàng tồn kho của TVK (kho + ký gửi)" value={formatVND(d.bookInventoryValue)} />
              <StatCard label="Hàng được ký gửi (không phải tài sản)" value={formatVND(d.bookConsignedCustodyValue)} sub="Chỉ theo dõi, không ghi vào tài sản" />
            </div>
          </Card>
        </div>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <StockCompositionCard
          rings={d.rings}
          tierValues={d.warehouseTierValues}
          ownedBookValue={d.bookInventoryValue}
          ownedQty={d.ownedQty + d.atPartnersQty}
          managedBookValue={d.bookInventoryValue + d.bookConsignedCustodyValue}
          custodyBookValue={d.bookConsignedCustodyValue}
          custodyQty={d.consignedQty}
          canSeeMoney={canSeeMoney}
          canSeeCost={canSeeCost}
        />
        {canSeeMoney && (
          <Card title="Hàng ký gửi bán được bao nhiêu" tone="amber">
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Đang gửi đối tác</p>
                <p className="mt-1 text-lg font-bold leading-tight text-slate-900">{formatNumber(sentQty)} đơn vị</p>
              </div>
              <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Giá trị chuyển giao</p>
                <p className="mt-1 text-lg font-bold leading-tight text-slate-900">{formatCompactVND(d.flows.sentValue)}</p>
              </div>
              <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Đã bán</p>
                <p className="mt-1 text-lg font-bold leading-tight text-slate-900">{formatNumber(consumedQty)} đơn vị</p>
              </div>
              <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tỷ lệ đã bán</p>
                <p className="mt-1 text-lg font-bold leading-tight text-slate-900">{consumeRate}%</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${consumeRate}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between gap-3 text-xs text-slate-500">
                <span>Đã bán {formatNumber(consumedQty)} đơn vị</span>
                <span>Còn tại đối tác {formatNumber(d.flows.stillQty)} đơn vị</span>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Chỉ tính GK/BT đã xác nhận; giá chuyển giao mới nhất theo lô.
            </p>
          </Card>
        )}
      </div>
      {canSeeMoney && (
        <div className="mt-4">
          <Card title="Đối tác đã bán được bao nhiêu hàng ký gửi" tone="amber">
            <StackedBarList
              rows={consBars.map((r) => ({
                name: r.partnerName,
                href: `/partners/${r.partnerId}`,
                consumed: r.consumed,
                remaining: r.remaining,
                pending: r.pending,
                transferValue: r.transferValue,
                formatQty: (v) => `${formatNumber(v)} đơn vị`,
                formatMoney: (v) => formatVND(v),
              }))}
            />
            <p className="mt-3 text-right text-xs">
              <Link href="/reports" className="text-blue-700 hover:underline">
                Xem báo cáo đối chiếu →
              </Link>
            </p>
          </Card>
        </div>
      )}
      <div className="mt-4">
        <CollapsibleCard title="Thống kê đối tác" tone="sky" hint="Bấm để xem 5 số liệu từng đối tác">
          <PartnerStatsDialog partners={partnerStats} />
        </CollapsibleCard>
      </div>
    </section>
  );

  // Tầng 3 — Phân tích kinh doanh: doanh thu, lợi nhuận, nhóm hàng.
  const layer3 = (
    <section className="mt-8">
      <LayerHeading title="Phân tích kinh doanh" desc="Doanh thu, lợi nhuận và sức bán theo nhóm hàng." accent="border-emerald-500" />
      <div className="grid gap-4 lg:grid-cols-3">
        {canSeeCost && (
          <Card title="Doanh thu – Giá vốn – Lãi" className="lg:col-span-2" tone="blue">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {PERIODS.map((p) => (
                <Link
                  key={p.key}
                  href={`/dashboard?period=${p.key}`}
                  className={
                    period === p.key
                      ? "touch-control inline-flex items-center rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white"
                      : "touch-control inline-flex items-center rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  }
                >
                  {p.label}
                </Link>
              ))}
              <form action="/dashboard" method="get" className="flex items-center gap-1">
                <input type="hidden" name="period" value="custom" />
                <input type="date" name="from" defaultValue={from} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                <span className="text-xs text-slate-400">–</span>
                <input type="date" name="to" defaultValue={to} className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
                <button type="submit" className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50">
                  Xem
                </button>
              </form>
            </div>
            <p className="mb-2 text-xs text-slate-500">
              <span className="text-blue-600">■</span> Doanh thu thuần{" "}
              <span className="text-amber-500">■</span> Giá vốn{" "}
              <span className="text-emerald-500">—</span> Lãi
            </p>
            {perf.reduce((a, p) => a + p.revenue, 0) === 0 ? (
              <EmptyState message="Chưa có dữ liệu kinh doanh trong khoảng thời gian đã chọn." />
            ) : (
              <ComposedChart data={perf} />
            )}
            <p className="mt-2 text-right text-xs">
              <Link href="/sales" className="text-blue-700 hover:underline">
                Xem chứng từ bán hàng →
              </Link>
            </p>
          </Card>
        )}
        {canSeeCost && (
          <Card title="Giá trị tồn kho theo nhóm (giá vốn, chỉ hàng TVK)" tone="sky">
            {groupValue.length === 0 ? (
              <EmptyState message="Chưa có tồn kho theo nhóm hàng." />
            ) : (
              <HBarList
                data={groupValue.map((g) => ({
                  label: `${g.group} (${formatNumber(g.lots)} lô)`,
                  value: g.value,
                  color: "#059669",
                  href: `/products?group=${g.group === "Chưa xếp nhóm" ? "__none" : encodeURIComponent(g.group)}`,
                }))}
              />
            )}
          </Card>
        )}
      </div>
      {canSeeCost && (
        <div className="mt-4">
          <CollapsibleCard title="Phân tích đơn hàng" tone="emerald" hint="Bấm để xem tóm tắt và biểu đồ từng đơn">
            <p className="mb-2 text-base leading-relaxed text-slate-600">
              Doanh thu thuần <strong className="text-slate-900">{formatVND(d.revenueAll)}</strong>
              {" · "}Giá vốn <strong className="text-slate-900">{formatVND(cogsAll)}</strong>
              {" · "}Lợi nhuận gộp <strong className="text-slate-900">{formatVND(d.grossProfitAll)}</strong>
              {` (Lãi ${grossMargin}% trên doanh thu · Lãi ${roiAll}% trên giá vốn)`}.
              Giá vốn tính theo lô thực tế đã xuất; giảm giá đã trừ vào doanh thu thuần.
              {" "}30 ngày gần nhất: doanh thu thuần {formatVND(d.revenue30)}, lợi nhuận {formatVND(d.grossProfit30)}, {formatNumber(d.orderCount30)} đơn. Tổng số lượng đã bán (lũy kế): {formatNumber(d.flows.soldQty)} đơn vị.
            </p>
            {d.orderAnalysis.length === 0 ? (
              <EmptyState message="Chưa có đơn hàng nào được xác nhận." />
            ) : (
              <GroupedBarChart
                data={d.orderAnalysis.slice(0, 8).map((o) => ({ label: o.code, a: o.revenue, b: o.cogs }))}
                labelA="Doanh thu"
                labelB="Giá vốn"
              />
            )}
          </CollapsibleCard>
        </div>
      )}
      <div className="mt-4">
        <Card title="Doanh thu theo nhóm hàng" tone="emerald">
          {groupPerf.length === 0 ? (
            <EmptyState message="Chưa có doanh thu theo nhóm hàng." />
          ) : (
            <HBarList
              data={groupPerf.map((g) => ({
                label: g.group,
                value: g.revenue,
                color: "#2563eb",
                href: `/products?group=${g.group === "Chưa xếp nhóm" ? "__none" : encodeURIComponent(g.group)}`,
              }))}
            />
          )}
        </Card>
      </div>
      <div className="mt-4">
        <CollapsibleCard title="Top 5 sản phẩm bán chạy (30 ngày)" tone="emerald" hint="Bấm để xem top 5">
          {d.topProducts.length === 0 ? (
            <EmptyState message="Chưa có sản phẩm nào được bán trong 30 ngày qua." />
          ) : (
            <HBarList
              data={d.topProducts.map((p) => ({
                label: `${p.sku} — ${p.name}`,
                value: Number(p.qty_sold),
                color: "#2563eb",
              }))}
              format={(v) => formatNumber(v)}
            />
          )}
        </CollapsibleCard>
      </div>
    </section>
  );

  // Tầng 4 — Rủi ro và tồn đọng: tồn thấp, chậm luân chuyển, quá hạn.
  const layer4 = (
    <section className="mt-8">
      <LayerHeading title="Rủi ro và tồn đọng" desc="Hàng sắp hết, hàng để lâu không bán được, tiền nợ quá hạn, và hàng gửi đối tác bị lệch số." accent="border-rose-500" />
      <div className="grid gap-4 lg:grid-cols-2">
        {canSeeMoney && (
          <Card title="Tiền nợ theo tình hình trả" tone="rose">
            <HBarList
              data={[
                { label: "Phải thu — quá hạn", value: d.overdueReceivables, color: "#e11d48" },
                { label: "Phải trả — quá hạn", value: d.overduePayables, color: "#9f1239" },
                { label: "Phải trả — chưa thanh toán", value: d.balances.payablesUnpaid, color: "#f43f5e" },
                { label: "Phải trả — một phần", value: d.balances.payablesPartial, color: "#f59e0b" },
                { label: "Phải thu — chưa thanh toán", value: d.balances.receivablesUnpaid, color: "#0ea5e9" },
                { label: "Phải thu — một phần", value: d.balances.receivablesPartial, color: "#8b5cf6" },
              ]}
            />
          </Card>
        )}
        {canSeeMoney && (
          <Card title="Tiền phải thu theo thời gian quá hạn" tone="rose">
            <HBarList data={agingBars} />
            <p className="mt-3 text-right text-xs">
              <Link href="/receivables" className="text-blue-700 hover:underline">
                Xem công nợ phải thu →
              </Link>
            </p>
          </Card>
        )}
        <Card title="Hàng để 90 ngày không bán được" tone="amber">
          {slow.rows.length === 0 ? (
            <EmptyState message="Không có sản phẩm chậm luân chuyển trong 90 ngày qua." />
          ) : (
            <TableWrap>
              <thead><tr><th className={thCls}>SKU</th><th className={thCls}>Sản phẩm</th><th className={thCls}>Tồn</th><th className={thCls}>Xuất gần nhất</th><th className={thCls}>Ngày không xuất</th></tr></thead>
              <tbody>
                {slow.rows.map((r) => (
                  <tr key={r.product_id} className="border-t border-slate-100">
                    <td className={tdCls}>{r.sku}</td>
                    <td className={tdCls}>{r.name}</td>
                    <td className={tdCls}>{formatNumber(r.qty)}</td>
                    <td className={tdCls}>{r.lastOutAt ? formatDate(r.lastOutAt) : "Chưa từng xuất"}</td>
                    <td className={tdCls}>{formatNumber(r.idleDays)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          {slow.total > slow.rows.length && (
            <p className="mt-2 text-xs text-slate-500">Đang hiện {slow.rows.length} trong tổng số {slow.total} sản phẩm chậm.</p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Tồn kho 90 ngày không xuất/bán/trả; hàng mới nhập không tính.
          </p>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Hàng sắp hết (bằng hoặc dưới mức tối thiểu)" tone="amber">
          {d.lowStock.length === 0 ? (
            <EmptyState message="Chưa có sản phẩm sắp hết." />
          ) : (
            <TableWrap>
              <thead><tr><th className={thCls}>SKU</th><th className={thCls}>Sản phẩm</th><th className={thCls}>Tổng số lượng</th></tr></thead>
              <tbody>
                {d.lowStock.map((r) => (
                  <tr key={r.product_id} className="border-t border-slate-100">
                    <td className={tdCls}>{r.sku}</td>
                    <td className={tdCls}>{r.name}</td>
                    <td className={tdCls}>{formatNumber(r.total_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card title="Lô ký gửi phải trả trong 30 ngày tới" tone="rose">
          {d.expiring.length === 0 ? (
            <EmptyState message="Chưa có lô nào sắp đến hạn trả." />
          ) : (
            <TableWrap>
              <thead><tr><th className={thCls}>Lô</th><th className={thCls}>Sản phẩm</th><th className={thCls}>Nhập từ</th><th className={thCls}>Số lượng</th><th className={thCls}>Hạn trả</th></tr></thead>
              <tbody>
                {d.expiring.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className={tdCls}>{r.batch_code}</td>
                    <td className={tdCls}>{r.product_name}</td>
                    <td className={tdCls}>{r.supplier_name}</td>
                    <td className={tdCls}>{formatNumber(r.qty)}</td>
                    <td className={tdCls}>{formatDate(r.return_by_date)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
      {d.discrepancies.length > 0 && (
        <div className="mt-4">
          <Card title="Hàng gửi đối tác bị lệch số (số đã gửi không khớp với số đã bán + đã trả lại + còn giữ)" tone="rose">
            <TableWrap>
              <thead><tr><th className={thCls}>Đối tác</th><th className={thCls}>Đã gửi</th><th className={thCls}>Đã bán</th><th className={thCls}>Đã trả</th><th className={thCls}>Còn giữ</th></tr></thead>
              <tbody>
                {d.discrepancies.map((r) => (
                  <tr key={r.partner_id} className="border-t border-slate-100">
                    <td className={tdCls}>{r.partner_name}</td>
                    <td className={tdCls}>{formatNumber(r.qty_sent)}</td>
                    <td className={tdCls}>{formatNumber(r.qty_consumed)}</td>
                    <td className={tdCls}>{formatNumber(r.qty_returned)}</td>
                    <td className={tdCls}>{formatNumber(r.qty_still_at_partner)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        </div>
      )}
    </section>
  );

  // Tầng 5 — Hoạt động kho gần đây: 8 bút toán kho mới nhất, xem đủ ở sổ cái.
  // Thu gọn mặc định — CEO ít cần xem ngay, cần thì bấm mở.
  const layer5 = (
    <section className="mt-8">
      <CollapsibleCard
        title="Hoạt động kho gần đây"
        hint={recent.data.length > 0 ? `${recent.data.length} hoạt động mới nhất · Bấm để xem` : "Bấm để xem"}
      >
        {recent.data.length === 0 ? (
          <EmptyState message="Chưa có hoạt động nào." />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {recent.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
                <span className="whitespace-nowrap text-xs text-slate-500">
                  {new Date(r.created_at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="font-medium text-slate-800">{MOVEMENT_KIND_LABELS[r.movement_kind] ?? r.movement_kind}</span>
                <span className="text-slate-600">
                  {formatNumber(r.qty)} × {r.product_name} ({r.batch_code})
                </span>
                <span className="text-slate-500">
                  {r.from_name ?? "Ngoài hệ thống"} → {r.to_name ?? "Ra khỏi hệ thống"}
                </span>
                {r.doc_code && <span className="text-xs text-slate-500">{r.doc_code}</span>}
                {r.created_by_name && <span className="text-xs text-slate-500">{r.created_by_name}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm">
          <Link href="/ledger" className="font-medium text-blue-700 hover:underline">
            Xem lịch sử kho đầy đủ →
          </Link>
        </p>
      </CollapsibleCard>
    </section>
  );

  // Một trang duy nhất, thứ tự các TẦNG xếp theo vai trò. Mặc định
  // (Chủ/Kế toán/CEO): KPI + cảnh báo trước, rồi Rủi ro, Phân tích,
  // Tài sản, Hoạt động — CEO thấy vấn đề sớm. Bán hàng thấy hiệu quả
  // trước, thủ kho thấy hàng hoá và cảnh báo trước (giữ nguyên như cũ).
  // Khối cảnh báo nằm trong tầng 1 nên không render riêng nữa. Từng phần
  // tự khóa theo quyền nên vai trò nào cũng chỉ thấy phần mình được coi.
  return (
    <>
      <PageHeader
        title="Tổng quan"
        description="Tồn kho và hàng ký gửi luôn được theo dõi tách biệt."
      />
      <QuickShortcuts role={role} />
      {role === "SALES" ? (
        <>{layer1}{layer3}{layer2}{layer4}{layer5}</>
      ) : role === "WAREHOUSE" ? (
        <>{layer2}{layer4}{layer1}{layer3}{layer5}</>
      ) : (
        <>{layer1}{layer4}{layer3}{layer2}{layer5}</>
      )}
    </>
  );
}
