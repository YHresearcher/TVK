import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import ItemsRows from "@/components/ItemsRows";
import {
  createAllocationAction,
  createConsumptionReportAction,
  setConsumptionReportStatusAction,
} from "@/lib/actions";
import { listAllocations, listBatchStock, listConsumptionReports, listPartners, listProducts } from "@/lib/queries";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PartnerConsumptionPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [reports, allocations, partners, products, batchStock] = await Promise.all([
    listConsumptionReports(),
    listAllocations(),
    listPartners(),
    listProducts(),
    listBatchStock(),
  ]);
  const configured = reports.configured;
  const partnerName = new Map(partners.data.map((p) => [p.id, p.name]));
  const partnerOptions = partners.data.map((p) => ({ value: p.id, label: p.name }));
  const productOptions = products.data.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }));
  const reportOptions = reports.data.map((r) => ({
    value: r.id,
    label: `${r.doc_code} — ${partnerName.get(r.partner_id) ?? ""} (${formatDate(r.period_from)} → ${formatDate(r.period_to)})`,
  }));
  const partnerBatches = Array.from(
    new Map(
      batchStock.data
        .filter((r) => r.location_kind === "PARTNER_VIRTUAL")
        .map((r) => [r.batch_id, r])
    ).values()
  );
  const batchOptions = partnerBatches.map((r) => ({
    value: r.batch_id,
    label: `${r.batch_code} — ${r.product_name} · at ${r.location_name}`,
  }));

  return (
    <>
      <PageHeader
        title="Partner Consumption & Allocation"
        description="Flow: partner reports consumption (BT) → allocation slip pins every quantity to a source — PURCHASED or CONSIGNED (PB) → BH/KG documents → VAT invoice. Allocation happens BEFORE invoicing, and each quantity can be invoiced exactly once."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</p>}
      <div className="space-y-8">
        <section className="space-y-4">
          <Card title="New consumption report (BT)">
            <form action={createConsumptionReportAction} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div><label className={labelCls}>Partner *</label>
                  <select name="partner_id" required className={inputCls}><option value="">— Select —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Period from *</label><input name="period_from" type="date" required className={inputCls} /></div>
                <div><label className={labelCls}>Period to *</label><input name="period_to" type="date" required className={inputCls} /></div>
              </div>
              <ItemsRows fields={[
                { name: "product_id", label: "Product", type: "select", options: productOptions },
                { name: "qty_consumed", label: "Qty consumed", type: "number" },
              ]} initialRows={2} />
              <button type="submit" className={btnCls}>Create draft report</button>
            </form>
          </Card>
          {reports.data.length === 0 ? <EmptyState message="No consumption reports yet." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Code</th><th className={thCls}>Partner</th><th className={thCls}>Period</th><th className={thCls}>Status</th><th className={thCls}></th></tr></thead>
              <tbody>
                {reports.data.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className={`${tdCls} font-mono text-xs`}>{r.doc_code}</td>
                    <td className={tdCls}>{partnerName.get(r.partner_id) ?? "—"}</td>
                    <td className={tdCls}>{formatDate(r.period_from)} → {formatDate(r.period_to)}</td>
                    <td className={tdCls}><StatusBadge status={r.status} /></td>
                    <td className={tdCls}>
                      {r.status === "DRAFT" && (
                        <form action={setConsumptionReportStatusAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="status" value="CONFIRMED" />
                          <button type="submit" className={btnGhostCls}>Confirm report</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </section>

        <section className="space-y-4">
          <Card title="New allocation slip (PB)">
            <form action={createAllocationAction} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div><label className={labelCls}>Partner *</label>
                  <select name="partner_id" required className={inputCls}><option value="">— Select —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Consumption report (optional)</label>
                  <select name="report_id" className={inputCls}><option value="">— None —</option>{reportOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              </div>
              <ItemsRows fields={[
                { name: "product_id", label: "Product", type: "select", options: productOptions },
                { name: "batch_id", label: "Batch at partner", type: "select", options: batchOptions },
                { name: "nature", label: "Source nature", type: "select", options: [
                  { value: "PURCHASED", label: "PURCHASED — mua đứt" },
                  { value: "CONSIGNED", label: "CONSIGNED — ký gửi" },
                ] },
                { name: "qty", label: "Qty", type: "number" },
                { name: "unit_price", label: "Unit price (₫)", type: "number", step: "1000" },
              ]} initialRows={2} />
              <p className="text-xs text-slate-500">On confirm, the database checks 3 locks: not more than reported consumption, not more than the delivered cap per nature, and the batch must still hold enough at the partner.</p>
              <button type="submit" className={btnCls}>Create draft allocation</button>
            </form>
          </Card>
          {allocations.data.length === 0 ? <EmptyState message="No allocation slips yet." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Code</th><th className={thCls}>Partner</th><th className={thCls}>Date</th><th className={thCls}>Status</th><th className={thCls}></th></tr></thead>
              <tbody>
                {allocations.data.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className={`${tdCls} font-mono text-xs`}>{a.doc_code}</td>
                    <td className={tdCls}>{partnerName.get(a.partner_id) ?? "—"}</td>
                    <td className={tdCls}>{formatDate(a.alloc_date)}</td>
                    <td className={tdCls}><StatusBadge status={a.status} /></td>
                    <td className={tdCls}>
                      <Link href={`/partner-consumption/allocations/${a.id}`} className="text-blue-600 hover:underline text-sm">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </section>
      </div>
    </>
  );
}
