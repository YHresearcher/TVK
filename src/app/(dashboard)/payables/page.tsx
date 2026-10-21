import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { createSettlementAction, recordPayablePaymentAction } from "@/lib/actions";
import { listPayables, listSettlements, listSuppliers } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PayablesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [payables, settlements, suppliers] = await Promise.all([
    listPayables(),
    listSettlements(),
    listSuppliers(),
  ]);
  const configured = payables.configured;
  const supplierName = new Map(suppliers.data.map((s) => [s.id, s.name]));
  const open = payables.data.filter((p) => p.status === "UNPAID" || p.status === "PARTIAL");
  const totalOutstanding = open.reduce((a, p) => a + Number(p.amount) - Number(p.amount_paid), 0);
  const supplierSettlements = settlements.data.filter((s) => s.party_kind === "SUPPLIER");

  return (
    <>
      <PageHeader title="Payables — Suppliers" description="A payable is created automatically when a consigned batch is sold, at that batch's agreed consignment price. Discounts given to customers never change these amounts." />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</p>}
      <p className="mb-4 text-sm text-slate-600">Total outstanding: <strong>{formatVND(totalOutstanding)}</strong></p>

      {payables.data.length === 0 ? <EmptyState message="No payables yet. Sell a consigned batch to create one." /> : (
        <TableWrap>
          <thead><tr><th className={thCls}>Supplier</th><th className={thCls}>Qty</th><th className={thCls}>Consignment price</th><th className={thCls}>Amount</th><th className={thCls}>Paid</th><th className={thCls}>Outstanding</th><th className={thCls}>Due</th><th className={thCls}>Status</th></tr></thead>
          <tbody>
            {payables.data.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className={tdCls}>{supplierName.get(p.supplier_id) ?? "—"}</td>
                <td className={tdCls}>{formatNumber(p.qty)}</td>
                <td className={tdCls}>{formatVND(p.unit_price)}</td>
                <td className={tdCls}>{formatVND(p.amount)}</td>
                <td className={tdCls}>{formatVND(p.amount_paid)}</td>
                <td className={`${tdCls} font-medium`}>{formatVND(Number(p.amount) - Number(p.amount_paid))}</td>
                <td className={tdCls}>{formatDate(p.due_date)}</td>
                <td className={tdCls}><StatusBadge status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Record a payment to a supplier (PC)">
          <form action={recordPayablePaymentAction} className="space-y-3">
            <div><label className={labelCls}>Open payable *</label>
              <select name="payable_id" required className={inputCls}>
                <option value="">— Select —</option>
                {open.map((p) => (
                  <option key={p.id} value={p.id}>
                    {supplierName.get(p.supplier_id)} — outstanding {formatVND(Number(p.amount) - Number(p.amount_paid))}
                  </option>
                ))}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Amount *</label><input name="amount" type="number" step="1000" required className={inputCls} /></div>
              <div><label className={labelCls}>Method</label>
                <select name="method" className={inputCls}><option value="BANK">Bank transfer</option><option value="CASH">Cash</option></select></div>
            </div>
            <div><label className={labelCls}>Payment date</label><input name="payment_date" type="date" className={inputCls} /></div>
            <button type="submit" className={`${btnCls} w-full`}>Record payment</button>
          </form>
        </Card>

        <Card title="Create a settlement batch (DS) for one supplier">
          <form action={createSettlementAction} className="space-y-3">
            <input type="hidden" name="party_kind" value="SUPPLIER" />
            <div><label className={labelCls}>Supplier *</label>
              <select name="supplier_id" required className={inputCls}>
                <option value="">— Select —</option>
                {suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Period from</label><input name="period_from" type="date" className={inputCls} /></div>
              <div><label className={labelCls}>Period to</label><input name="period_to" type="date" className={inputCls} /></div>
            </div>
            <div className="space-y-1">
              <p className={labelCls}>Open payables to include (of the supplier above)</p>
              {open.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="payable_id" value={p.id} className="h-4 w-4" />
                  {supplierName.get(p.supplier_id)} — {formatVND(Number(p.amount) - Number(p.amount_paid))} outstanding, due {formatDate(p.due_date)}
                </label>
              ))}
            </div>
            <button type="submit" className={`${btnCls} w-full`}>Create settlement</button>
          </form>
        </Card>
      </div>

      {supplierSettlements.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Settlements</h2>
          <TableWrap>
            <thead><tr><th className={thCls}>Code</th><th className={thCls}>Supplier</th><th className={thCls}>Period</th><th className={thCls}>Total</th><th className={thCls}>Status</th></tr></thead>
            <tbody>
              {supplierSettlements.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className={`${tdCls} font-mono text-xs`}>{s.doc_code}</td>
                  <td className={tdCls}>{supplierName.get(s.supplier_id) ?? "—"}</td>
                  <td className={tdCls}>{formatDate(s.period_from)} → {formatDate(s.period_to)}</td>
                  <td className={tdCls}>{formatVND(s.total_amount)}</td>
                  <td className={tdCls}><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}
    </>
  );
}
