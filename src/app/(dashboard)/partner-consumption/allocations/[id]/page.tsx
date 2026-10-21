import { BackLink, Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, tdCls, thCls } from "@/components/ui";
import { confirmAllocationAction, createAllocationDocumentsAction } from "@/lib/actions";
import { getAllocationDetail, listProducts } from "@/lib/queries";
import { formatNumber, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AllocationDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { ok?: string };
}) {
  const [detail, products] = await Promise.all([getAllocationDetail(params.id), listProducts()]);
  if (!detail.configured) return (<><PageHeader title="Allocation" /><NotConfigured /></>);
  if (!detail.slip) return (<><BackLink href="/partner-consumption" label="Back" /><EmptyState message="Allocation not found." /></>);
  const slip = detail.slip;
  const productName = new Map(products.data.map((p) => [p.id, `${p.sku} — ${p.name}`]));
  const documented = new Set(detail.documentedLineIds);
  const pendingCount = detail.lines.filter((l) => !documented.has(l.id)).length;

  return (
    <>
      <BackLink href="/partner-consumption" label="Back to Partner Consumption" />
      <PageHeader
        title={`Allocation ${slip.doc_code}`}
        description="Each line pins a consumed quantity to one batch and one source nature. Documents (BH/KG) are created from these lines — never typed again on the invoice."
        action={<StatusBadge status={slip.status} />}
      />
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</p>}
      <Card title="Lines">
        {detail.lines.length === 0 ? <EmptyState message="No lines." /> : (
          <TableWrap>
            <thead><tr><th className={thCls}>Product</th><th className={thCls}>Nature</th><th className={thCls}>Qty</th><th className={thCls}>Unit price</th><th className={thCls}>Amount</th><th className={thCls}>Document</th><th className={thCls}>Invoice status</th></tr></thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className={tdCls}>{productName.get(l.product_id) ?? l.product_id}</td>
                  <td className={tdCls}>{l.nature}</td>
                  <td className={tdCls}>{formatNumber(l.qty)}</td>
                  <td className={tdCls}>{formatVND(l.unit_price)}</td>
                  <td className={tdCls}>{formatVND(Number(l.qty) * Number(l.unit_price))}</td>
                  <td className={tdCls}>{documented.has(l.id) ? "Created" : "Pending"}</td>
                  <td className={tdCls}><StatusBadge status={l.invoice_status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          {slip.status === "DRAFT" && (
            <form action={confirmAllocationAction}>
              <input type="hidden" name="id" value={slip.id} />
              <button type="submit" className={btnCls}>Confirm allocation (checks the 3 locks)</button>
            </form>
          )}
          {slip.status === "CONFIRMED" && pendingCount > 0 && (
            <form action={createAllocationDocumentsAction}>
              <input type="hidden" name="id" value={slip.id} />
              <button type="submit" className={btnCls}>
                Create BH/KG documents for {pendingCount} pending line(s)
              </button>
            </form>
          )}
          {slip.status === "CONFIRMED" && pendingCount === 0 && (
            <p className="text-sm text-slate-500">All lines already have BH/KG documents. Go to VAT Invoices to issue the legal invoice.</p>
          )}
          <a href="/invoices" className={btnGhostCls}>Go to VAT Invoices</a>
        </div>
      </Card>
    </>
  );
}
