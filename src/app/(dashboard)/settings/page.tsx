import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import UsernameForm from "@/components/UsernameForm";
import { createWarehouseAction, updateVatModeAction } from "@/lib/actions";
import { getCurrentProfile, listLocations } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type AnyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const locations = await listLocations();
  const me = (await getCurrentProfile()).data;
  const supabase = await createClient();
  let vatMode = "COMBINED";
  let profiles: AnyRow[] = [];
  if (supabase) {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "vat_invoice_mode")
      .maybeSingle();
    if (data?.value) vatMode = String(data.value);
    const { data: p } = await supabase.from("profiles").select("*").order("full_name");
    profiles = p ?? [];
  }
  const warehouses = locations.data.filter((l) => l.location_kind === "OWN_WAREHOUSE");
  const partnerWarehouses = locations.data.filter((l) => l.location_kind === "PARTNER_VIRTUAL");

  return (
    <>
      <PageHeader title="Settings" description="System-wide choices. The VAT invoice mode must match what your accountant decides together with the consignment contract model." />
      {!locations.configured && <NotConfigured />}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="VAT invoice mode">
          <form action={updateVatModeAction} className="space-y-3">
            <div>
              <label className={labelCls}>How mixed invoices are issued</label>
              <select name="vat_invoice_mode" defaultValue={vatMode} className={inputCls}>
                <option value="COMBINED">COMBINED — one GTGT invoice, one line per nature</option>
                <option value="SEPARATE">SEPARATE — two GTGT invoices, one per nature</option>
              </select>
            </div>
            <p className="text-xs text-slate-500">
              Either way, the internal management documents (BH / KG) are always separate and each
              invoice line stays linked to exactly one of them. This setting only controls how lines
              are grouped when issuing the legal invoice.
            </p>
            <button type="submit" className={btnCls}>Save</button>
          </form>
        </Card>

        <Card title="Our warehouses / locations">
          {warehouses.length === 0 ? <EmptyState message="No warehouse yet — create the first one." /> : (
            <ul className="space-y-1 text-sm">
              {warehouses.map((l) => (
                <li key={l.id} className="flex justify-between"><span>{l.name}</span><span className="text-slate-500">{l.detail ?? ""}</span></li>
              ))}
            </ul>
          )}
          <form action={createWarehouseAction} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div className="flex gap-2">
              <input name="name" required placeholder="Warehouse name (Kho chính)" className={inputCls} />
              <input name="detail" placeholder="Detail (address / shelf zone)" className={inputCls} />
            </div>
            <button type="submit" className={`${btnCls} w-full`}>Add warehouse</button>
          </form>
          {partnerWarehouses.length > 0 && (
            <p className="mt-4 text-xs text-slate-500">
              Partner virtual warehouses ({partnerWarehouses.length}) are created automatically when the first consignment-out slip to a partner is confirmed.
            </p>
          )}
        </Card>

        <Card title="Users & roles" className="lg:col-span-2">
          {profiles.length === 0 ? (
            <EmptyState message="No profiles yet. Create the first OWNER profile as described in supabase/README.md." />
          ) : (
            <TableWrap>
              <thead><tr><th className={thCls}>Name</th><th className={thCls}>Email</th><th className={thCls}>Username</th><th className={thCls}>Role</th><th className={thCls}>Active</th></tr></thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className={tdCls}>{p.full_name}</td>
                    <td className={tdCls}>{p.email ?? "—"}</td>
                    <td className={tdCls}>
                      <UsernameForm
                        profileId={p.id}
                        username={p.username ?? null}
                        canEdit={!!me && (me.role === "OWNER" || me.id === p.id)}
                      />
                    </td>
                    <td className={tdCls}>{ROLE_LABELS[p.role as keyof typeof ROLE_LABELS] ?? p.role}</td>
                    <td className={tdCls}>{p.is_active ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-500">
            <li>Username — optional short sign-in name (3–32 chars). Users can sign in with their username or their email; the OWNER can set usernames for everyone, users can set their own.</li>
            <li>OWNER — full access, sees consignment prices and profit.</li>
            <li>SALES — sells and invoices; cannot see consignment prices, cost or profit (financial tables are blocked by RLS; the sales UI uses a cost-free batch view).</li>
            <li>WAREHOUSE — stock in/out, stocktakes, returns; no money data.</li>
            <li>ACCOUNTING — payables, receivables, settlements, invoices and reports; cannot edit stock directly.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
