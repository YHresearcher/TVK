import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { createStockAdjustmentAction } from "@/lib/actions";
import { listBatchStock, listLocations } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: { ownership?: string; location_kind?: string; ok?: string };
}) {
  const [stock, locations] = await Promise.all([listBatchStock(), listLocations()]);
  const configured = stock.configured;
  let rows = stock.data;
  if (searchParams.ownership) rows = rows.filter((r) => r.ownership === searchParams.ownership);
  if (searchParams.location_kind) rows = rows.filter((r) => r.location_kind === searchParams.location_kind);
  const totalQty = rows.reduce((a, r) => a + Number(r.qty), 0);
  const totalValue = rows.reduce((a, r) => a + Number(r.qty) * Number(r.unit_cost), 0);

  const batchOptions = Array.from(new Map(stock.data.map((r) => [r.batch_id, r])).values()).map((r) => ({
    value: r.batch_id,
    label: `${r.batch_code} — ${r.product_name}`,
  }));
  const locationOptions = locations.data.map((l) => ({ value: l.id, label: l.name }));

  return (
    <>
      <PageHeader title="Inventory by batch" description="Stock is never edited directly — every change goes through the movement ledger. Adjustments below also write ledger entries." />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</p>}
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <select name="ownership" defaultValue={searchParams.ownership ?? ""} className={`${inputCls} w-auto`}>
          <option value="">All ownership</option>
          <option value="OWNED">Owned (OWN)</option>
          <option value="CONSIGNED">Consigned (CONS)</option>
        </select>
        <select name="location_kind" defaultValue={searchParams.location_kind ?? ""} className={`${inputCls} w-auto`}>
          <option value="">All locations</option>
          <option value="OWN_WAREHOUSE">Our warehouses</option>
          <option value="PARTNER_VIRTUAL">Partner warehouses</option>
        </select>
        <button className={btnCls} type="submit">Filter</button>
      </form>

      <p className="mb-3 text-sm text-slate-600">
        Showing <strong>{formatNumber(totalQty)}</strong> units · stock value <strong>{formatVND(totalValue)}</strong>
        <span className="text-slate-400"> (consigned value is goods held for suppliers, not our capital)</span>
      </p>

      {rows.length === 0 ? <EmptyState message="No stock rows match." /> : (
        <TableWrap>
          <thead><tr><th className={thCls}>Batch</th><th className={thCls}>Product</th><th className={thCls}>Ownership</th><th className={thCls}>Supplier</th><th className={thCls}>Location</th><th className={thCls}>Qty</th><th className={thCls}>Unit cost</th><th className={thCls}>Received</th><th className={thCls}>Status</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className={`${tdCls} font-mono text-xs`}>{r.batch_code}</td>
                <td className={tdCls}>{r.product_name}</td>
                <td className={tdCls}>{r.ownership}</td>
                <td className={tdCls}>{r.supplier_name ?? "—"}</td>
                <td className={tdCls}>{r.location_name}</td>
                <td className={`${tdCls} font-medium`}>{formatNumber(r.qty)}</td>
                <td className={tdCls}>{formatVND(r.unit_cost)}</td>
                <td className={tdCls}>{formatDate(r.received_date)}</td>
                <td className={tdCls}><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <div className="mt-6 max-w-xl">
        <Card title="Stocktake adjustment (writes a ledger entry)">
          <form action={createStockAdjustmentAction} className="space-y-3">
            <div>
              <label className={labelCls}>Batch *</label>
              <select name="batch_id" required className={inputCls}>
                <option value="">— Select —</option>
                {batchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Location *</label>
              <select name="location_id" required className={inputCls}>
                <option value="">— Select —</option>
                {locationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Quantity delta (+ increase / − decrease) *</label>
              <input name="qty_delta" type="number" required className={inputCls} placeholder="e.g. -2" />
            </div>
            <div>
              <label className={labelCls}>Reason / note</label>
              <input name="note" className={inputCls} placeholder="Stocktake 30/10, shelf B2…" />
            </div>
            <button type="submit" className={`${btnCls} w-full`}>Record adjustment</button>
          </form>
        </Card>
      </div>
    </>
  );
}
