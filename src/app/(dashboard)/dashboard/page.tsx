import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, tdCls, thCls } from "@/components/ui";
import { BarChart, DonutChart, GroupedBarChart, HBarList, formatCompactVND } from "@/components/Charts";
import PartnerStatsDialog from "@/components/PartnerStatsDialog";
import { getCurrentProfile, getDashboard, listPartnerStats } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

type StatTone = "blue" | "sky" | "amber" | "emerald" | "violet" | "rose";

// Thẻ số liệu màu kiểu sidebar: viền màu + cạnh dưới đậm + gradient nhạt.
const STAT_TONE_CARD: Record<StatTone, string> = {
  blue: "border-blue-300 border-b-blue-500 bg-gradient-to-b from-blue-100 to-blue-50",
  sky: "border-sky-300 border-b-sky-500 bg-gradient-to-b from-sky-100 to-sky-50",
  amber: "border-amber-300 border-b-amber-500 bg-gradient-to-b from-amber-100 to-amber-50",
  emerald: "border-emerald-300 border-b-emerald-500 bg-gradient-to-b from-emerald-100 to-emerald-50",
  violet: "border-violet-300 border-b-violet-500 bg-gradient-to-b from-violet-100 to-violet-50",
  rose: "border-rose-300 border-b-rose-500 bg-gradient-to-b from-rose-100 to-rose-50",
};

const STAT_TONE_LABEL: Record<StatTone, string> = {
  blue: "text-blue-700",
  sky: "text-sky-700",
  amber: "text-amber-700",
  emerald: "text-emerald-700",
  violet: "text-violet-700",
  rose: "text-rose-700",
};

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: StatTone }) {
  return (
    <div
      className={
        tone
          ? `min-w-0 rounded-xl border-2 border-b-4 p-4 shadow-md ${STAT_TONE_CARD[tone]}`
          : "min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      }
    >
      <p className={`text-xs font-medium uppercase tracking-wide ${tone ? STAT_TONE_LABEL[tone] : "text-slate-500"}`}>{label}</p>
      <p className="mt-1 text-xl font-bold leading-tight text-slate-900 sm:text-2xl">{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${tone ? "text-slate-600" : "text-slate-500"}`}>{sub}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const [d, profile, partnerStats] = await Promise.all([getDashboard(), getCurrentProfile(), listPartnerStats()]);
  const canSeeMoney = ["OWNER", "ACCOUNTING", "CEO"].includes(profile.data?.role ?? "");
  // Giá vốn / lợi nhuận chỉ Chủ cửa hàng và Kế toán được coi — CEO chỉ coi
  // giá trị thật, nhân viên bán hàng/kho không thấy giá vốn và lợi nhuận.
  const canSeeCost = ["OWNER", "ACCOUNTING"].includes(profile.data?.role ?? "");
  const grossMargin = d.revenueAll > 0 ? Math.round((d.grossProfitAll / d.revenueAll) * 100) : 0;
  const revenue14Total = d.revenue14.reduce((a, r) => a + r.value, 0);
  const cogsAll = d.revenueAll - d.grossProfitAll;
  // ROI: lãi trên vốn hàng đã bán (giá vốn). ROS: lãi trên doanh thu.
  const roiAll = cogsAll > 0 ? Math.round((d.grossProfitAll / cogsAll) * 100) : 0;
  if (!d.configured) {
    return (
      <>
        <PageHeader title="Tổng quan" />
        <NotConfigured />
      </>
    );
  }
  const comp = d.stockComposition;
  const compSegments = [
    { label: "Tồn kho tại kho", seg: comp.ownedOwn, color: "#10b981" },
    { label: "Hàng ký gửi tại kho", seg: comp.consignedOwn, color: "#f59e0b" },
    { label: "Hàng tại kho đối tác", seg: comp.atPartners, color: "#0ea5e9" },
  ].map((s) => ({
    label: s.label,
    value: canSeeMoney ? s.seg.value : s.seg.qty,
    color: s.color,
  }));
  const compTotal = compSegments.reduce((a, s) => a + s.value, 0);
  return (
    <>
      <PageHeader
        title="Tổng quan"
        description="Tồn kho và hàng ký gửi luôn được theo dõi tách biệt."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Tồn kho (số lượng)" value={formatNumber(d.ownedQty)} sub={formatVND(d.ownedValue) + " giá trị theo giá bán"} tone="emerald" />
        <StatCard label="Hàng ký gửi (số lượng)" value={formatNumber(d.consignedQty)} sub={formatVND(d.consignedValue) + " đang giữ hộ nhà cung cấp"} tone="amber" />
        <StatCard label="Hàng tại kho đối tác" value={formatNumber(d.atPartnersQty)} sub={formatVND(d.atPartnersValue) + " theo giá chuyển giao"} tone="sky" />
        <StatCard label="Phải trả còn nợ" value={formatVND(d.payablesOutstanding)} sub="Nợ nhà cung cấp cho hàng ký gửi đã bán" tone="rose" />
        <StatCard label="Phải thu còn nợ" value={formatVND(d.receivablesOutstanding)} sub="Đối tác đang nợ TVK" tone="violet" />
      </div>

      {canSeeCost && (
        <div className="mt-6">
          <Card title="Theo sổ kế toán (giá vốn)" tone="slate">
            <p className="mb-3 text-sm leading-relaxed text-slate-600">
              Tồn kho trên sổ ghi theo giá vốn, không theo giá bán. Hàng giữ hộ của nhà cung cấp không phải
              tài sản của cửa hàng nên không gộp vào tổng hàng tồn kho của TVK.
            </p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Tổng tiền hàng trong kho (giá vốn)" value={formatVND(d.bookOwnedOwnValue)} />
              <StatCard label="Hàng của TVK ký gởi" value={formatVND(d.bookAtPartnersOwnedValue)} />
              <StatCard label="Tổng hàng tồn kho của TVK (kho + ký gởi)" value={formatVND(d.bookInventoryValue)} />
              <StatCard label="Hàng giữ hộ (không phải tài sản)" value={formatVND(d.bookConsignedCustodyValue)} sub="Chỉ theo dõi, không ghi vào tài sản" />
            </div>
          </Card>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {canSeeMoney && (
          <Card title="Doanh thu thuần 14 ngày gần nhất" className="lg:col-span-2" tone="blue">
            <p className="mb-2 text-xs text-slate-500">
              Tổng doanh thu thuần 14 ngày: <strong className="text-slate-800">{formatVND(revenue14Total)}</strong>
              {" · "}Tất cả: <strong className="text-slate-800">{formatVND(d.revenueAll)}</strong>
              {" · "}{formatNumber(d.orderCountAll)} đơn đã xác nhận
            </p>
            <BarChart data={d.revenue14} />
          </Card>
        )}
        <Card title="Cơ cấu tồn kho" tone="violet">
          <p className="mb-3 text-xs text-slate-500">
            {canSeeMoney ? "Theo giá trị thật — giá bán / giá chuyển giao (quản trị)" : "Theo số lượng"}
          </p>
          <DonutChart
            segments={compSegments}
            format={canSeeMoney ? formatCompactVND : (v) => formatNumber(v)}
            centerLabel={canSeeMoney ? formatCompactVND(compTotal) : formatNumber(compTotal)}
            centerSub="Tổng hàng đang quản lý"
          />
          {canSeeCost && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-sm leading-relaxed text-slate-600">
                Hàng trong kho TVK theo 3 mức giá: Giá vốn{" "}
                <strong className="text-slate-900">{formatVND(d.warehouseTierValues.cost)}</strong>
                {" · "}Giá sỉ{" "}
                <strong className="text-slate-900">{formatVND(d.warehouseTierValues.wholesale)}</strong>
                {" · "}Giá lẻ{" "}
                <strong className="text-slate-900">{formatVND(d.warehouseTierValues.retail)}</strong>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Chỉ tính hàng của TVK trong kho, chưa gồm hàng ở đối tác (tính theo giá chuyển giao).
                Giá lẻ lấy theo giá sỉ khi sản phẩm chưa có giá lẻ.
              </p>
            </div>
          )}
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Hàng giữ hộ là hàng của nhà cung cấp, không phải tài sản của cửa hàng.
          </p>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Thống kê đối tác" tone="sky">
          <p className="mb-4 text-sm text-slate-500">Chọn một đối tác để xem nhanh số dư, tiền đã trả, hoá đơn và hàng còn ở đối tác đó trong cửa sổ bật lên.</p>
          <PartnerStatsDialog partners={partnerStats} />
        </Card>
      </div>

      {canSeeCost && (
        <div className="mt-6">
          <Card title="Phân tích đơn hàng" tone="emerald">
            <p className="mb-2 text-base leading-relaxed text-slate-600">
              Doanh thu thuần <strong className="text-slate-900">{formatVND(d.revenueAll)}</strong>
              {" · "}Giá vốn <strong className="text-slate-900">{formatVND(cogsAll)}</strong>
              {" · "}Lợi nhuận gộp <strong className="text-slate-900">{formatVND(d.grossProfitAll)}</strong>
              {" "}(ROS {grossMargin}% · ROI {roiAll}%).
              Giá vốn tính theo lô thực tế đã xuất (nhập trước – xuất trước); giảm giá đã trừ vào doanh thu thuần.
              {" "}30 ngày gần nhất: doanh thu thuần {formatVND(d.revenue30)}, lợi nhuận {formatVND(d.grossProfit30)}, {formatNumber(d.orderCount30)} đơn.
            </p>
            <p className="text-xs leading-relaxed text-slate-500">ROS là lãi chia cho doanh thu thuần.</p>
            <p className="mb-3 text-xs leading-relaxed text-slate-500">ROI là lãi chia cho vốn hàng đã bán.</p>
            {d.orderAnalysis.length === 0 ? (
              <EmptyState message="Chưa có đơn hàng nào được xác nhận." />
            ) : (
              <GroupedBarChart
                data={d.orderAnalysis.slice(0, 8).map((o) => ({ label: o.code, a: o.revenue, b: o.cogs }))}
                labelA="Doanh thu"
                labelB="Giá vốn"
              />
            )}
          </Card>
        </div>
      )}

      {canSeeMoney && (
        <div className="mt-6">
          <Card title="Hàng đã bán và đã gửi ký gởi" tone="amber">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Đã bán" value={`${formatNumber(d.flows.soldQty)} cái`} sub={`Doanh thu thuần ${formatVND(d.flows.soldRevenue)}`} />
              <StatCard label="Đã gửi ký gởi" value={`${formatNumber(d.flows.sentQty)} cái`} sub={`Giá chuyển giao ${formatVND(d.flows.sentValue)}`} />
              <StatCard label="Đối tác đã tiêu thụ" value={`${formatNumber(d.flows.consumedQty)} cái`} sub="Theo báo cáo tiêu thụ đã xác nhận" />
              <StatCard label="Còn ở đối tác" value={`${formatNumber(d.flows.stillQty)} cái`} sub={`Giá chuyển giao ${formatVND(d.flows.stillValue)}`} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Chỉ tính chứng từ bán hàng (BH) và phiếu gửi ký gởi (GK) đã xác nhận. Hàng còn ở đối tác
              tính theo giá chuyển giao mới nhất của từng lô.
            </p>
          </Card>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {canSeeMoney && (
          <Card title="Công nợ theo trạng thái" tone="rose">
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
        <Card title="Top 5 sản phẩm bán chạy (30 ngày)" tone="emerald">
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
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
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
        <div className="mt-6">
          <Card title="Chênh lệch ký gửi tại đối tác (đã gửi ≠ đã tiêu thụ + đã trả + còn giữ)" tone="rose">
            <TableWrap>
              <thead><tr><th className={thCls}>Đối tác</th><th className={thCls}>Đã gửi</th><th className={thCls}>Đã tiêu thụ</th><th className={thCls}>Đã trả</th><th className={thCls}>Còn giữ</th></tr></thead>
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
    </>
  );
}
