import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { createSupplierAction } from "@/lib/actions";
import { listSuppliers } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const suppliers = await listSuppliers();
  return (
    <>
      <PageHeader title="Suppliers" description="Consignment terms live here: how many days after a sale we must pay, how long unsold consigned goods can stay, and whether this supplier allows sub-consignment (cell D)." />
      {!suppliers.configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {suppliers.data.length === 0 ? <EmptyState message="No suppliers yet." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Name</th><th className={thCls}>Phone</th><th className={thCls}>Tax code</th><th className={thCls}>Pay after sale (days)</th><th className={thCls}>Return window (days)</th><th className={thCls}>Sub-consignment</th></tr></thead>
              <tbody>
                {suppliers.data.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className={`${tdCls} font-medium`}>{s.name}</td>
                    <td className={tdCls}>{s.phone ?? "—"}</td>
                    <td className={tdCls}>{s.tax_code ?? "—"}</td>
                    <td className={tdCls}>{s.consignment_pay_days}</td>
                    <td className={tdCls}>{s.consignment_return_days}</td>
                    <td className={tdCls}>{s.allow_sub_consignment ? "Allowed" : "Locked"}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
        <Card title="New supplier" className="h-fit">
          <form action={createSupplierAction} className="space-y-3">
            <div><label className={labelCls}>Name *</label><input name="name" required className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Contact person</label><input name="contact_name" className={inputCls} /></div>
              <div><label className={labelCls}>Phone</label><input name="phone" className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Email</label><input name="email" type="email" className={inputCls} /></div>
              <div><label className={labelCls}>Tax code</label><input name="tax_code" className={inputCls} /></div>
            </div>
            <div><label className={labelCls}>Address</label><input name="address" className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Pay after sale (days)</label><input name="consignment_pay_days" type="number" defaultValue="30" className={inputCls} /></div>
              <div><label className={labelCls}>Return window (days)</label><input name="consignment_return_days" type="number" defaultValue="90" className={inputCls} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="allow_sub_consignment" className="h-4 w-4" />
              Allow sub-consignment of this supplier&apos;s goods (cell D)
            </label>
            <div><label className={labelCls}>Notes</label><textarea name="notes" rows={2} className={inputCls} /></div>
            <button type="submit" className={`${btnCls} w-full`}>Create supplier</button>
          </form>
        </Card>
      </div>
    </>
  );
}
