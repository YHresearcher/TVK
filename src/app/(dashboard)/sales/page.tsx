import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SalePriceSection from "@/components/SalePriceSection";
import { createCounterSaleAction } from "@/lib/actions";
import { getCurrentProfile, listBatchStock, listPartners, listProducts, listSalesDocuments, listSalesOrders } from "@/lib/queries";
import { formatDate, formatVND } from "@/lib/format";
import { OWNERSHIP_LABELS, isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [orders, documents, partners, batchStock, products, profile] = await Promise.all([
    listSalesOrders(),
    listSalesDocuments(),
    listPartners(),
    listBatchStock(),
    listProducts(),
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
  // Giá theo lô cho ô loại giá: lẻ lấy retail_price, đại lý lấy
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

  return (
    <>
      <PageHeader
        title="Bán hàng (tại quầy)"
        description="Chọn đúng các lô được bán. Lô của mình đi vào chứng từ BH; lô ký gửi đi vào chứng từ KG và tự động tạo khoản phải trả cho nhà cung cấp của lô đó theo giá ký gửi của lô. Giảm giá chỉ áp dụng cho phần BH."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã bán xong — chứng từ đã xác nhận, tồn kho và công nợ đã cập nhật.</p>}
      <div className="space-y-6">
        {!readOnly && (
        <Card title="Bán hàng mới">
          <form action={createCounterSaleAction} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div><label className={labelCls}>Đối tác (không bắt buộc)</label>
                <select name="partner_id" className={inputCls}><option value="">— Khách lẻ —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div><label className={labelCls}>Tên khách hàng</label><input name="customer_name" className={inputCls} /></div>
              <div><label className={labelCls}>Giảm giá cho phần BH (₫)</label><input name="discount_amount" type="number" step="1000" defaultValue="0" className={inputCls} /></div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="is_credit" className="h-4 w-4" /> Bán chịu (tạo phải thu)
                </label>
              </div>
            </div>
            <SalePriceSection batchOptions={batchOptions} batchPrices={batchPrices} />
            <button type="submit" className={btnCls}>Hoàn tất bán hàng</button>
          </form>
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
