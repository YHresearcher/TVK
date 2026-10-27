import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, tdCls, thCls } from "@/components/ui";
import PosSaleForm, { type PosBatch, type PosPartner, type PosProduct } from "@/components/PosSaleForm";
import ImportDealerSale from "@/components/ImportDealerSale";
import { createCounterSaleAction, importDealerSaleAction } from "@/lib/actions";
import { buildProductCodeMap, getCurrentProfile, listBatchStock, listPartners, listProductCodes, listProductFitments, listProducts, listSalesDocuments, listSalesOrders } from "@/lib/queries";
import { formatDate, formatVND } from "@/lib/format";
import { OWNERSHIP_LABELS, isReadOnlyRole } from "@/lib/types";
import type { AnyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [orders, documents, partners, batchStock, products, productCodes, fitments, profile] = await Promise.all([
    listSalesOrders(),
    listSalesDocuments(),
    listPartners(),
    listBatchStock(),
    listProducts(),
    listProductCodes(),
    listProductFitments(),
    getCurrentProfile(),
  ]);
  const configured = orders.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
  const partnerOptions = partners.data.map((p) => ({ value: p.id, label: p.name }));
  const posPartners: PosPartner[] = partners.data.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.partner_kind,
  }));
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
  const ownBatches = Array.from(
    new Map(
      batchStock.data
        .filter((r) => r.location_kind === "OWN_WAREHOUSE")
        .map((r) => [r.batch_id, r])
    ).values()
  );
  const productById = new Map(
    products.data.map((p) => [p.id, p])
  );
  // Tra cứu mã hàng: mọi mã/SKU đã đăng ký (chuẩn hoá trim + hoa, như
  // buildProductCodeMap) → sản phẩm; dùng chung cho quầy POS và import.
  const codeMap = buildProductCodeMap(products.data, productCodes.data);
  const dealerCodeMap: Record<string, { productId: string; productName: string; wholesalePrice: number }> = {};
  for (const [code, productId] of Object.entries(codeMap)) {
    const p = productById.get(productId);
    if (p) {
      dealerCodeMap[code] = {
        productId,
        productName: p.name,
        wholesalePrice: Number(p.wholesale_price) || 0,
      };
    }
  }
  // Hàng đợi FIFO: theo từng sản phẩm, lô cũ nhất trước; mỗi lô mang tồn
  // tại vị trí kho mình giữ nhiều nhất (đúng vị trí phiếu sẽ trừ — cùng
  // logic mainOwnLocations phía server). Dùng chung cho import bán đại lý
  // và quầy POS (POS giữ thêm ownership thô để tách BH/KG khi tính tổng).
  const mainOwnQtyByBatch = new Map<string, number>();
  for (const r of batchStock.data) {
    if (r.location_kind !== "OWN_WAREHOUSE") continue;
    const prev = mainOwnQtyByBatch.get(r.batch_id) ?? 0;
    if (Number(r.qty) > prev) mainOwnQtyByBatch.set(r.batch_id, Number(r.qty));
  }
  const dealerFifoBatches: Record<string, { batch_id: string; batch_code: string; ownership: string; mainOwnQty: number }[]> = {};
  const posFifoBatches: Record<string, PosBatch[]> = {};
  for (const r of [...ownBatches].sort(
    (a, b) =>
      String(a.received_date).localeCompare(String(b.received_date)) ||
      String(a.batch_code).localeCompare(String(b.batch_code))
  )) {
    const q = mainOwnQtyByBatch.get(r.batch_id) ?? 0;
    if (q <= 0) continue;
    (dealerFifoBatches[r.product_id] ??= []).push({
      batch_id: r.batch_id,
      batch_code: r.batch_code,
      ownership: OWNERSHIP_LABELS[r.ownership] ?? r.ownership,
      mainOwnQty: q,
    });
    (posFifoBatches[r.product_id] ??= []).push({
      batch_id: r.batch_id,
      batch_code: r.batch_code,
      ownership: r.ownership,
      mainOwnQty: q,
    });
  }

  return (
    <>
      <PageHeader
        title="Bán hàng (tại quầy)"
        description="Tìm hàng theo tên, mã xe, mã hàng hoặc barcode rồi Enter để thêm dòng — giá tự theo loại khách hàng: khách lẻ giá lẻ, Gara giá gara, đối tác khác giá đại lý. Lô của mình đi vào chứng từ BH; lô ký gửi đi vào chứng từ KG và tự động tạo khoản phải trả cho nhà cung cấp của lô đó theo giá ký gửi của lô. Giảm giá chỉ áp dụng cho phần BH."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã bán xong — chứng từ đã xác nhận, tồn kho và công nợ đã cập nhật.</p>}
      <div className="space-y-6">
        {!readOnly && (
          <PosSaleForm
            partners={posPartners}
            products={posProducts}
            codeMap={codeMap}
            fifoBatches={posFifoBatches}
            action={createCounterSaleAction}
          />
        )}
        {!readOnly && (
          <Card title="Nhập từ Excel (Bán đại lý)">
            <p className="mb-4 text-sm text-slate-500">
              Một file là một đơn bán đại lý cho một đối tác (hoặc khách lẻ),
              vào đúng ngày bán đã chọn. Nhập theo mã hàng — hệ thống tự
              phân bổ theo lô cũ nhất còn hàng (FIFO). Đơn giá để trống thì
              lấy giá đại lý. Đơn tạo xong xác nhận ngay như nhập tay — lô
              của mình vào BH, lô ký gửi vào KG.
            </p>
            <ImportDealerSale
              partners={partnerOptions}
              codeMap={dealerCodeMap}
              fifoBatches={dealerFifoBatches}
              action={importDealerSaleAction}
            />
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Đơn hàng gần đây</h2>
            {orders.data.length === 0 ? <EmptyState message="Chưa có đơn hàng." /> : (
              <TableWrap>
                <thead><tr><th className={thCls}>Mã</th><th className={thCls}>Ngày</th><th className={thCls}>Tổng</th><th className={thCls}>Trạng thái</th></tr></thead>
                <tbody>
                  {orders.data.slice(0, 20).map((o) => (
                    <tr key={o.id} className="border-t border-slate-100">
                      <td className={`${tdCls} font-mono text-xs`}>{o.doc_code}</td>
                      <td className={tdCls}>{formatDate(o.order_date)}</td>
                      <td className={tdCls}>{formatVND(o.total_amount)}</td>
                      <td className={tdCls}><StatusBadge status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </div>
          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Chứng từ quản lý (BH / KG)</h2>
            {documents.data.length === 0 ? <EmptyState message="Chưa có chứng từ." /> : (
              <TableWrap>
                <thead><tr><th className={thCls}>Mã</th><th className={thCls}>Loại</th><th className={thCls}>Ngày</th><th className={thCls}>Tổng</th><th className={thCls}>Trạng thái</th></tr></thead>
                <tbody>
                  {documents.data.slice(0, 20).map((d) => (
                    <tr key={d.id} className="border-t border-slate-100">
                      <td className={`${tdCls} font-mono text-xs`}>{d.doc_code}</td>
                      <td className={tdCls}>{d.doc_kind}</td>
                      <td className={tdCls}>{formatDate(d.doc_date)}</td>
                      <td className={tdCls}>{formatVND(d.total_amount)}</td>
                      <td className={tdCls}><StatusBadge status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
