import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, tdCls, thCls } from "@/components/ui";
import { BarChart, GroupedBarChart, HBarList } from "@/components/Charts";
import PartnerStatsDialog from "@/components/PartnerStatsDialog";
import StockCompositionCard from "@/components/StockCompositionCard";
import {
  getCurrentProfile,
  getDashboard,
  getGroupPerformance,
  getSlowMoving,
  listLedgerMovements,
  listPartnerStats,
} from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
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

function LayerHeading({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-slate-900">
        {n} · {title}
      </h2>
      <p className="text-sm text-slate-500">{desc}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const [d, profile, partnerStats, groupPerf, slow, recent] = await Promise.all([
    getDashboard(),
    getCurrentProfile(),
    listPartnerStats(),
    getGroupPerformance(),
    getSlowMoving(90),
    listLedgerMovements(8),
  ]);
  const canSeeMoney = ["OWNER", "ACCOUNTING", "CEO"].includes(profile.data?.role ?? "");
  // Giá vốn / lợi nhuận chỉ Chủ cửa hàng và Kế toán được coi — CEO chỉ coi
  // giá trị thật, nhân viên bán hàng/kho không thấy giá vốn và lợi nhuận.
  const canSeeCost = ["OWNER", "ACCOUNTING"].includes(profile.data?.role ?? "");
  const grossMargin = d.revenueAll > 0 ? Math.round((d.grossProfitAll / d.revenueAll) * 100) : 0;
  const revenue14Total = d.revenue14.reduce((a, r) => a + r.value, 0);
  const cogsAll = d.revenueAll - d.grossProfitAll;
  // Gross Margin: lãi gộp trên doanh thu thuần. Markup on Cost: lãi gộp
  // trên giá vốn hàng đã bán. Chỉ đổi tên gọi, cách tính giữ nguyên.
  const roiAll = cogsAll > 0 ? Math.round((d.grossProfitAll / cogsAll) * 100) : 0;
  // Tỷ trọng vốn theo vị trí trên tổng hàng TVK sở hữu (giá vốn).
  const bookShare = (v: number) =>
    d.bookInventoryValue > 0
      ? `${((v / d.bookInventoryValue) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}% tổng hàng sở hữu`
      : "—";
  if (!d.configured) {
    return (
      <>
        <PageHeader title="Tổng quan" />
        <NotConfigured />
      </>
    );
  }
  const ownedRealValue = d.ownedValue + d.atPartnersValue;

  const role = profile.data?.role ?? "";

  // Tầng 1 — Tổng quan điều hành: 5 giây nắm tình hình. Lợi nhuận gộp chỉ
  // Chủ cửa hàng và Kế toán thấy; CEO thấy doanh thu, công nợ và giá trị
  // hàng sở hữu theo giá trị thật.
  const layer1 = (
    <section>
      <LayerHeading n={1} title="Tổng quan điều hành" desc="Doanh thu, lợi nhuận, công nợ và giá trị hàng sở hữu." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Doanh thu thuần (lũy kế)" value={formatVND(d.revenueAll)} sub={`${formatNumber(d.orderCountAll)} đơn đã xác nhận`} tone="blue" />
        {canSeeCost && (
          <StatCard label="Lợi nhuận gộp (lũy kế)" value={formatVND(d.grossProfitAll)} sub={`Gross Margin ${grossMargin}% · Markup on Cost ${roiAll}%`} tone="emerald" />
        )}
        <StatCard label="Phải thu còn nợ" value={formatVND(d.receivablesOutstanding)} sub="Đối tác đang nợ TVK" tone="violet" />
        <StatCard label="Phải trả còn nợ" value={formatVND(d.payablesOutstanding)} sub="Nợ nhà cung cấp cho hàng ký gửi đã bán" tone="rose" />
        <StatCard label="Giá trị hàng sở hữu" value={formatVND(ownedRealValue)} sub="Theo giá bán / giá chuyển giao" tone="sky" />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Doanh thu thuần tính theo tổng chứng từ đã xác nhận, chưa tách thuế GTGT.
      </p>
    </section>
  );

  // Tầng 2 — Hàng hoá và quyền sở hữu: của mình, giữ hộ, gửi đối tác.
  const layer2 = (
    <section className="mt-10">
      <LayerHeading n={2} title="Hàng hoá và quyền sở hữu" desc="Hàng của mình, hàng nhận ký gửi và hàng đang gửi ở đối tác — tách biệt theo từng lô." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Tồn kho (số lượng)" value={`${formatNumber(d.ownedQty)} đơn vị`} sub={`${formatVND(d.ownedValue)} theo giá bán · ${formatNumber(d.ownedLotCount)} lô`} tone="emerald" />
        <StatCard label="Hàng nhận ký gửi (số lượng)" value={`${formatNumber(d.consignedQty)} đơn vị`} sub={`${formatVND(d.consignedValue)} đang giữ hộ nhà cung cấp · ${formatNumber(d.consignedLotCount)} lô`} tone="amber" />
        <StatCard label="Hàng TVK tại đối tác" value={`${formatNumber(d.atPartnersQty)} đơn vị`} sub={`${formatVND(d.atPartnersValue)} theo giá chuyển giao · ${formatNumber(d.atPartnersLotCount)} lô`} tone="sky" />
      </div>
      {canSeeCost && (
        <div className="mt-6">
          <Card title="Theo sổ kế toán (giá vốn)" tone="slate">
            <p className="mb-3 text-sm leading-relaxed text-slate-600">
              Tồn kho trên sổ ghi theo giá vốn, không theo giá bán. Hàng giữ hộ của nhà cung cấp không phải
              tài sản của cửa hàng nên không gộp vào tổng hàng tồn kho của TVK.
            </p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Tổng tiền hàng trong kho (giá vốn)" value={formatVND(d.bookOwnedOwnValue)} sub={bookShare(d.bookOwnedOwnValue)} />
              <StatCard label="Hàng của TVK ký gởi" value={formatVND(d.bookAtPartnersOwnedValue)} sub={bookShare(d.bookAtPartnersOwnedValue)} />
              <StatCard label="Tổng hàng tồn kho của TVK (kho + ký gởi)" value={formatVND(d.bookInventoryValue)} />
              <StatCard label="Hàng giữ hộ (không phải tài sản)" value={formatVND(d.bookConsignedCustodyValue)} sub="Chỉ theo dõi, không ghi vào tài sản" />
            </div>
          </Card>
        </div>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <StockCompositionCard
          rings={d.rings}
          tierValues={d.warehouseTierValues}
          ownedBookValue={d.bookInventoryValue}
          ownedQty={d.ownedQty + d.atPartnersQty}
          canSeeMoney={canSeeMoney}
          canSeeCost={canSeeCost}
        />
        {canSeeMoney && (
          <Card title="Hàng đã bán và đã gửi ký gởi" tone="amber" className="lg:col-span-2">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Đã bán" value={`${formatNumber(d.flows.soldQty)} đơn vị`} sub={`Doanh thu thuần ${formatVND(d.flows.soldRevenue)}`} />
              <StatCard label="Đã gửi ký gởi" value={`${formatNumber(d.flows.sentQty)} đơn vị`} sub={`Giá chuyển giao ${formatVND(d.flows.sentValue)}`} />
              <StatCard label="Đối tác đã tiêu thụ" value={`${formatNumber(d.flows.consumedQty)} đơn vị`} sub="Theo báo cáo tiêu thụ đã xác nhận" />
              <StatCard label="Còn ở đối tác" value={`${formatNumber(d.flows.stillQty)} đơn vị`} sub={`Giá chuyển giao ${formatVND(d.flows.stillValue)}`} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Chỉ tính chứng từ bán hàng (BH) và phiếu gửi ký gởi (GK) đã xác nhận. Hàng còn ở đối tác
              tính theo giá chuyển giao mới nhất của từng lô.
            </p>
          </Card>
        )}
      </div>
      <div className="mt-6">
        <Card title="Thống kê đối tác" tone="sky">
          <p className="mb-4 text-sm text-slate-500">Chọn một đối tác để xem nhanh số dư, tiền đã trả, hoá đơn và hàng còn ở đối tác đó trong cửa sổ bật lên.</p>
          <PartnerStatsDialog partners={partnerStats} />
        </Card>
      </div>
    </section>
  );

  // Tầng 3 — Hiệu quả kinh doanh: doanh thu, lợi nhuận, nhóm hàng.
  const layer3 = (
    <section className="mt-10">
      <LayerHeading n={3} title="Hiệu quả kinh doanh" desc="Doanh thu, lợi nhuận và sức bán theo nhóm hàng." />
      <div className="grid gap-6 lg:grid-cols-3">
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
        <Card title="Doanh thu theo nhóm hàng" tone="emerald">
          {groupPerf.length === 0 ? (
            <EmptyState message="Chưa có doanh thu theo nhóm hàng." />
          ) : (
            <>
              <HBarList
                data={groupPerf.map((g) => ({ label: g.group, value: g.revenue, color: "#2563eb" }))}
              />
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Gồm cả bán thẳng (BH) và tiêu thụ ký gửi (KG) đã xác nhận.
              </p>
            </>
          )}
        </Card>
      </div>
      {canSeeCost && (
        <div className="mt-6">
          <Card title="Phân tích đơn hàng" tone="emerald">
            <p className="mb-2 text-base leading-relaxed text-slate-600">
              Doanh thu thuần <strong className="text-slate-900">{formatVND(d.revenueAll)}</strong>
              {" · "}Giá vốn <strong className="text-slate-900">{formatVND(cogsAll)}</strong>
              {" · "}Lợi nhuận gộp <strong className="text-slate-900">{formatVND(d.grossProfitAll)}</strong>
              {`(Gross Margin ${grossMargin}% · Markup on Cost ${roiAll}%)`}.
              Giá vốn tính theo lô thực tế đã xuất (nhập trước – xuất trước); giảm giá đã trừ vào doanh thu thuần.
              {" "}30 ngày gần nhất: doanh thu thuần {formatVND(d.revenue30)}, lợi nhuận {formatVND(d.grossProfit30)}, {formatNumber(d.orderCount30)} đơn.
            </p>
            <p className="text-xs leading-relaxed text-slate-500">Gross Margin là lãi gộp chia cho doanh thu thuần.</p>
            <p className="mb-3 text-xs leading-relaxed text-slate-500">Markup on Cost là lãi gộp chia cho giá vốn hàng đã bán.</p>
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
      <div className="mt-6">
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
    </section>
  );

  // Tầng 4 — Cảnh báo vận hành: tồn thấp, chậm luân chuyển, quá hạn.
  const layer4 = (
    <section className="mt-10">
      <LayerHeading n={4} title="Cảnh báo vận hành" desc="Tồn thấp, hàng chậm luân chuyển, công nợ quá hạn và chênh lệch ký gửi." />
      <div className="grid gap-6 lg:grid-cols-2">
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
        <Card title="Hàng chậm luân chuyển (90 ngày)" tone="amber">
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
            Sản phẩm còn tồn kho mà 90 ngày không có bút toán xuất, bán hay trả nào; hàng mới nhập trong 90 ngày không tính là chậm.
          </p>
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
    </section>
  );

  // Tầng 5 — Hoạt động gần đây: 8 bút toán kho mới nhất, xem đủ ở sổ cái.
  const layer5 = (
    <section className="mt-10">
      <LayerHeading n={5} title="Hoạt động gần đây" desc="Nhập, xuất, bán hàng, gửi ký gửi và điều chỉnh mới nhất trong sổ cái kho." />
      <Card>
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
            Xem sổ cái đầy đủ →
          </Link>
        </p>
      </Card>
    </section>
  );

  // Một trang duy nhất, thứ tự các TẦNG xếp theo vai trò: chủ/kế toán/CEO
  // thấy điều hành trước; bán hàng thấy hiệu quả trước; thủ kho thấy hàng
  // hoá và cảnh báo trước. Từng phần tự khóa theo quyền nên vai trò nào
  // cũng chỉ thấy phần mình được coi.
  return (
    <>
      <PageHeader
        title="Tổng quan"
        description="Tồn kho và hàng ký gửi luôn được theo dõi tách biệt."
      />
      {role === "SALES" ? (
        <>{layer1}{layer3}{layer2}{layer4}{layer5}</>
      ) : role === "WAREHOUSE" ? (
        <>{layer2}{layer4}{layer1}{layer3}{layer5}</>
      ) : (
        <>{layer1}{layer2}{layer3}{layer4}{layer5}</>
      )}
    </>
  );
}
