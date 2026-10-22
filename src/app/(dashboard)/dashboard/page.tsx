import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, tdCls, thCls } from "@/components/ui";
import { BarChart, DonutChart, HBarList, formatCompactVND } from "@/components/Charts";
import { getCurrentProfile, getDashboard } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const [d, profile] = await Promise.all([getDashboard(), getCurrentProfile()]);
  if (!d.configured) {
    return (
      <>
        <PageHeader title="Tổng quan" />
        <NotConfigured />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Tổng quan"
        description="Hàng của mình và hàng ký gửi luôn được theo dõi tách biệt."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Hàng của mình (số lượng)" value={formatNumber(d.ownedQty)} sub={formatVND(d.ownedValue) + " vốn đang nằm trong kho"} />
        <StatCard label="Hàng ký gửi (số lượng)" value={formatNumber(d.consignedQty)} sub={formatVND(d.consignedValue) + " đang giữ hộ nhà cung cấp"} />
        <StatCard label="Hàng tại đối tác (số lượng)" value={formatNumber(d.atPartnersQty)} sub="Đã gửi ký gửi / đã giao, chưa tiêu thụ" />
        <StatCard label="Phải trả còn nợ" value={formatVND(d.payablesOutstanding)} sub="Nợ nhà cung cấp cho hàng ký gửi đã bán" />
        <StatCard label="Phải thu còn nợ" value={formatVND(d.receivablesOutstanding)} sub="Đối tác đang nợ chúng ta" />
      </div>

      {(() => {
        const role = profile.data?.role;
        const canSeeMoney = role === "OWNER" || role === "ACCOUNTING";
        const comp = d.stockComposition;
        const compSegments = [
          { label: "Hàng của mình tại kho", seg: comp.ownedOwn, color: "#10b981" },
          { label: "Hàng ký gửi tại kho", seg: comp.consignedOwn, color: "#f59e0b" },
          { label: "Hàng tại đối tác", seg: comp.atPartners, color: "#0ea5e9" },
        ].map((s) => ({
          label: s.label,
          value: canSeeMoney ? s.seg.value : s.seg.qty,
          color: s.color,
        }));
        const compTotal = compSegments.reduce((a, s) => a + s.value, 0);
        return (
          <>
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              {canSeeMoney && (
                <Card title="Doanh thu 14 ngày gần nhất" className="lg:col-span-2">
                  <BarChart data={d.revenue14} />
                </Card>
              )}
              <Card title="Cơ cấu tồn kho">
                <p className="mb-3 text-xs text-slate-500">
                  {canSeeMoney ? "Theo giá trị vốn" : "Theo số lượng"}
                </p>
                <DonutChart
                  segments={compSegments}
                  format={canSeeMoney ? formatCompactVND : (v) => formatNumber(v)}
                  centerLabel={canSeeMoney ? formatCompactVND(compTotal) : formatNumber(compTotal)}
                  centerSub="Tổng tồn kho"
                />
              </Card>
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              {canSeeMoney && (
                <Card title="Công nợ theo trạng thái">
                  <HBarList
                    data={[
                      { label: "Phải trả — chưa thanh toán", value: d.balances.payablesUnpaid, color: "#f43f5e" },
                      { label: "Phải trả — thanh toán một phần", value: d.balances.payablesPartial, color: "#f59e0b" },
                      { label: "Phải thu — chưa thanh toán", value: d.balances.receivablesUnpaid, color: "#0ea5e9" },
                      { label: "Phải thu — thanh toán một phần", value: d.balances.receivablesPartial, color: "#8b5cf6" },
                    ]}
                  />
                </Card>
              )}
              <Card title="Top 5 sản phẩm bán chạy (30 ngày)">
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
          </>
        );
      })()}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Hàng sắp hết (bằng hoặc dưới mức tối thiểu)">
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

        <Card title="Lô ký gửi phải trả trong 30 ngày tới">
          {d.expiring.length === 0 ? (
            <EmptyState message="Chưa có lô nào sắp đến hạn trả." />
          ) : (
            <TableWrap>
              <thead><tr><th className={thCls}>Lô</th><th className={thCls}>Sản phẩm</th><th className={thCls}>Nhà cung cấp</th><th className={thCls}>Số lượng</th><th className={thCls}>Hạn trả</th></tr></thead>
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
          <Card title="Chênh lệch ký gửi tại đối tác (đã gửi ≠ đã tiêu thụ + đã trả + còn giữ)">
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
