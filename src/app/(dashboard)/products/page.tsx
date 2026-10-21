import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { createProductAction } from "@/lib/actions";
import { listProductStock, listProducts } from "@/lib/queries";
import { formatNumber, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; ok?: string };
}) {
  const [products, stock] = await Promise.all([listProducts(), listProductStock()]);
  const configured = products.configured;
  const stockMap = new Map(stock.data.map((s) => [s.product_id, s]));
  const q = (searchParams.q ?? "").toLowerCase();
  const rows = products.data.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q)
  );

  return (
    <>
      <PageHeader
        title="Products"
        description="Catalog with OEM / equivalent codes and vehicle fitments. Stock is split: owned vs consigned."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <form method="get" className="mb-4 flex gap-2">
            <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Search by name or SKU…" className={inputCls} />
            <button className={btnCls} type="submit">Search</button>
          </form>
          {rows.length === 0 ? (
            <EmptyState message="No products yet." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={thCls}>SKU</th><th className={thCls}>Name</th><th className={thCls}>Brand</th>
                  <th className={thCls}>Retail price</th><th className={thCls}>Owned</th><th className={thCls}>Consigned</th>
                  <th className={thCls}>At partners</th><th className={thCls}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const s = stockMap.get(p.id);
                  return (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className={tdCls}>
                        <Link href={`/products/${p.id}`} className="font-medium text-blue-600 hover:underline">{p.sku}</Link>
                      </td>
                      <td className={tdCls}>{p.name}</td>
                      <td className={tdCls}>{p.brand ?? "—"}</td>
                      <td className={tdCls}>{formatVND(p.retail_price)}</td>
                      <td className={tdCls}>{formatNumber(s?.owned_at_own_wh ?? 0)}</td>
                      <td className={tdCls}>{formatNumber(s?.consigned_at_own_wh ?? 0)}</td>
                      <td className={tdCls}>{formatNumber(Number(s?.owned_at_partners ?? 0) + Number(s?.consigned_at_partners ?? 0))}</td>
                      <td className={`${tdCls} font-medium`}>{formatNumber(s?.total_qty ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
        <Card title="New product" className="h-fit">
          <form action={createProductAction} className="space-y-3">
            <div><label className={labelCls}>SKU *</label><input name="sku" required className={inputCls} /></div>
            <div><label className={labelCls}>Name *</label><input name="name" required className={inputCls} /></div>
            <div><label className={labelCls}>Brand</label><input name="brand" className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Unit</label><input name="unit" defaultValue="cái" className={inputCls} /></div>
              <div><label className={labelCls}>Min stock</label><input name="min_stock" type="number" defaultValue="0" className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className={labelCls}>Retail price</label><input name="retail_price" type="number" step="1000" defaultValue="0" className={inputCls} /></div>
              <div><label className={labelCls}>Garage price</label><input name="garage_price" type="number" step="1000" defaultValue="0" className={inputCls} /></div>
              <div><label className={labelCls}>Wholesale price</label><input name="wholesale_price" type="number" step="1000" defaultValue="0" className={inputCls} /></div>
            </div>
            <div>
              <label className={labelCls}>Lookup codes (one per line, format: CODE or CODE|KIND — KIND: OEM, MANUFACTURER, AFTERMARKET, EQUIVALENT)</label>
              <textarea name="codes" rows={3} className={inputCls} placeholder={"90915-YZZD4|OEM\n90915-20001|EQUIVALENT"} />
            </div>
            <button type="submit" className={`${btnCls} w-full`}>Create product</button>
          </form>
        </Card>
      </div>
    </>
  );
}
