import Link from "next/link";
import { PageHeader, TableWrap, tdCls, thCls } from "@/components/ui";
import { getCurrentProfile, listPartners } from "@/lib/queries";
import { getThreeWayMatchingAudit } from "@/lib/audit";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import AuditCenterClient from "./AuditCenterClient";

export const dynamic = "force-dynamic";

export default async function AuditCenterPage({
  searchParams,
}: {
  searchParams?: {
    signal?: string; // ALL, RED, AMBER, GREEN
    partner?: string;
    period?: string; // 7d, 30d, 60d, 90d, all
  };
}) {
  const profile = await getCurrentProfile();
  const role = profile.data?.role ?? "";
  const canAccess = ["OWNER", "ACCOUNTING", "CEO"].includes(role);

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Đối chiếu kho – bán hàng – hoá đơn"
          description="So 3 thứ với nhau: hàng trong kho, số bán hàng trong hệ thống, và hoá đơn + tiền nợ."
        />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-sm">
          <h3 className="font-semibold text-base">Khu vực kiểm soát điều hành giới hạn</h3>
          <p className="mt-1.5 leading-relaxed">
            Màn hình <strong>Đối chiếu kho – bán hàng – hoá đơn</strong> chỉ dành riêng cho Ban điều hành (Chủ doanh nghiệp, CEO) và Kế toán, để kiểm tra số liệu có khớp nhau không.
          </p>
          <div className="mt-4">
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-lg bg-amber-800 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-900"
            >
              ← Quay lại Trang tổng quan
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const signal = searchParams?.signal ?? "ALL";
  const partnerId = searchParams?.partner ?? "";
  const period = searchParams?.period ?? "30d";

  const periodDaysMap: Record<string, number> = {
    "7d": 7,
    "30d": 30,
    "60d": 60,
    "90d": 90,
    all: 0,
  };
  const days = periodDaysMap[period] ?? 30;

  const [auditResult, partnersRes] = await Promise.all([
    getThreeWayMatchingAudit({
      signal: signal === "ALL" ? undefined : signal,
      partnerId: partnerId || undefined,
      days,
    }),
    listPartners(),
  ]);

  const partners = partnersRes.data;
  const {
    rows,
    discrepancyRows,
    redCount,
    amberCount,
    greenCount,
    totalCount,
    overdueInvoiceCount,
    overdueDebtCount,
    totalUninvoicedAmount,
    totalOverdueDebtAmount,
  } = auditResult;

  return (
    <div className="space-y-6">
      {/* Tiêu đề & Action bar */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
              Ban điều hành
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-medium text-slate-500">
              Chỉ xem, không sửa số liệu
            </span>
          </div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">
            Đối chiếu kho – bán hàng – hoá đơn
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-4xl leading-relaxed">
            So 3 thứ với nhau: <strong>hàng trong kho</strong>, <strong>số bán hàng trong hệ thống</strong>, và <strong>hoá đơn + tiền nợ</strong>. Phát hiện ngay hoá đơn xuất chậm quá 5 ngày, tiền nợ quá hạn và bán lỗ dưới giá vốn.
          </p>
        </div>

        <AuditCenterClient rows={rows} discrepancyRows={discrepancyRows} />
      </div>

      {/* TOP KPI CARDS */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-rose-700">Tín hiệu Đỏ (Lệch)</p>
            <span className="h-2 w-2 rounded-full bg-rose-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-rose-800">{formatNumber(redCount)} <span className="text-xs font-normal text-rose-600">dòng</span></p>
          <p className="mt-1 text-[11px] text-rose-600">Cần kế toán & kho giải trình</p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-amber-800">Tín hiệu Vàng (Theo dõi)</p>
            <span className="h-2 w-2 rounded-full bg-amber-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-900">{formatNumber(amberCount)} <span className="text-xs font-normal text-amber-700">dòng</span></p>
          <p className="mt-1 text-[11px] text-amber-700">Chờ xuất HĐ / nợ trong hạn</p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-emerald-800">Tín hiệu Xanh (Khớp chuẩn)</p>
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{formatNumber(greenCount)} <span className="text-xs font-normal text-emerald-700">dòng</span></p>
          <p className="mt-1 text-[11px] text-emerald-700">Đã xuất HĐ & đã thu đủ</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-700">Chậm xuất HĐ (&gt; 5 ngày)</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatNumber(overdueInvoiceCount)} <span className="text-xs font-normal text-rose-600">dòng trễ</span></p>
          <p className="mt-1 text-[11px] text-slate-500">Chưa HĐ: {formatVND(totalUninvoicedAmount)} đ</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-700">Công nợ quá hạn</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatNumber(overdueDebtCount)} <span className="text-xs font-normal text-rose-600">khoản</span></p>
          <p className="mt-1 text-[11px] text-slate-500">Nợ quá hạn: {formatVND(totalOverdueDebtAmount)} đ</p>
        </div>
      </div>

      {/* THANH BỘ LỌC ĐIỀU HÀNH */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <form method="GET" className="grid gap-4 md:grid-cols-12 items-end">
          {/* Lọc theo Tín hiệu Đèn */}
          <div className="md:col-span-5">
            <span className="block text-xs font-semibold text-slate-700 mb-1.5">
              Tín hiệu kiểm soát
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: "ALL", label: "Tất cả", count: totalCount },
                { key: "RED", label: "Đỏ (Lệch)", count: redCount, activeCls: "bg-rose-600 text-white border-rose-600 shadow-sm" },
                { key: "AMBER", label: "Vàng (Theo dõi)", count: amberCount, activeCls: "bg-amber-600 text-white border-amber-600 shadow-sm" },
                { key: "GREEN", label: "Xanh (Khớp)", count: greenCount, activeCls: "bg-emerald-600 text-white border-emerald-600 shadow-sm" },
              ].map((tab) => {
                const isActive = signal === tab.key;
                return (
                  <Link
                    key={tab.key}
                    href={`/audit-center?signal=${tab.key}&partner=${partnerId}&period=${period}`}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? (tab.activeCls ?? "bg-slate-900 text-white border-slate-900 shadow-sm")
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`text-[10px] font-semibold px-1 rounded ${isActive ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>
                      {tab.count}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Lọc theo Đối tác */}
          <div className="md:col-span-4">
            <label htmlFor="partner-select" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Đối tác / Gara
            </label>
            <select
              id="partner-select"
              name="partner"
              defaultValue={partnerId}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
            >
              <option value="">— Tất cả đối tác ({partners.length}) —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Lọc theo Thời gian */}
          <div className="md:col-span-3">
            <label htmlFor="period-select" className="block text-xs font-semibold text-slate-700 mb-1.5">
              3. Khung thời gian
            </label>
            <select
              id="period-select"
              name="period"
              defaultValue={period}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
            >
              <option value="7d">7 ngày gần nhất</option>
              <option value="30d">30 ngày gần nhất (Khuyên dùng)</option>
              <option value="60d">60 ngày gần nhất</option>
              <option value="90d">90 ngày gần nhất</option>
              <option value="all">Toàn bộ lịch sử</option>
            </select>
          </div>

          {/* Nút lọc */}
          <div className="md:col-span-1">
            <input type="hidden" name="signal" value={signal} />
            <button
              type="submit"
              className="w-full inline-flex min-h-[38px] items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Lọc
            </button>
          </div>
        </form>
      </div>

      {/* MA TRẬN ĐỐI SOÁT 3 BÊN */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Bảng So Khớp 3 Chiều Chi Tiết
            </h3>
            <p className="text-xs text-slate-500">
              Đang hiển thị {formatNumber(rows.length)} dòng giao dịch
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Đỏ: Lệch/Trễ HĐ &gt; 5 ngày/Quá hạn nợ
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Vàng: Trong hạn chờ xử lý
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Xanh: Khớp hoàn toàn
            </span>
          </div>
        </div>

        <TableWrap>
          <thead>
            <tr className="bg-slate-50 text-[11px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-200">
              <th className={`${thCls} w-24`}>Tín hiệu</th>
              <th className={`${thCls} min-w-[180px]`}>1. Kho & Thực tế Giao</th>
              <th className={`${thCls} min-w-[220px]`}>2. Doanh số & Giá trị</th>
              <th className={`${thCls} min-w-[150px]`}>Giá bán vs Giá vốn</th>
              <th className={`${thCls} min-w-[180px]`}>3A. Hoá đơn GTGT</th>
              <th className={`${thCls} min-w-[180px]`}>3B. Thu hồi Công nợ</th>
              <th className={`${thCls} min-w-[220px]`}>Kết luận kiểm soát</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  Không tìm thấy giao dịch nào phù hợp với bộ lọc hiện tại.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isRed = r.signal === "RED";
                const isAmber = r.signal === "AMBER";

                return (
                  <tr
                    key={r.id}
                    className={`transition-colors ${
                      isRed
                        ? "bg-rose-50/40 hover:bg-rose-50/70"
                        : isAmber
                        ? "bg-amber-50/30 hover:bg-amber-50/60"
                        : "hover:bg-slate-50/80"
                    }`}
                  >
                    {/* Tín hiệu */}
                    <td className={`${tdCls} align-top whitespace-nowrap`}>
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${
                          isRed
                            ? "bg-rose-100 text-rose-800 ring-rose-600/20"
                            : isAmber
                            ? "bg-amber-100 text-amber-800 ring-amber-600/20"
                            : "bg-emerald-100 text-emerald-800 ring-emerald-600/20"
                        }`}
                      >
                        {isRed ? "🔴 ĐỎ" : isAmber ? "🟡 VÀNG" : "🟢 XANH"}
                      </span>
                    </td>

                    {/* Bên 1: Kho & Giao nhận */}
                    <td className={`${tdCls} align-top`}>
                      <div className="font-semibold text-slate-800">
                        {r.physicalDocCode}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Ngày: {formatDate(r.physicalDate)}
                      </div>
                      <div className="mt-1 font-mono font-medium text-slate-700">
                        SL thực xuất: {formatNumber(r.physicalQty)} cái
                      </div>
                      <span className="mt-0.5 inline-block text-[10px] text-slate-400">
                        {r.physicalKind}
                      </span>
                    </td>

                    {/* Bên 2: Doanh số & Hàng hoá */}
                    <td className={`${tdCls} align-top`}>
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                        <span className="font-mono">{r.salesDocCode}</span>
                        <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                          {r.salesDocKind}
                        </span>
                      </div>
                      <div className="text-slate-700 font-medium">{r.partnerName}</div>
                      <div className="mt-1 text-slate-600">
                        <span className="font-mono text-slate-900 font-semibold">{r.productSku}</span> — {r.productName}
                      </div>
                      <div className="text-[11px] text-slate-400">Lô: {r.batchCode}</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatNumber(r.qty)} × {formatVND(r.unitPrice)} = {formatVND(r.lineTotal)} đ
                      </div>
                    </td>

                    {/* Giá bán vs Giá vốn */}
                    <td className={`${tdCls} align-top`}>
                      <div className="text-slate-600">
                        Vốn: <span className="font-mono font-medium">{formatVND(r.unitCost)} đ</span>
                      </div>
                      <div className="text-slate-600">
                        Bán: <span className="font-mono font-medium">{formatVND(r.unitPrice)} đ</span>
                      </div>
                      <div className="mt-1 border-t border-slate-200/80 pt-1">
                        <span
                          className={`font-semibold ${
                            r.grossProfit >= 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          Lãi: {formatVND(r.grossProfit)} đ
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          Margin: {r.marginPercent}%
                        </span>
                      </div>
                    </td>

                    {/* Bên 3A: Hoá đơn GTGT */}
                    <td className={`${tdCls} align-top`}>
                      <div className="mb-1">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            r.invoiceStatus === "ISSUED"
                              ? "bg-emerald-100 text-emerald-800"
                              : r.invoiceStatus === "OVERDUE_INVOICE"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {r.invoiceStatusLabel}
                        </span>
                      </div>
                      {r.invoiceStatus === "ISSUED" ? (
                        <div className="space-y-0.5 text-[11px]">
                          <div>Số HĐ: <span className="font-mono font-bold text-slate-800">{r.invoiceNo}</span></div>
                          <div>Ký hiệu: <span className="font-mono">{r.invoiceSymbol}</span></div>
                          <div className="text-slate-400">{r.invoiceDate}</div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500">
                          Chưa có hoá đơn GTGT cho dòng này.
                        </div>
                      )}
                    </td>

                    {/* Bên 3B: Công nợ */}
                    <td className={`${tdCls} align-top`}>
                      <div className="mb-1">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            r.debtStatus === "PAID"
                              ? "bg-emerald-100 text-emerald-800"
                              : r.debtStatus === "OVERDUE_PAYMENT"
                              ? "bg-rose-100 text-rose-800"
                              : r.debtStatus === "PENDING_PAYMENT"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {r.debtStatusLabel}
                        </span>
                      </div>
                      {r.remainingAmount > 0 && (
                        <div className="space-y-0.5 text-[11px]">
                          <div>Còn nợ: <span className="font-bold text-rose-600">{formatVND(r.remainingAmount)} đ</span></div>
                          {r.debtDueDate && (
                            <div className="text-slate-500">Hạn: {formatDate(r.debtDueDate)}</div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Kết luận kiểm soát */}
                    <td className={`${tdCls} align-top`}>
                      <p
                        className={`text-xs leading-relaxed font-medium ${
                          isRed
                            ? "text-rose-700 font-semibold"
                            : isAmber
                            ? "text-amber-700"
                            : "text-emerald-700"
                        }`}
                      >
                        {r.discrepancyReason}
                      </p>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}
