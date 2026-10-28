import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import { createStockAdjustmentAction } from "@/lib/actions";
import { getCurrentProfile, listBatchStock, listLocations } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { OWNERSHIP_LABELS, isReadOnlyRole, type AnyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: { ownership?: string; location_kind?: string; ok?: string };
}) {
  const [stock, locations, profile] = await Promise.all([listBatchStock(), listLocations(), getCurrentProfile()]);
  const configured = stock.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
  let rows = stock.data;
  if (searchParams.ownership) rows = rows.filter((r) => r.ownership === searchParams.ownership);
  if (searchParams.location_kind) rows = rows.filter((r) => r.location_kind === searchParams.location_kind);
  const totalQty = rows.reduce((a, r) => a + Number(r.qty), 0);
  const totalValue = rows.reduce((a, r) => a + Number(r.qty) * Number(r.unit_cost), 0);

  const batchOptions = Array.from(new Map(stock.data.map((r) => [r.batch_id, r])).values()).map((r) => ({
    value: r.batch_id,
    label: `${r.batch_code} — ${r.product_name}`,
  }));
  const locationOptions = locations.data.map((l) => ({ value: l.id, label: l.name }));

  return (
    <>
      <PageHeader title="Tồn kho theo lô" description="Tồn kho không bao giờ sửa trực tiếp — mọi thay đổi đều qua sổ cái biến động. Điều chỉnh bên dưới cũng ghi vào sổ cái." />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <select name="ownership" defaultValue={searchParams.ownership ?? ""} className={`${inputCls} w-auto`}>
          <option value="">Tất cả quyền sở hữu</option>
          <option value="OWNED">Tồn kho (OWN)</option>
          <option value="CONSIGNED">Hàng ký gửi (CONS)</option>
        </select>
        <select name="location_kind" defaultValue={searchParams.location_kind ?? ""} className={`${inputCls} w-auto`}>
          <option value="">Tất cả vị trí</option>
          <option value="OWN_WAREHOUSE">Kho TVK</option>
          <option value="PARTNER_VIRTUAL">Kho đối tác</option>
        </select>
        <button className={btnCls} type="submit">Lọc</button>
      </form>

      <p className="mb-3 text-sm text-slate-600">
        Đang hiển thị <strong>{formatNumber(totalQty)}</strong> đơn vị · giá trị tồn <strong>{formatVND(totalValue)}</strong>
        <span className="text-slate-400"> (giá trị ký gửi là hàng giữ hộ nhà cung cấp, không phải vốn của mình)</span>
      </p>

      {rows.length === 0 ? <EmptyState message="Không có dòng tồn kho nào khớp." /> : (
        <TableWrap>
          <thead><tr><th className={thCls}>Lô</th><th className={thCls}>Sản phẩm</th><th className={thCls}>Quyền sở hữu</th><th className={thCls}>Nhập từ</th><th className={thCls}>Vị trí</th><th className={thCls}>Số lượng</th><th className={thCls}>Giá vốn</th><th className={thCls}>Ngày nhập</th><th className={thCls}>Hạn dùng</th><th className={thCls}>Trạng thái</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className={`${tdCls} font-mono text-xs`}>{r.batch_code}</td>
                <td className={tdCls}>{r.product_name}</td>
                <td className={tdCls}>{OWNERSHIP_LABELS[r.ownership] ?? r.ownership}</td>
                <td className={tdCls}>{r.supplier_name ?? "—"}</td>
                <td className={tdCls}>{r.location_name}</td>
                <td className={`${tdCls} font-medium`}>{formatNumber(r.qty)}</td>
                <td className={tdCls}>{formatVND(r.unit_cost)}</td>
                <td className={tdCls}>{formatDate(r.received_date)}</td>
                <td className={tdCls}>{(r as AnyRow).expiry_date ? formatDate((r as AnyRow).expiry_date) : "—"}</td>
                <td className={tdCls}><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {!readOnly && (
      <div className="mt-6 max-w-xl">
        <Card title="Điều chỉnh kiểm kê (ghi vào sổ cái)">
          <form action={createStockAdjustmentAction} className="space-y-3">
            <div>
              <label className={labelCls}>Lô *</label>
              <select name="batch_id" required className={inputCls}>
                <option value="">— Chọn —</option>
                {batchOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Vị trí *</label>
              <select name="location_id" required className={inputCls}>
                <option value="">— Chọn —</option>
                {locationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Chênh lệch số lượng (+ tăng / − giảm) *</label>
              <input name="qty_delta" type="number" required className={inputCls} placeholder="vd. -2" />
            </div>
            <div>
              <label className={labelCls}>Lý do / ghi chú</label>
              <input name="note" className={inputCls} placeholder="Kiểm kê 30/10, kệ B2…" />
            </div>
            <SubmitButton className={`${btnCls} w-full`}>Ghi điều chỉnh</SubmitButton>
          </form>
        </Card>
      </div>
      )}
    </>
  );
}
