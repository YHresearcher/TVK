import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import ItemsRows from "@/components/ItemsRows";
import {
  confirmConsignmentReceiptAction,
  confirmPurchaseReceiptAction,
  createConsignmentReceiptAction,
  createPurchaseReceiptAction,
} from "@/lib/actions";
import { listConsignmentReceipts, listLocations, listProducts, listPurchaseReceipts, listSuppliers } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import type { AnyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StockInPage({
  searchParams,
}: {
  searchParams: { tab?: string; ok?: string };
}) {
  const tab = searchParams.tab === "consignment" ? "consignment" : "purchase";
  const [suppliers, locations, products, purchases, consignments] = await Promise.all([
    listSuppliers(),
    listLocations(),
    listProducts(),
    listPurchaseReceipts(),
    listConsignmentReceipts(),
  ]);
  const configured = suppliers.configured;
  const warehouses = locations.data.filter((l) => l.location_kind === "OWN_WAREHOUSE");
  const supplierOptions = suppliers.data.map((s) => ({ value: s.id, label: s.name }));
  const warehouseOptions = warehouses.map((l) => ({ value: l.id, label: l.name }));
  const productOptions = products.data.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }));
  const supplierName = new Map(suppliers.data.map((s) => [s.id, s.name]));

  const tabCls = (active: boolean) =>
    `rounded-md px-4 py-2 text-sm font-medium ${active ? "bg-blue-600 text-white" : "bg-white border border-slate-300 text-slate-700"}`;

  return (
    <>
      <PageHeader title="Stock In" description="Purchases create OWN batches (white labels). Consignment receipts create CONS batches (yellow labels) and do NOT create payables until the goods are sold." />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved successfully.</p>}
      <div className="mb-6 flex gap-2">
        <Link href="/stock-in?tab=purchase" className={tabCls(tab === "purchase")}>Purchase receipts (PN)</Link>
        <Link href="/stock-in?tab=consignment" className={tabCls(tab === "consignment")}>Consignment receipts (NK)</Link>
      </div>

      {tab === "purchase" ? (
        <div className="space-y-6">
          <Card title="New purchase receipt">
            <form action={createPurchaseReceiptAction} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div><label className={labelCls}>Supplier *</label>
                  <select name="supplier_id" required className={inputCls}><option value="">— Select —</option>{supplierOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Warehouse *</label>
                  <select name="warehouse_id" required className={inputCls}><option value="">— Select —</option>{warehouseOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Receipt date</label><input name="receipt_date" type="date" className={inputCls} /></div>
                <div><label className={labelCls}>Supplier invoice no.</label><input name="supplier_invoice_no" className={inputCls} /></div>
              </div>
              <ItemsRows fields={[
                { name: "product_id", label: "Product", type: "select", options: productOptions },
                { name: "qty", label: "Qty", type: "number" },
                { name: "unit_cost", label: "Unit cost (₫)", type: "number", step: "1000" },
              ]} />
              <button type="submit" className={btnCls}>Create draft receipt</button>
            </form>
          </Card>
          <ReceiptTable
            rows={purchases.data}
            supplierName={supplierName}
            confirmAction={confirmPurchaseReceiptAction}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <Card title="New consignment receipt">
            <form action={createConsignmentReceiptAction} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div><label className={labelCls}>Supplier *</label>
                  <select name="supplier_id" required className={inputCls}><option value="">— Select —</option>{supplierOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Warehouse *</label>
                  <select name="warehouse_id" required className={inputCls}><option value="">— Select —</option>{warehouseOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Receipt date</label><input name="receipt_date" type="date" className={inputCls} /></div>
                <div><label className={labelCls}>Return-by date (blank = supplier default)</label><input name="return_by_date" type="date" className={inputCls} /></div>
              </div>
              <ItemsRows fields={[
                { name: "product_id", label: "Product", type: "select", options: productOptions },
                { name: "qty", label: "Qty", type: "number" },
                { name: "consignment_price", label: "Consignment price (₫)", type: "number", step: "1000" },
              ]} />
              <button type="submit" className={btnCls}>Create draft receipt</button>
            </form>
          </Card>
          <ReceiptTable
            rows={consignments.data}
            supplierName={supplierName}
            confirmAction={confirmConsignmentReceiptAction}
          />
        </div>
      )}
    </>
  );
}

function ReceiptTable({
  rows,
  supplierName,
  confirmAction,
}: {
  rows: AnyRow[];
  supplierName: Map<string, string>;
  confirmAction: (formData: FormData) => Promise<void>;
}) {
  if (rows.length === 0) return <EmptyState message="No receipts yet." />;
  return (
    <TableWrap>
      <thead><tr><th className={thCls}>Code</th><th className={thCls}>Supplier</th><th className={thCls}>Date</th><th className={thCls}>Status</th><th className={thCls}></th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-slate-100">
            <td className={`${tdCls} font-mono text-xs`}>{r.doc_code}</td>
            <td className={tdCls}>{supplierName.get(r.supplier_id) ?? "—"}</td>
            <td className={tdCls}>{formatDate(r.receipt_date)}</td>
            <td className={tdCls}><StatusBadge status={r.status} /></td>
            <td className={tdCls}>
              {r.status === "DRAFT" && (
                <form action={confirmAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className={btnGhostCls}>Confirm → create batches</button>
                </form>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
