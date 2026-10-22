import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import ItemsRows from "@/components/ItemsRows";
import ImportExcel from "@/components/ImportExcel";
import {
  confirmConsignmentReceiptAction,
  confirmPurchaseReceiptAction,
  createConsignmentReceiptAction,
  createPurchaseReceiptAction,
  importStockAction,
} from "@/lib/actions";
import { buildProductCodeMap, getCurrentProfile, listConsignmentReceipts, listLocations, listProductCodes, listProducts, listPurchaseReceipts, listSuppliers } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { isReadOnlyRole, type AnyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StockInPage({
  searchParams,
}: {
  searchParams: { tab?: string; ok?: string };
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
  const codeMap = buildProductCodeMap(products.data, productCodes.data);
  const configured = suppliers.configured;
  const warehouses = locations.data.filter((l) => l.location_kind === "OWN_WAREHOUSE");
  const supplierOptions = suppliers.data.map((s) => ({ value: s.id, label: s.name }));
  const warehouseOptions = warehouses.map((l) => ({ value: l.id, label: l.name }));
  const productOptions = products.data.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }));
  const supplierName = new Map(suppliers.data.map((s) => [s.id, s.name]));

  const tabCls = (active: boolean, activeCls: string) =>
    `rounded-md px-4 py-2 text-sm font-medium ${active ? activeCls : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"}`;

  return (
    <>
      <PageHeader title="Nhập kho" description="Nhập mua tạo lô OWN (nhãn trắng). Nhận ký gửi tạo lô CONS (nhãn vàng) và CHƯA tạo công nợ phải trả cho tới khi hàng bán được." />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
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
              <Card title="Cấu trúc file chuẩn">
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                  <li>
                    Các cột: <b>MaHang</b> (bắt buộc), MaThayThe (nhiều mã cách
                    nhau bằng dấu “;”), TenHang, TenTiengAnh, ThuongHieu,
                    DongXe, DonViTinh, <b>SoLuong</b>, GiaVonVND, GiaUSD,
                    GiaBanDeXuat, GhiChu. Tên cột không phân biệt hoa thường
                    và dấu.
                  </li>
                  <li>
                    Giá vốn mỗi dòng: ưu tiên GiaVonVND; nếu để trống sẽ tính
                    từ GiaUSD × tỷ giá × (1 + VAT%) theo thông số ở trên.
                  </li>
                  <li>
                    Mã hàng khớp với SKU hoặc bất kỳ mã thay thế nào đã đăng
                    ký thì vào sản phẩm đã có; mã chưa có sẽ được tự tạo (kèm
                    mã thay thế và dòng xe) khi bật tuỳ chọn tự tạo.
                  </li>
                  <li>
                    Hãy dùng nút “Tải file mẫu” để lấy đúng định dạng, và kiểm
                    tra bảng xem trước (trạng thái từng dòng, tổng số lượng,
                    tổng tiền) trước khi bấm “Xác nhận nhập”. Nhập xong, hệ
                    thống tự chuyển về danh sách phiếu tương ứng ở trang này
                    để bạn kiểm tra phiếu vừa tạo.
                  </li>
                </ul>
              </Card>
            </>
          )}
        </div>
      ) : tab === "purchase" ? (
        <div className="space-y-6">
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
              <button type="submit" className={btnCls}>Tạo phiếu nháp</button>
            </form>
          </Card>
          )}
          <ReceiptTable
            rows={purchases.data}
            supplierName={supplierName}
            confirmAction={confirmPurchaseReceiptAction}
            readOnly={readOnly}
          />
        </div>
      ) : (
        <div className="space-y-6">
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
              <button type="submit" className={btnCls}>Tạo phiếu nháp</button>
            </form>
          </Card>
          )}
          <ReceiptTable
            rows={consignments.data}
            supplierName={supplierName}
            confirmAction={confirmConsignmentReceiptAction}
            readOnly={readOnly}
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
  readOnly,
}: {
  rows: AnyRow[];
  supplierName: Map<string, string>;
  confirmAction: (formData: FormData) => Promise<void>;
  readOnly?: boolean;
}) {
  if (rows.length === 0) return <EmptyState message="Chưa có phiếu nhập." />;
  return (
    <TableWrap>
      <thead><tr><th className={thCls}>Mã</th><th className={thCls}>Nhà cung cấp</th><th className={thCls}>Ngày</th><th className={thCls}>Trạng thái</th><th className={thCls}></th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-slate-100">
            <td className={`${tdCls} font-mono text-xs`}>{r.doc_code}</td>
            <td className={tdCls}>{supplierName.get(r.supplier_id) ?? "—"}</td>
            <td className={tdCls}>{formatDate(r.receipt_date)}</td>
            <td className={tdCls}><StatusBadge status={r.status} /></td>
            <td className={tdCls}>
              {r.status === "DRAFT" && !readOnly && (
                <form action={confirmAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className={btnGhostCls}>Xác nhận → tạo lô</button>
                </form>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
