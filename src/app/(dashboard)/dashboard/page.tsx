import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, tdCls, thCls } from "@/components/ui";
import { getDashboard } from "@/lib/queries";
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
  const d = await getDashboard();
  if (!d.configured) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <NotConfigured />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Owned stock and consigned stock are always tracked separately."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Owned stock (qty)" value={formatNumber(d.ownedQty)} sub={formatVND(d.ownedValue) + " capital in stock"} />
        <StatCard label="Consigned stock (qty)" value={formatNumber(d.consignedQty)} sub={formatVND(d.consignedValue) + " held for suppliers"} />
        <StatCard label="Stock at partners (qty)" value={formatNumber(d.atPartnersQty)} sub="Consigned out / delivered, not yet consumed" />
        <StatCard label="Payables outstanding" value={formatVND(d.payablesOutstanding)} sub="Owed to suppliers for consigned goods sold" />
        <StatCard label="Receivables outstanding" value={formatVND(d.receivablesOutstanding)} sub="Partners owe us" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Low stock (at or below minimum)">
          {d.lowStock.length === 0 ? (
            <EmptyState message="No low-stock products." />
          ) : (
            <TableWrap>
              <thead><tr><th className={thCls}>SKU</th><th className={thCls}>Product</th><th className={thCls}>Total qty</th></tr></thead>
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

        <Card title="Consigned batches to return within 30 days">
          {d.expiring.length === 0 ? (
            <EmptyState message="Nothing expiring soon." />
          ) : (
            <TableWrap>
              <thead><tr><th className={thCls}>Batch</th><th className={thCls}>Product</th><th className={thCls}>Supplier</th><th className={thCls}>Qty</th><th className={thCls}>Return by</th></tr></thead>
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
          <Card title="Partner consignment discrepancies (sent ≠ consumed + returned + still held)">
            <TableWrap>
              <thead><tr><th className={thCls}>Partner</th><th className={thCls}>Sent</th><th className={thCls}>Consumed</th><th className={thCls}>Returned</th><th className={thCls}>Still held</th></tr></thead>
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
