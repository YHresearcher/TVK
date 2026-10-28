import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import ItemsRows from "@/components/ItemsRows";
import ImportConsignmentOut from "@/components/ImportConsignmentOut";
import { confirmConsignmentOutAction, createConsignmentOutAction, importConsignmentOutAction } from "@/lib/actions";
import { buildProductCodeMap, getCurrentProfile, listBatchStock, listConsignmentOutSlips, listPartners, listProductCodes, listProductFitments, listProducts, listSuppliers } from "@/lib/queries";
import type { PosProduct } from "@/components/PosSaleForm";
import { formatDate } from "@/lib/format";
import { OWNERSHIP_LABELS, isReadOnlyRole, type AnyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ConsignmentOutPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [slips, partners, batchStock, suppliers, products, productCodes, fitments, profile] = await Promise.all([
    listConsignmentOutSlips(),
    listPartners(),
    listBatchStock(),
    listSuppliers(),
    listProducts(),
    listProductCodes(),
    listProductFitments(),
    getCurrentProfile(),
  ]);
  const configured = slips.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
  const partnerName = new Map(partners.data.map((p) => [p.id, p.name]));
  const partnerOptions = partners.data.map((p) => ({ value: p.id, label: p.name }));
  const ownBatches = Array.from(
    new Map(
      batchStock.data
        .filter((r) => r.location_kind === "OWN_WAREHOUSE")
        .map((r) => [r.batch_id, r])
    ).values()
  );
  const batchOptions = ownBatches.map((r) => ({
    value: r.batch_id,
    label: `${r.batch_code} — ${r.product_name} (${OWNERSHIP_LABELS[r.ownership] ?? r.ownership}${r.supplier_name ? " / " + r.supplier_name : ""})`,
  }));
  // Danh mục cho import Excel (giống form bán hàng): khớp tên + dòng xe,
  // tra mã, rồi phân bổ FIFO. Hàng đợi FIFO: lô cũ nhất trước, mỗi lô
  // mang tồn tại vị trí kho mình giữ nhiều nhất (đúng vị trí phiếu sẽ
  // trừ — cùng logic mainOwnLocations phía server). Lô ký gửi của nhà
  // cung cấp chưa cho ký gửi tiếp (ô D khoá) thì loại khỏi hàng đợi.
  const fitmentsByProduct = new Map<string, string[]>();
  for (const f of fitments.data) {
    const v = f.vehicles as AnyRow | AnyRow[] | null;
    const model = Array.isArray(v) ? v[0]?.model : v?.model;
    if (!model) continue;
    const list = fitmentsByProduct.get(f.product_id) ?? [];
    if (!list.includes(String(model))) list.push(String(model));
    fitmentsByProduct.set(f.product_id, list);
  }
  const posProducts: PosProduct[] = products.data.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    retailPrice: Number(p.retail_price) || 0,
    garagePrice: Number(p.garage_price) || 0,
    wholesalePrice: Number(p.wholesale_price) || 0,
    fitments: fitmentsByProduct.get(p.id) ?? [],
  }));
  const productById = new Map(products.data.map((p) => [p.id, p]));
  const codeMapRaw = buildProductCodeMap(products.data, productCodes.data);
  const gkCodeMap: Record<string, { productId: string; productName: string }> = {};
  for (const [code, productId] of Object.entries(codeMapRaw)) {
    const p = productById.get(productId);
    if (p) gkCodeMap[code] = { productId, productName: p.name };
  }
  const subOkBySupplier = new Map(
    suppliers.data.map((s) => [s.id, !!s.allow_sub_consignment])
  );
  const mainOwnQtyByBatch = new Map<string, number>();
  for (const r of batchStock.data) {
    if (r.location_kind !== "OWN_WAREHOUSE") continue;
    const prev = mainOwnQtyByBatch.get(r.batch_id) ?? 0;
    if (Number(r.qty) > prev) mainOwnQtyByBatch.set(r.batch_id, Number(r.qty));
  }
  const gkFifoBatches: Record<string, { batch_id: string; batch_code: string; ownership: string; mainOwnQty: number }[]> = {};
  for (const r of [...ownBatches].sort(
    (a, b) =>
      String(a.received_date).localeCompare(String(b.received_date)) ||
      String(a.batch_code).localeCompare(String(b.batch_code))
  )) {
    const q = mainOwnQtyByBatch.get(r.batch_id) ?? 0;
    if (q <= 0) continue;
    if (r.ownership === "CONSIGNED" && !subOkBySupplier.get(r.supplier_id)) continue;
    (gkFifoBatches[r.product_id] ??= []).push({
      batch_id: r.batch_id,
      batch_code: r.batch_code,
      ownership: OWNERSHIP_LABELS[r.ownership] ?? r.ownership,
      mainOwnQty: q,
    });
  }

  return (
    <>
      <PageHeader
        title="Gửi ký gửi (GK)"
        description="Gửi hàng cho đối tác chỉ thay đổi nơi giữ hàng — quyền sở hữu vẫn của mình, chưa ghi doanh thu và chưa ghi phải thu cho tới khi đối tác báo tiêu thụ. Gửi tiếp lô của nhà cung cấp (ô D) bị chặn trừ khi nhà cung cấp đó cho phép."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      <div className="space-y-6">
        {!readOnly && (
        <>
        <Card title="Phiếu gửi ký gửi / giao hàng mới">
          <form action={createConsignmentOutAction} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div><label className={labelCls}>Đối tác *</label>
                <select name="partner_id" required className={inputCls}><option value="">— Chọn —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div><label className={labelCls}>Ngày phiếu</label><input name="slip_date" type="date" className={inputCls} /></div>
              <div><label className={labelCls}>Hạn đối soát</label><input name="settlement_due_date" type="date" className={inputCls} /></div>
              <div><label className={labelCls}>Hạn trả</label><input name="return_by_date" type="date" className={inputCls} /></div>
            </div>
            <ItemsRows fields={[
              { name: "batch_id", label: "Lô (tại Kho TVK)", type: "select", options: batchOptions },
              { name: "qty", label: "Số lượng", type: "number" },
              { name: "transfer_price", label: "Giá chuyển giao / giá thoả thuận (₫)", type: "number", step: "1000" },
            ]} initialRows={2} />
            <p className="text-xs text-slate-500">Kho nguồn được tự động xác định từ vị trí hiện tại của lô. Giá chuyển giao dùng để kiểm tra hạn mức ký gửi của đối tác khi xác nhận. Muốn bán đứt thì dùng mục Bán hàng — phiếu này chỉ gửi ký gửi.</p>
            <SubmitButton className={btnCls}>Tạo phiếu nháp</SubmitButton>
          </form>
        </Card>
        <Card title="Nhập từ Excel (GK)">
          <ImportConsignmentOut partners={partners.data} products={posProducts} codeMap={gkCodeMap} fifoBatches={gkFifoBatches} action={importConsignmentOutAction} />
        </Card>
        </>
        )}

        {slips.data.length === 0 ? <EmptyState message="Chưa có phiếu gửi." /> : (
          <TableWrap>
            <thead><tr><th className={thCls}>Mã</th><th className={thCls}>Đối tác</th><th className={thCls}>Ngày</th><th className={thCls}>Hạn đối soát</th><th className={thCls}>Trạng thái</th><th className={thCls}></th></tr></thead>
            <tbody>
              {slips.data.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className={`${tdCls} font-mono text-xs`}>{s.doc_code}</td>
                  <td className={tdCls}>{partnerName.get(s.partner_id) ?? "—"}</td>
                  <td className={tdCls}>{formatDate(s.slip_date)}</td>
                  <td className={tdCls}>{formatDate(s.settlement_due_date)}</td>
                  <td className={tdCls}><StatusBadge status={s.status} /></td>
                  <td className={tdCls}>
                    {s.status === "DRAFT" && !readOnly && (
                      <form action={confirmConsignmentOutAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <SubmitButton className={btnGhostCls}>Xác nhận → chuyển hàng tới đối tác</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </>
  );
}
