import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import ItemsRows from "@/components/ItemsRows";
import { createCounterSaleAction } from "@/lib/actions";
import { listBatchStock, listPartners, listSalesDocuments, listSalesOrders } from "@/lib/queries";
import { formatDate, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [orders, documents, partners, batchStock] = await Promise.all([
    listSalesOrders(),
    listSalesDocuments(),
    listPartners(),
    listBatchStock(),
  ]);
  const configured = orders.configured;
  const partnerOptions = partners.data.map((p) => ({ value: p.id, label: p.name }));
  const ownBatches = Array.from(
    new Map(
      batchStock.data
        .filter((r) => r.location_kind === "OWN_WAREHOUSE")
        .map((r) => [r.batch_id, r])
    ).values()
  );
  const batchOptions = ownBatches.map((r) => ({
    value: r.batch_id,
    label: `${r.batch_code} — ${r.product_name} · ${r.ownership} · at ${r.location_name}`,
  }));

  return (
    <>
      <PageHeader
        title="Sales (counter)"
        description="Pick the exact batches being sold. Owned batches go to a BH document; consigned batches go to a KG document and automatically create a payable to that batch's supplier at the lot's consignment price. Discount applies to the BH part only."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Sale completed — documents confirmed, stock and payables updated.</p>}
      <div className="space-y-6">
        <Card title="New counter sale">
          <form action={createCounterSaleAction} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div><label className={labelCls}>Partner (optional)</label>
                <select name="partner_id" className={inputCls}><option value="">— Walk-in customer —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div><label className={labelCls}>Customer name</label><input name="customer_name" className={inputCls} /></div>
              <div><label className={labelCls}>Discount on BH part (₫)</label><input name="discount_amount" type="number" step="1000" defaultValue="0" className={inputCls} /></div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="is_credit" className="h-4 w-4" /> On credit (create receivable)
                </label>
              </div>
            </div>
            <ItemsRows fields={[
              { name: "batch_id", label: "Batch", type: "select", options: batchOptions },
              { name: "qty", label: "Qty", type: "number" },
              { name: "unit_price", label: "Unit price (₫)", type: "number", step: "1000" },
            ]} initialRows={2} />
            <button type="submit" className={btnCls}>Complete sale</button>
          </form>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Recent orders</h2>
            {orders.data.length === 0 ? <EmptyState message="No orders yet." /> : (
              <TableWrap>
                <thead><tr><th className={thCls}>Code</th><th className={thCls}>Date</th><th className={thCls}>Total</th><th className={thCls}>Status</th></tr></thead>
                <tbody>
                  {orders.data.slice(0, 20).map((o) => (
                    <tr key={o.id} className="border-t border-slate-100">
                      <td className={`${tdCls} font-mono text-xs`}>{o.doc_code}</td>
                      <td className={tdCls}>{formatDate(o.order_date)}</td>
                      <td className={tdCls}>{formatVND(o.total_amount)}</td>
                      <td className={tdCls}><StatusBadge status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </div>
          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Management documents (BH / KG)</h2>
            {documents.data.length === 0 ? <EmptyState message="No documents yet." /> : (
              <TableWrap>
                <thead><tr><th className={thCls}>Code</th><th className={thCls}>Type</th><th className={thCls}>Date</th><th className={thCls}>Total</th><th className={thCls}>Status</th></tr></thead>
                <tbody>
                  {documents.data.slice(0, 20).map((d) => (
                    <tr key={d.id} className="border-t border-slate-100">
                      <td className={`${tdCls} font-mono text-xs`}>{d.doc_code}</td>
                      <td className={tdCls}>{d.doc_kind}</td>
                      <td className={tdCls}>{formatDate(d.doc_date)}</td>
                      <td className={tdCls}>{formatVND(d.total_amount)}</td>
                      <td className={tdCls}><StatusBadge status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
