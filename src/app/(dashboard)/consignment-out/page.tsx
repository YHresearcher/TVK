import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import ItemsRows from "@/components/ItemsRows";
import { confirmConsignmentOutAction, createConsignmentOutAction } from "@/lib/actions";
import { listBatchStock, listConsignmentOutSlips, listPartners } from "@/lib/queries";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ConsignmentOutPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [slips, partners, batchStock] = await Promise.all([
    listConsignmentOutSlips(),
    listPartners(),
    listBatchStock(),
  ]);
  const configured = slips.configured;
  const partnerName = new Map(partners.data.map((p) => [p.id, p.name]));
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
    label: `${r.batch_code} — ${r.product_name} (${r.ownership}${r.supplier_name ? " / " + r.supplier_name : ""})`,
  }));

  return (
    <>
      <PageHeader
        title="Consignment Out (GK)"
        description="Sending goods to a partner changes custody only — ownership stays ours, no revenue and no receivable until the partner reports consumption. Consigning a supplier's batch onward (cell D) is blocked unless that supplier allows it."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</p>}
      <div className="space-y-6">
        <Card title="New consignment-out / delivery slip">
          <form action={createConsignmentOutAction} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div><label className={labelCls}>Partner *</label>
                <select name="partner_id" required className={inputCls}><option value="">— Select —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div><label className={labelCls}>Slip date</label><input name="slip_date" type="date" className={inputCls} /></div>
              <div><label className={labelCls}>Settlement due</label><input name="settlement_due_date" type="date" className={inputCls} /></div>
              <div><label className={labelCls}>Return-by date</label><input name="return_by_date" type="date" className={inputCls} /></div>
            </div>
            <ItemsRows fields={[
              { name: "batch_id", label: "Batch (in our warehouse)", type: "select", options: batchOptions },
              { name: "qty", label: "Qty", type: "number" },
              { name: "term", label: "Term", type: "select", options: [
                { value: "CONSIGNMENT", label: "CONSIGNMENT — ký gửi" },
                { value: "PURCHASE", label: "PURCHASE — mua đứt, invoice later" },
              ] },
              { name: "transfer_price", label: "Transfer / agreed price (₫)", type: "number", step: "1000" },
            ]} initialRows={2} />
            <p className="text-xs text-slate-500">The source warehouse is resolved automatically from where the batch currently sits. The term decides the allocation cap later (e.g. max 5 PURCHASED / 10 CONSIGNED).</p>
            <button type="submit" className={btnCls}>Create draft slip</button>
          </form>
        </Card>

        {slips.data.length === 0 ? <EmptyState message="No slips yet." /> : (
          <TableWrap>
            <thead><tr><th className={thCls}>Code</th><th className={thCls}>Partner</th><th className={thCls}>Date</th><th className={thCls}>Settlement due</th><th className={thCls}>Status</th><th className={thCls}></th></tr></thead>
            <tbody>
              {slips.data.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className={`${tdCls} font-mono text-xs`}>{s.doc_code}</td>
                  <td className={tdCls}>{partnerName.get(s.partner_id) ?? "—"}</td>
                  <td className={tdCls}>{formatDate(s.slip_date)}</td>
                  <td className={tdCls}>{formatDate(s.settlement_due_date)}</td>
                  <td className={tdCls}><StatusBadge status={s.status} /></td>
                  <td className={tdCls}>
                    {s.status === "DRAFT" && (
                      <form action={confirmConsignmentOutAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className={btnGhostCls}>Confirm → move stock to partner</button>
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
