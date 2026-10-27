import { EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, tdCls, thCls } from "@/components/ui";
import CounterSaleTabs from "@/components/CounterSaleTabs";
import { createCounterSaleAction } from "@/lib/actions";
import { buildProductCodeMap, getCurrentProfile, listBatchStock, listPartners, listProductCodes, listProducts, listSalesDocuments, listSalesOrders } from "@/lib/queries";
import { formatDate, formatVND } from "@/lib/format";
import { OWNERSHIP_LABELS, isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [orders, documents, partners, batchStock, products, productCodes, profile] = await Promise.all([
    listSalesOrders(),
    listSalesDocuments(),
    listPartners(),
    listBatchStock(),
    listProducts(),
    listProductCodes(),
    getCurrentProfile(),
  ]);
  const configured = orders.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
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
    label: `${r.batch_code} — ${r.product_name} · ${OWNERSHIP_LABELS[r.ownership] ?? r.ownership} · tại ${r.location_name}`,
  }));
  // Giá theo lô cho 2 tab: lẻ lấy retail_price, đại lý lấy
  // wholesale_price của sản phẩm trong lô.
  const productById = new Map(
    products.data.map((p) => [p.id, p])
  );
  const batchPrices: Record<string, { retail: number; wholesale: number }> = {};
  for (const r of ownBatches) {
    const p = productById.get(r.product_id);
    if (p) {
      batchPrices[r.batch_id] = {
        retail: Number(p.retail_price) || 0,
        wholesale: Number(p.wholesale_price) || 0,
      };
    }
  }

  // Quét mã ở tab Bán lẻ: mã hàng (SKU hoặc mã đã đăng ký) → lô FIFO của
  // sản phẩm đó: lô cũ nhất (received_date, rồi mã lô) còn hàng tại kho
  // của mình. Giá quét theo giá lẻ; số lượng quét lại cộng dồn tối đa bằng
  // tồn kho của lô FIFO. Mã có thật nhưng hết hàng thì báo hết hàng.
  const codeMap = buildProductCodeMap(products.data, productCodes.data);
  const ownQtyByBatch = new Map<string, number>();
  for (const r of batchStock.data) {
    if (r.location_kind !== "OWN_WAREHOUSE") continue;
    ownQtyByBatch.set(
      r.batch_id,
      (ownQtyByBatch.get(r.batch_id) ?? 0) + (Number(r.qty) || 0)
    );
  }
  const fifoByProduct = new Map<string, (typeof ownBatches)[number]>();
  for (const r of [...ownBatches].sort(
    (a, b) =>
      String(a.received_date).localeCompare(String(b.received_date)) ||
      String(a.batch_code).localeCompare(String(b.batch_code))
  )) {
    if (
      !fifoByProduct.has(r.product_id) &&
      (ownQtyByBatch.get(r.batch_id) ?? 0) > 0
    ) {
      fifoByProduct.set(r.product_id, r);
    }
  }
  const retailScanPick = {
    selectField: "batch_id",
    picks: Object.fromEntries(
      Object.entries(codeMap)
        .map(([code, productId]) => {
          const fifo = fifoByProduct.get(productId);
          return fifo ? [code, fifo.batch_id] : null;
        })
        .filter((e): e is [string, string] => e !== null)
    ),
    prices: Object.fromEntries(
      Object.entries(codeMap)
        .map(([code, productId]) => {
          const fifo = fifoByProduct.get(productId);
          return fifo ? [code, batchPrices[fifo.batch_id]?.retail ?? 0] : null;
        })
        .filter((e): e is [string, number] => e !== null)
    ),
    priceField: "unit_price",
    maxQty: Object.fromEntries(
      Object.entries(codeMap)
        .map(([code, productId]) => {
          const fifo = fifoByProduct.get(productId);
          return fifo
            ? [code, ownQtyByBatch.get(fifo.batch_id) ?? 0]
            : null;
        })
        .filter((e): e is [string, number] => e !== null)
    ),
    known: Object.fromEntries(Object.keys(codeMap).map((k) => [k, true])),
  };

  return (
    <>
      <PageHeader
        title="Bán hàng (tại quầy)"
        description="Hai tab riêng: Bán lẻ dùng giá lẻ, Bán đại lý dùng giá đại lý. Chọn đúng các lô được bán. Lô của mình đi vào chứng từ BH; lô ký gửi đi vào chứng từ KG và tự động tạo khoản phải trả cho nhà cung cấp của lô đó theo giá ký gửi của lô. Giảm giá chỉ áp dụng cho phần BH."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã bán xong — chứng từ đã xác nhận, tồn kho và công nợ đã cập nhật.</p>}
      <div className="space-y-6">
        {!readOnly && (
          <CounterSaleTabs
            batchOptions={batchOptions}
            batchPrices={batchPrices}
            partnerOptions={partnerOptions}
            action={createCounterSaleAction}
            retailScanPick={retailScanPick}
          />
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
