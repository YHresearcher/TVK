import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { cancelVatInvoiceAction, createVatInvoiceAction } from "@/lib/actions";
import { listPartners, listUninvoicedLines, listVatInvoices } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [invoices, uninvoiced, partners] = await Promise.all([
    listVatInvoices(),
    listUninvoicedLines(),
    listPartners(),
  ]);
  const configured = invoices.configured;
  const partnerName = new Map(partners.data.map((p) => [p.id, p.name]));
  const partnerOptions = partners.data.map((p) => ({ value: p.id, label: p.name }));

  return (
    <>
      <PageHeader
        title="VAT Invoices (GTGT)"
        description="The legal invoice layer. It is generated from confirmed BH/KG document lines — each line can be invoiced exactly once, and every line on the invoice stays linked to its management document, so consigned and direct-sale money never mix. Depending on the accountant's decision (Settings: VAT invoice mode), the same lines can go on one combined invoice (one line per nature) or separate invoices."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Invoice created.</p>}
      <div className="space-y-6">
        <Card title="Issue a VAT invoice from document lines">
          {uninvoiced.data.length === 0 ? (
            <EmptyState message="No uninvoiced document lines. Confirm sales documents or allocation documents first." />
          ) : (
            <form action={createVatInvoiceAction} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <div><label className={labelCls}>Partner</label>
                  <select name="partner_id" className={inputCls}><option value="">— Select —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Invoice no. *</label><input name="invoice_no" required className={inputCls} /></div>
                <div><label className={labelCls}>Symbol *</label><input name="symbol" required className={inputCls} placeholder="1C25T…" /></div>
                <div><label className={labelCls}>Invoice date *</label><input name="invoice_date" type="date" required className={inputCls} /></div>
                <div><label className={labelCls}>E-invoice provider</label><input name="provider" className={inputCls} placeholder="MISA / Viettel…" /></div>
              </div>
              <div className="space-y-2">
                <p className={labelCls}>Document lines to include (each line can be invoiced only once)</p>
                {uninvoiced.data.map((l) => (
                  <label key={l.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                    <input type="checkbox" name="line_id" value={l.id} className="h-4 w-4" />
                    <span className="font-mono text-xs">{l.document?.doc_code}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{l.document?.doc_kind}</span>
                    <span>{l.products?.sku} — {l.products?.name}</span>
                    <span className="ml-auto">{formatNumber(l.qty)} × {formatVND(l.unit_price)} = <strong>{formatVND(Number(l.qty) * Number(l.unit_price))}</strong></span>
                  </label>
                ))}
              </div>
              <button type="submit" className={btnCls}>Issue invoice</button>
            </form>
          )}
        </Card>

        {invoices.data.length === 0 ? <EmptyState message="No VAT invoices yet." /> : (
          <TableWrap>
            <thead><tr><th className={thCls}>Invoice no.</th><th className={thCls}>Symbol</th><th className={thCls}>Partner</th><th className={thCls}>Date</th><th className={thCls}>Total</th><th className={thCls}>Status</th><th className={thCls}></th></tr></thead>
            <tbody>
              {invoices.data.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className={`${tdCls} font-mono text-xs`}>{inv.invoice_no}</td>
                  <td className={tdCls}>{inv.symbol}</td>
                  <td className={tdCls}>{inv.partner_id ? partnerName.get(inv.partner_id) ?? "—" : "—"}</td>
                  <td className={tdCls}>{formatDate(inv.invoice_date)}</td>
                  <td className={tdCls}>{formatVND(inv.total_amount)}</td>
                  <td className={tdCls}><StatusBadge status={inv.status} /></td>
                  <td className={tdCls}>
                    {inv.status === "ISSUED" && (
                      <form action={cancelVatInvoiceAction}>
                        <input type="hidden" name="id" value={inv.id} />
                        <button type="submit" className={btnGhostCls}>Cancel invoice</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <p className="text-xs text-slate-500">Cancelling an invoice re-opens only the allocation lines that belonged to that invoice — other invoices are untouched.</p>
      </div>
    </>
  );
}
