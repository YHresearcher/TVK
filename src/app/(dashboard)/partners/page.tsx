import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { createPartnerAction } from "@/lib/actions";
import { listPartners } from "@/lib/queries";
import { formatVND } from "@/lib/format";
import { PARTNER_KINDS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const partners = await listPartners();
  return (
    <>
      <PageHeader title="Partners" description="Customers, garages, transport companies and other shops. A partner can both buy outright and take consignment — the system tracks the two natures separately per batch and per document." />
      {!partners.configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {partners.data.length === 0 ? <EmptyState message="No partners yet." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Name</th><th className={thCls}>Type</th><th className={thCls}>Phone</th><th className={thCls}>Tax code</th><th className={thCls}>Payment days</th><th className={thCls}>Credit limit</th><th className={thCls}>Consignment limit</th></tr></thead>
              <tbody>
                {partners.data.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className={`${tdCls} font-medium`}>{p.name}</td>
                    <td className={tdCls}>{p.partner_kind}</td>
                    <td className={tdCls}>{p.phone ?? "—"}</td>
                    <td className={tdCls}>{p.tax_code ?? "—"}</td>
                    <td className={tdCls}>{p.payment_days}</td>
                    <td className={tdCls}>{formatVND(p.credit_limit)}</td>
                    <td className={tdCls}>{formatVND(p.consignment_limit)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
        <Card title="New partner" className="h-fit">
          <form action={createPartnerAction} className="space-y-3">
            <div><label className={labelCls}>Name *</label><input name="name" required className={inputCls} /></div>
            <div><label className={labelCls}>Type</label>
              <select name="partner_kind" className={inputCls} defaultValue="GARAGE">
                {PARTNER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Contact person</label><input name="contact_name" className={inputCls} /></div>
              <div><label className={labelCls}>Phone</label><input name="phone" className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Email</label><input name="email" type="email" className={inputCls} /></div>
              <div><label className={labelCls}>Tax code</label><input name="tax_code" className={inputCls} /></div>
            </div>
            <div><label className={labelCls}>Address</label><input name="address" className={inputCls} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className={labelCls}>Payment days</label><input name="payment_days" type="number" defaultValue="0" className={inputCls} /></div>
              <div><label className={labelCls}>Credit limit (₫)</label><input name="credit_limit" type="number" step="100000" defaultValue="0" className={inputCls} /></div>
              <div><label className={labelCls}>Consignment limit (₫)</label><input name="consignment_limit" type="number" step="100000" defaultValue="0" className={inputCls} /></div>
            </div>
            <div><label className={labelCls}>Notes</label><textarea name="notes" rows={2} className={inputCls} /></div>
            <button type="submit" className={`${btnCls} w-full`}>Create partner</button>
          </form>
        </Card>
      </div>
    </>
  );
}
