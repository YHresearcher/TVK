import Link from "next/link";
import { Suspense } from "react";
import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { BarChart, DonutChart, GroupedBarChart, HBarList, formatCompactVND } from "@/components/Charts";
import PartnerSelect from "@/components/PartnerSelect";
import { getCurrentProfile, getDashboard, getPartnerDetail, listPartners } from "@/lib/queries";
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { partner?: string };
}) {
  const [d, profile, partners] = await Promise.all([getDashboard(), getCurrentProfile(), listPartners()]);
  const selectedId = searchParams.partner ?? "";
  const detail = selectedId ? await getPartnerDetail(selectedId) : null;
  const canSeeMoney = ["OWNER", "ACCOUNTING", "CEO"].includes(profile.data?.role ?? "");
  // Giá vốn / lợi nhuận chỉ Chủ cửa hàng và Kế toán được coi — CEO chỉ coi
  // giá trị thật, nhân viên bán hàng/kho không thấy giá vốn và lợi nhuận.
  const canSeeCost = ["OWNER", "ACCOUNTING"].includes(profile.data?.role ?? "");
  const grossMargin = d.revenueAll > 0 ? Math.round((d.grossProfitAll / d.revenueAll) * 100) : 0;
  const revenue14Total = d.revenue14.reduce((a, r) => a + r.value, 0);
  const cogsAll = d.revenueAll - d.grossProfitAll;
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
        <StatCard label="Tồn kho (số lượng)" value={formatNumber(d.ownedQty)} sub={formatVND(d.ownedValue) + " giá trị theo giá bán"} />
        <StatCard label="Hàng ký gửi (số lượng)" value={formatNumber(d.consignedQty)} sub={formatVND(d.consignedValue) + " đang giữ hộ nhà cung cấp"} />
        <StatCard label="Hàng tại kho đối tác" value={formatNumber(d.atPartnersQty)} sub={formatVND(d.atPartnersValue) + " theo giá chuyển giao"} />
        <StatCard label="Phải trả còn nợ" value={formatVND(d.payablesOutstanding)} sub="Nợ nhà cung cấp cho hàng ký gửi đã bán" />
        <StatCard label="Phải thu còn nợ" value={formatVND(d.receivablesOutstanding)} sub="Đối tác đang nợ chúng ta" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {canSeeMoney && (
          <Card title="Doanh thu 14 ngày gần nhất" className="lg:col-span-2">
            <p className="mb-2 text-xs text-slate-500">
              Tổng 14 ngày: <strong className="text-slate-800">{formatVND(revenue14Total)}</strong>
              {" · "}Tất cả: <strong className="text-slate-800">{formatVND(d.revenueAll)}</strong>
              {" · "}{formatNumber(d.orderCountAll)} đơn đã xác nhận
            </p>
            <BarChart data={d.revenue14} />
          </Card>
        )}
        <Card title="Cơ cấu tồn kho">
          <p className="mb-3 text-xs text-slate-500">
            {canSeeMoney ? "Theo giá trị thật — giá bán / giá chuyển giao" : "Theo số lượng"}
          </p>
          <DonutChart
            segments={compSegments}
            format={canSeeMoney ? formatCompactVND : (v) => formatNumber(v)}
            centerLabel={canSeeMoney ? formatCompactVND(compTotal) : formatNumber(compTotal)}
            centerSub="Tổng tồn kho"
          />
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Thống kê đối tác">
          <div className="mb-4">
            <label className={labelCls}>Chọn đối tác</label>
            <Suspense>
              <PartnerSelect
                options={partners.data.map((p) => ({ value: p.id, label: p.name }))}
                defaultValue={selectedId}
                className={inputCls}
              />
            </Suspense>
          </div>
          {!detail ? (
            <p className="text-sm text-slate-500">Chọn một đối tác ở trên để xem số dư, tiền đã trả, hoá đơn và hàng còn ở đối tác đó.</p>
          ) : !detail.data.partner ? (
            <EmptyState message="Không tìm thấy đối tác." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                <StatCard label="Số dư còn phải thu" value={formatVND(detail.data.stats.outstanding)} sub="Đối tác còn nợ chúng ta" />
                <StatCard label="Đã thanh toán" value={formatVND(detail.data.stats.totalPaid)} sub="Tổng tiền đã thu" />
                <StatCard label="Hoá đơn đã xuất" value={formatNumber(detail.data.stats.invoiceCount)} sub="Hoá đơn đang hiệu lực" />
                <StatCard label="Giá trị hoá đơn" value={formatVND(detail.data.stats.invoiceTotal)} sub="Tổng tiền hoá đơn đang hiệu lực" />
                <StatCard label="Hàng còn ở đối tác" value={formatNumber(detail.data.stats.stillAtPartner)} sub="Số cái đang ở chỗ đối tác" />
              </div>
              <p className="mt-3 text-sm">
                <Link href={`/partners/${detail.data.partner.id}`} className="font-medium text-blue-700 hover:underline">
                  Mở trang chi tiết {detail.data.partner.name} →
                </Link>
              </p>
            </>
          )}
        </Card>
      </div>

      {canSeeCost && (
        <div className="mt-6">
          <Card title="Phân tích đơn hàng">
            <p className="mb-3 text-sm leading-relaxed text-slate-600">
              Doanh thu <strong className="text-slate-900">{formatVND(d.revenueAll)}</strong>
              {" · "}Giá vốn <strong className="text-slate-900">{formatVND(cogsAll)}</strong>
              {" · "}Lợi nhuận gộp <strong className="text-slate-900">{formatVND(d.grossProfitAll)}</strong>
              {" "}(biên gộp {grossMargin}%)
              {" · "}30 ngày gần nhất: doanh thu {formatVND(d.revenue30)}, lợi nhuận {formatVND(d.grossProfit30)}, {formatNumber(d.orderCount30)} đơn.
            </p>
            {d.orderAnalysis.length === 0 ? (
              <EmptyState message="Chưa có đơn hàng nào được xác nhận." />
            ) : (
              <>
                <GroupedBarChart
                  data={d.orderAnalysis.slice(0, 8).map((o) => ({ label: o.code, a: o.revenue, b: o.cogs }))}
                  labelA="Doanh thu"
                  labelB="Giá vốn"
                />
                <div className="mt-4">
                  <TableWrap>
                    <thead><tr><th className={thCls}>Mã</th><th className={thCls}>Ngày</th><th className={thCls}>Khách hàng</th><th className={`${thCls} text-right`}>Doanh thu</th><th className={`${thCls} text-right`}>Giá vốn</th><th className={`${thCls} text-right`}>Lợi nhuận</th><th className={`${thCls} text-right`}>Biên</th></tr></thead>
                    <tbody>
                      {d.orderAnalysis.map((o) => (
                        <tr key={o.code} className="border-t border-slate-100">
                          <td className={`${tdCls} font-mono text-xs`}>{o.code}</td>
                          <td className={tdCls}>{formatDate(o.date)}</td>
                          <td className={tdCls}>{o.customer}</td>
                          <td className={`${tdCls} text-right`}>{formatVND(o.revenue)}</td>
                          <td className={`${tdCls} text-right`}>{formatVND(o.cogs)}</td>
                          <td className={`${tdCls} text-right font-medium`}>{formatVND(o.profit)}</td>
                          <td className={`${tdCls} text-right`}>{o.revenue > 0 ? `${Math.round((o.profit / o.revenue) * 100)}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

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
