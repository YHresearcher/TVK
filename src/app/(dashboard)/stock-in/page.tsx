import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import ItemsRows from "@/components/ItemsRows";
import ImportExcel from "@/components/ImportExcel";
import DeleteReceiptButton from "@/components/DeleteReceiptButton";
import {
  confirmConsignmentReceiptAction,
  confirmPurchaseReceiptAction,
  createConsignmentReceiptAction,
  createPurchaseReceiptAction,
  deleteReceiptAction,
  importStockAction,
} from "@/lib/actions";
import { buildProductCodeMap, getCurrentProfile, listConsignmentReceipts, listLocations, listProductCodes, listProducts, listPurchaseReceipts, listSuppliers } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { isReadOnlyRole, type AnyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StockInPage({
  searchParams,
}: {
  searchParams: { tab?: string; ok?: string; error?: string };
}) {
  const tab =
    searchParams.tab === "consignment"
      ? "consignment"
      : searchParams.tab === "import"
        ? "import"
        : "purchase";
  const [suppliers, locations, products, purchases, consignments, productCodes, profile] = await Promise.all([
    listSuppliers(),
    listLocations(),
    listProducts(),
    listPurchaseReceipts(),
    listConsignmentReceipts(),
    listProductCodes(),
    getCurrentProfile(),
  ]);
  const readOnly = isReadOnlyRole(profile.data?.role);
  const isOwner = profile.data?.role === "OWNER";
  const codeMap = buildProductCodeMap(products.data, productCodes.data);
  const configured = suppliers.configured;
  const warehouses = locations.data.filter((l) => l.location_kind === "OWN_WAREHOUSE");
  const supplierOptions = suppliers.data.map((s) => ({ value: s.id, label: s.name }));
  const warehouseOptions = warehouses.map((l) => ({ value: l.id, label: l.name }));
  const productOptions = products.data.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }));
  const supplierName = new Map(suppliers.data.map((s) => [s.id, s.name]));
  const draftPurchases = purchases.data.filter((r) => r.status === "DRAFT");
  const confirmedPurchases = purchases.data.filter((r) => r.status !== "DRAFT");
  const draftConsignments = consignments.data.filter((r) => r.status === "DRAFT");
  const confirmedConsignments = consignments.data.filter((r) => r.status !== "DRAFT");

  const tabCls = (active: boolean, activeCls: string) =>
    `rounded-md px-4 py-2 text-sm font-medium ${active ? activeCls : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"}`;

  return (
    <>
      <PageHeader title="Nhập kho" />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      {searchParams.error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{searchParams.error}</p>}
      <div className="mb-6 flex gap-2">
        <Link href="/stock-in?tab=purchase" className={tabCls(tab === "purchase", "bg-blue-600 text-white")}>Phiếu nhập mua (PN)</Link>
        <Link href="/stock-in?tab=consignment" className={tabCls(tab === "consignment", "bg-amber-500 text-white")}>Phiếu nhận ký gửi (NK)</Link>
        <Link href="/stock-in?tab=import" className={tabCls(tab === "import", "bg-emerald-600 text-white")}>Nhập từ Excel</Link>
      </div>

      {tab === "import" ? (
        <div className="space-y-6">
          {readOnly ? (
            <Card title="Nhập từ Excel">
              <p className="text-sm leading-relaxed text-slate-600">
                Vai trò của bạn chỉ có quyền xem, không nhập dữ liệu. Khi cần
                nhập hàng từ Excel, hãy nhờ vai trò Kho hoặc Chủ cửa hàng
                thực hiện tại mục này bằng tài khoản của họ.
              </p>
            </Card>
          ) : (
            <>
              <Card title="Import phiếu nhập kho">
                <ImportExcel
                  suppliers={suppliers.data}
                  warehouses={warehouses}
                  products={products.data.map((p) => ({
                    id: p.id,
                    sku: p.sku,
                    name: p.name,
                  }))}
                  codes={productCodes.data.map((c) => ({
                    code: c.code,
                    product_id: c.product_id,
                  }))}
                  action={importStockAction}
                />
              </Card>
            </>
          )}
        </div>
      ) : tab === "purchase" ? (
        <div className="space-y-6">
          <DraftsCard
            rows={draftPurchases}
            supplierName={supplierName}
            confirmAction={confirmPurchaseReceiptAction}
            deleteAction={deleteReceiptAction}
            kind="PN"
            tab="purchase"
            readOnly={readOnly}
            canDelete={isOwner}
          />
          {!readOnly && (
          <Card title="Phiếu nhập mua mới">
            <form action={createPurchaseReceiptAction} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div><label className={labelCls}>Nhà cung cấp *</label>
                  <select name="supplier_id" required className={inputCls}><option value="">— Chọn —</option>{supplierOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Kho *</label>
                  <select name="warehouse_id" required className={inputCls}><option value="">— Chọn —</option>{warehouseOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Ngày nhập</label><input name="receipt_date" type="date" className={inputCls} /></div>
                <div><label className={labelCls}>Số hoá đơn của nhà cung cấp</label><input name="supplier_invoice_no" className={inputCls} /></div>
              </div>
              <ItemsRows codeMap={codeMap} fields={[
                { name: "product_id", label: "Sản phẩm", type: "select", options: productOptions },
                { name: "qty", label: "Số lượng", type: "number" },
                { name: "unit_cost", label: "Đơn giá vốn (₫)", type: "number", step: "1000" },
              ]} />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="confirm_now" />
                  Xác nhận ngay → tạo lô (không qua phiếu nháp)
                </label>
              </div>
              <button type="submit" className={btnCls}>Tạo phiếu</button>
            </form>
          </Card>
          )}
          <ReceiptTable
            rows={confirmedPurchases}
            supplierName={supplierName}
            hasDrafts={draftPurchases.length > 0}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <DraftsCard
            rows={draftConsignments}
            supplierName={supplierName}
            confirmAction={confirmConsignmentReceiptAction}
            deleteAction={deleteReceiptAction}
            kind="NK"
            tab="consignment"
            readOnly={readOnly}
            canDelete={isOwner}
          />
          {!readOnly && (
          <Card title="Phiếu nhận ký gửi mới">
            <form action={createConsignmentReceiptAction} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div><label className={labelCls}>Nhà cung cấp *</label>
                  <select name="supplier_id" required className={inputCls}><option value="">— Chọn —</option>{supplierOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Kho *</label>
                  <select name="warehouse_id" required className={inputCls}><option value="">— Chọn —</option>{warehouseOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Ngày nhập</label><input name="receipt_date" type="date" className={inputCls} /></div>
                <div><label className={labelCls}>Hạn trả (để trống = mặc định của nhà cung cấp)</label><input name="return_by_date" type="date" className={inputCls} /></div>
              </div>
              <ItemsRows codeMap={codeMap} fields={[
                { name: "product_id", label: "Sản phẩm", type: "select", options: productOptions },
                { name: "qty", label: "Số lượng", type: "number" },
                { name: "consignment_price", label: "Giá ký gửi (₫)", type: "number", step: "1000" },
              ]} />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="confirm_now" />
                  Xác nhận ngay → tạo lô (không qua phiếu nháp)
                </label>
              </div>
              <button type="submit" className={btnCls}>Tạo phiếu</button>
            </form>
          </Card>
          )}
          <ReceiptTable
            rows={confirmedConsignments}
            supplierName={supplierName}
            hasDrafts={draftConsignments.length > 0}
          />
        </div>
      )}
    </>
  );
}

/** Phiếu nháp chờ xác nhận — đặt lên đầu tab để dễ thấy: hàng chưa vào kho cho tới khi xác nhận. */
function DraftsCard({
  rows,
  supplierName,
  confirmAction,
  deleteAction,
  kind,
  tab,
  readOnly,
  canDelete,
}: {
  rows: AnyRow[];
  supplierName: Map<string, string>;
  confirmAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  kind: "PN" | "NK";
  tab: string;
  readOnly?: boolean;
  canDelete?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <Card title={`Phiếu nháp chờ xác nhận (${rows.length})`}>
      <p className="mb-4 text-sm leading-relaxed text-slate-600">
        Hàng chưa vào kho. Bấm Xác nhận để tạo lô và ghi sổ cái.
      </p>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <span className="font-mono text-xs font-medium">{r.doc_code}</span>
            <span className="text-sm text-slate-700">{supplierName.get(r.supplier_id) ?? "—"}</span>
            <span className="text-sm text-slate-500">{formatDate(r.receipt_date)}</span>
            <span className="ml-auto flex items-center gap-2">
              {!readOnly && (
                <form action={confirmAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className={btnCls}>Xác nhận → tạo lô</button>
                </form>
              )}
              {canDelete && (
                <DeleteReceiptButton
                  receiptId={r.id}
                  kind={kind}
                  tab={tab}
                  docCode={r.doc_code}
                  action={deleteAction}
                />
              )}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ReceiptTable({
  rows,
  supplierName,
  hasDrafts,
}: {
  rows: AnyRow[];
  supplierName: Map<string, string>;
  hasDrafts?: boolean;
}) {
  if (rows.length === 0) return hasDrafts ? null : <EmptyState message="Chưa có phiếu nhập." />;
  return (
    <TableWrap>
      <thead><tr><th className={thCls}>Mã</th><th className={thCls}>Nhà cung cấp</th><th className={thCls}>Ngày</th><th className={thCls}>Trạng thái</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-slate-100">
            <td className={`${tdCls} font-mono text-xs`}>{r.doc_code}</td>
            <td className={tdCls}>{supplierName.get(r.supplier_id) ?? "—"}</td>
            <td className={tdCls}>{formatDate(r.receipt_date)}</td>
            <td className={tdCls}><StatusBadge status={r.status} /></td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
