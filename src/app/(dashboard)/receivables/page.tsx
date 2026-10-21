import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { createSettlementAction, recordReceivablePaymentAction } from "@/lib/actions";
import { listPartners, listReceivables, listSettlements } from "@/lib/queries";
import { formatDate, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [receivables, settlements, partners] = await Promise.all([
    listReceivables(),
    listSettlements(),
    listPartners(),
  ]);
  const configured = receivables.configured;
  const partnerName = new Map(partners.data.map((p) => [p.id, p.name]));
  const open = receivables.data.filter((r) => r.status === "UNPAID" || r.status === "PARTIAL");
  const totalOutstanding = open.reduce((a, r) => a + Number(r.amount) - Number(r.amount_paid), 0);
  const partnerSettlements = settlements.data.filter((s) => s.party_kind === "PARTNER");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Receivables — Partners" description="Created automatically when a credit sale or a partner-consumption document (BH/KG) is confirmed. BH amounts are after discount; KG amounts use the agreed transfer price." />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</p>}
      <p className="mb-4 text-sm text-slate-600">Total outstanding: <strong>{formatVND(totalOutstanding)}</strong></p>

      {receivables.data.length === 0 ? <EmptyState message="No receivables yet." /> : (
        <TableWrap>
          <thead><tr><th className={thCls}>Partner</th><th className={thCls}>Amount</th><th className={thCls}>Paid</th><th className={thCls}>Outstanding</th><th className={thCls}>Due</th><th className={thCls}>Status</th></tr></thead>
          <tbody>
            {receivables.data.map((r) => {
              const overdue = r.due_date && r.due_date < today && (r.status === "UNPAID" || r.status === "PARTIAL");
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className={tdCls}>{partnerName.get(r.partner_id) ?? "—"}</td>
                  <td className={tdCls}>{formatVND(r.amount)}</td>
                  <td className={tdCls}>{formatVND(r.amount_paid)}</td>
                  <td className={`${tdCls} font-medium`}>{formatVND(Number(r.amount) - Number(r.amount_paid))}</td>
                  <td className={`${tdCls} ${overdue ? "font-semibold text-red-600" : ""}`}>{formatDate(r.due_date)}{overdue ? " (overdue)" : ""}</td>
                  <td className={tdCls}><StatusBadge status={r.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Record money received from a partner (PT)">
          <form action={recordReceivablePaymentAction} className="space-y-3">
            <div><label className={labelCls}>Open receivable *</label>
              <select name="receivable_id" required className={inputCls}>
                <option value="">— Select —</option>
                {open.map((r) => (
                  <option key={r.id} value={r.id}>
                    {partnerName.get(r.partner_id)} — outstanding {formatVND(Number(r.amount) - Number(r.amount_paid))}
                  </option>
                ))}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Amount *</label><input name="amount" type="number" step="1000" required className={inputCls} /></div>
              <div><label className={labelCls}>Method</label>
                <select name="method" className={inputCls}><option value="BANK">Bank transfer</option><option value="CASH">Cash</option></select></div>
            </div>
            <div><label className={labelCls}>Payment date</label><input name="payment_date" type="date" className={inputCls} /></div>
            <button type="submit" className={`${btnCls} w-full`}>Record receipt</button>
          </form>
        </Card>

        <Card title="Create a settlement batch (DS) for one partner">
          <form action={createSettlementAction} className="space-y-3">
            <input type="hidden" name="party_kind" value="PARTNER" />
            <div><label className={labelCls}>Partner *</label>
              <select name="partner_id" required className={inputCls}>
                <option value="">— Select —</option>
                {partners.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Period from</label><input name="period_from" type="date" className={inputCls} /></div>
              <div><label className={labelCls}>Period to</label><input name="period_to" type="date" className={inputCls} /></div>
            </div>
            <div className="space-y-1">
              <p className={labelCls}>Open receivables to include (of the partner above)</p>
              {open.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="receivable_id" value={r.id} className="h-4 w-4" />
                  {partnerName.get(r.partner_id)} — {formatVND(Number(r.amount) - Number(r.amount_paid))} outstanding, due {formatDate(r.due_date)}
                </label>
              ))}
            </div>
            <button type="submit" className={`${btnCls} w-full`}>Create settlement</button>
          </form>
        </Card>
      </div>

      {partnerSettlements.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Settlements</h2>
          <TableWrap>
            <thead><tr><th className={thCls}>Code</th><th className={thCls}>Partner</th><th className={thCls}>Period</th><th className={thCls}>Total</th><th className={thCls}>Status</th></tr></thead>
            <tbody>
              {partnerSettlements.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className={`${tdCls} font-mono text-xs`}>{s.doc_code}</td>
                  <td className={tdCls}>{partnerName.get(s.partner_id) ?? "—"}</td>
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
