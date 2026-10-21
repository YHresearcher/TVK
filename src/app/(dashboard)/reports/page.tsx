import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, tdCls, thCls } from "@/components/ui";
import { listPartnerConsignment, listProductStock, listSupplierConsignment } from "@/lib/queries";
import { formatNumber, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const [suppliers, partners, stock] = await Promise.all([
    listSupplierConsignment(),
    listPartnerConsignment(),
    listProductStock(),
  ]);
  const configured = suppliers.configured;

  return (
    <>
      <PageHeader title="Reports" description="Reconciliation views straight from the database. CSV export links are at the top of each section." />
      {!configured && <NotConfigured />}
      <div className="space-y-8">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Supplier consignment reconciliation (received – sold – returned – on hand – outstanding)</h2>
            <a href="/api/export?view=v_supplier_consignment" className="text-sm text-blue-600 hover:underline">Export CSV</a>
          </div>
          {suppliers.data.length === 0 ? <EmptyState message="No data." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Supplier</th><th className={thCls}>Received</th><th className={thCls}>Sold</th><th className={thCls}>Returned</th><th className={thCls}>On hand (our wh)</th><th className={thCls}>Payable outstanding</th></tr></thead>
              <tbody>
                {suppliers.data.map((r) => (
                  <tr key={r.supplier_id} className="border-t border-slate-100">
                    <td className={tdCls}>{r.supplier_name}</td>
                    <td className={tdCls}>{formatNumber(r.qty_received)}</td>
                    <td className={tdCls}>{formatNumber(r.qty_sold)}</td>
                    <td className={tdCls}>{formatNumber(r.qty_returned)}</td>
                    <td className={tdCls}>{formatNumber(r.qty_on_hand_own_wh)}</td>
                    <td className={`${tdCls} font-medium`}>{formatVND(r.payable_outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Partner consignment reconciliation — control: sent = consumed + returned + still held</h2>
            <a href="/api/export?view=v_partner_consignment" className="text-sm text-blue-600 hover:underline">Export CSV</a>
          </div>
          {partners.data.length === 0 ? <EmptyState message="No data." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Partner</th><th className={thCls}>Sent</th><th className={thCls}>Consumed</th><th className={thCls}>Returned</th><th className={thCls}>Still held</th><th className={thCls}>Check</th><th className={thCls}>Receivable outstanding</th></tr></thead>
              <tbody>
                {partners.data.map((r) => {
                  const ok = Number(r.qty_sent) === Number(r.qty_consumed) + Number(r.qty_returned) + Number(r.qty_still_at_partner);
                  return (
                    <tr key={r.partner_id} className="border-t border-slate-100">
                      <td className={tdCls}>{r.partner_name}</td>
                      <td className={tdCls}>{formatNumber(r.qty_sent)}</td>
                      <td className={tdCls}>{formatNumber(r.qty_consumed)}</td>
                      <td className={tdCls}>{formatNumber(r.qty_returned)}</td>
                      <td className={tdCls}>{formatNumber(r.qty_still_at_partner)}</td>
                      <td className={`${tdCls} ${ok ? "text-green-600" : "font-semibold text-red-600"}`}>{ok ? "Balanced" : "MISMATCH"}</td>
                      <td className={`${tdCls} font-medium`}>{formatVND(r.receivable_outstanding)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Product stock summary (owned / consigned / at partners)</h2>
            <a href="/api/export?view=v_product_stock" className="text-sm text-blue-600 hover:underline">Export CSV</a>
          </div>
          {stock.data.length === 0 ? <EmptyState message="No data." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>SKU</th><th className={thCls}>Product</th><th className={thCls}>Owned @ ours</th><th className={thCls}>Consigned @ ours</th><th className={thCls}>Owned @ partners</th><th className={thCls}>Consigned @ partners</th><th className={thCls}>Total</th></tr></thead>
              <tbody>
                {stock.data.map((r) => (
                  <tr key={r.product_id} className="border-t border-slate-100">
                    <td className={tdCls}>{r.sku}</td>
                    <td className={tdCls}>{r.name}</td>
                    <td className={tdCls}>{formatNumber(r.owned_at_own_wh)}</td>
                    <td className={tdCls}>{formatNumber(r.consigned_at_own_wh)}</td>
                    <td className={tdCls}>{formatNumber(r.owned_at_partners)}</td>
                    <td className={tdCls}>{formatNumber(r.consigned_at_partners)}</td>
                    <td className={`${tdCls} font-medium`}>{formatNumber(r.total_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </section>

        <Card title="Notes">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Revenue & profit by source (owned vs consigned) is visible to the Owner role only, per the spec&apos;s role rules.</li>
            <li>Every batch can be traced end-to-end in the movement ledger (Inventory → batch → movements are recorded in <code>stock_movements</code>).</li>
            <li>A MISMATCH in the partner check means: sent ≠ consumed + returned + still held — investigate with the partner before the next settlement.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
