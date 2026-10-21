import { BackLink, Card, EmptyState, NotConfigured, PageHeader, TableWrap, btnCls, inputCls, tdCls, thCls } from "@/components/ui";
import { createFitmentAction, createProductCodeAction } from "@/lib/actions";
import { getProductDetail } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { CODE_KINDS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const detail = await getProductDetail(params.id);
  if (!detail.configured) return (<><PageHeader title="Product" /><NotConfigured /></>);
  if (!detail.product) return (<><BackLink href="/products" label="Back to products" /><EmptyState message="Product not found." /></>);
  const p = detail.product;
  const addCode = createProductCodeAction.bind(null, p.id);
  const addFitment = createFitmentAction.bind(null, p.id);

  return (
    <>
      <BackLink href="/products" label="Back to products" />
      <PageHeader title={`${p.sku} — ${p.name}`} description={`Brand: ${p.brand ?? "—"} · Unit: ${p.unit} · Min stock: ${p.min_stock}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Prices">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Retail</dt><dd className="font-medium">{formatVND(p.retail_price)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Garage</dt><dd className="font-medium">{formatVND(p.garage_price)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Wholesale</dt><dd className="font-medium">{formatVND(p.wholesale_price)}</dd></div>
          </dl>
        </Card>

        <Card title="Lookup codes">
          {detail.codes.length === 0 ? <EmptyState message="No codes yet." /> : (
            <ul className="space-y-1 text-sm">
              {detail.codes.map((c) => (
                <li key={c.id} className="flex justify-between"><span className="font-mono">{c.code}</span><span className="text-slate-500">{c.code_kind}</span></li>
              ))}
            </ul>
          )}
          <form action={addCode} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div className="flex gap-2">
              <input name="code" required placeholder="Code" className={inputCls} />
              <select name="code_kind" className={inputCls} defaultValue="OEM">
                {CODE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <button type="submit" className={`${btnCls} w-full`}>Add code</button>
          </form>
        </Card>

        <Card title="Vehicle fitments">
          {detail.fitments.length === 0 ? <EmptyState message="No fitments yet." /> : (
            <ul className="space-y-1 text-sm">
              {detail.fitments.map((f) => (
                <li key={f.vehicle_id}>
                  {f.vehicles?.make} {f.vehicles?.model} {f.vehicles?.year_from}–{f.vehicles?.year_to} {f.vehicles?.engine ?? ""}
                </li>
              ))}
            </ul>
          )}
          <form action={addFitment} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <input name="make" required placeholder="Make (Toyota)" className={inputCls} />
              <input name="model" required placeholder="Model (Vios)" className={inputCls} />
              <input name="year_from" type="number" placeholder="Year from" className={inputCls} />
              <input name="year_to" type="number" placeholder="Year to" className={inputCls} />
            </div>
            <input name="engine" placeholder="Engine (1.5)" className={inputCls} />
            <button type="submit" className={`${btnCls} w-full`}>Add fitment</button>
          </form>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Batches (lots) of this product">
          {detail.batches.length === 0 ? <EmptyState message="No stock yet." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Batch</th><th className={thCls}>Ownership</th><th className={thCls}>Supplier</th><th className={thCls}>Location</th><th className={thCls}>Qty</th><th className={thCls}>Received</th><th className={thCls}>Return by</th></tr></thead>
              <tbody>
                {detail.batches.map((b, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className={tdCls}>{b.batch_code}</td>
                    <td className={tdCls}>{b.ownership}</td>
                    <td className={tdCls}>{b.supplier_name ?? "—"}</td>
                    <td className={tdCls}>{b.location_name}</td>
                    <td className={tdCls}>{formatNumber(b.qty)}</td>
                    <td className={tdCls}>{formatDate(b.received_date)}</td>
                    <td className={tdCls}>{formatDate(b.return_by_date)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
