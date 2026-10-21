import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import ItemsRows from "@/components/ItemsRows";
import { confirmReturnAction, createReturnAction } from "@/lib/actions";
import { listBatchStock, listPartners, listReturnDocuments, listSuppliers } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { RETURN_KINDS, RETURN_REASONS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [docs, batchStock, partners, suppliers] = await Promise.all([
    listReturnDocuments(),
    listBatchStock(),
    listPartners(),
    listSuppliers(),
  ]);
  const configured = docs.configured;
  const partnerName = new Map(partners.data.map((p) => [p.id, p.name]));
  const supplierName = new Map(suppliers.data.map((s) => [s.id, s.name]));
  const partnerOptions = partners.data.map((p) => ({ value: p.id, label: p.name }));
  const supplierOptions = suppliers.data.map((s) => ({ value: s.id, label: s.name }));
  const allBatches = Array.from(new Map(batchStock.data.map((r) => [r.batch_id, r])).values());
  const batchOptions = allBatches.map((r) => ({
    value: r.batch_id,
    label: `${r.batch_code} — ${r.product_name} · ${r.ownership} · at ${r.location_name}`,
  }));

  return (
    <>
      <PageHeader
        title="Returns & Warranty (TH)"
        description="Returned goods always go back to their ORIGINAL batch, so the supplier and cost stay traceable. If a returned consigned batch was sold but its payable is still unpaid, Accounting cancels that payable; if already paid, it is credited in the next settlement."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</p>}
      <div className="space-y-6">
        <Card title="New return document">
          <form action={createReturnAction} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div><label className={labelCls}>Return type *</label>
                <select name="return_kind" required className={inputCls}>
                  {RETURN_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select></div>
              <div><label className={labelCls}>Partner (customer / partner returns)</label>
                <select name="partner_id" className={inputCls}><option value="">— Select —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div><label className={labelCls}>Supplier (supplier returns)</label>
                <select name="supplier_id" className={inputCls}><option value="">— Select —</option>{supplierOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
            </div>
            <ItemsRows fields={[
              { name: "batch_id", label: "Original batch", type: "select", options: batchOptions },
              { name: "qty", label: "Qty", type: "number" },
              { name: "reason", label: "Reason", type: "select", options: RETURN_REASONS.map((r) => ({ value: r, label: r })) },
            ]} initialRows={1} />
            <p className="text-xs text-slate-500">Locations are resolved automatically: customer returns land in our first warehouse, partner returns move from the partner virtual warehouse back to ours, supplier returns leave the system from our warehouse.</p>
            <button type="submit" className={btnCls}>Create draft return</button>
          </form>
        </Card>

        {docs.data.length === 0 ? <EmptyState message="No return documents yet." /> : (
          <TableWrap>
            <thead><tr><th className={thCls}>Code</th><th className={thCls}>Type</th><th className={thCls}>Party</th><th className={thCls}>Date</th><th className={thCls}>Status</th><th className={thCls}></th></tr></thead>
            <tbody>
              {docs.data.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className={`${tdCls} font-mono text-xs`}>{d.doc_code}</td>
                  <td className={tdCls}>{d.return_kind}</td>
                  <td className={tdCls}>{d.partner_id ? partnerName.get(d.partner_id) : d.supplier_id ? supplierName.get(d.supplier_id) : "—"}</td>
                  <td className={tdCls}>{formatDate(d.return_date)}</td>
                  <td className={tdCls}><StatusBadge status={d.status} /></td>
                  <td className={tdCls}>
                    {d.status === "DRAFT" && (
                      <form action={confirmReturnAction}>
                        <input type="hidden" name="id" value={d.id} />
                        <button type="submit" className={btnGhostCls}>Confirm → move stock</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </>
  );
}
