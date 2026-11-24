import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import NoBusinessLineNotice from "@/components/NoBusinessLineNotice";
import { createStockAdjustmentAction } from "@/lib/actions";
import { getBusinessLineContext } from "@/lib/business-lines";
import { getCurrentProfile, listBatchStock, listBatchesForSales, listLocations } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { BUSINESS_LINE_LABELS, OWNERSHIP_LABELS, isReadOnlyRole, type AnyRow, type BusinessLineCode } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Phân loại hạn dùng theo §7.3 (chỉ có ý nghĩa với lô dầu nhớt). */
function expiryStatus(expiry: string | null | undefined, todayIso: string, in30Iso: string) {
  const e = expiry ? String(expiry).slice(0, 10) : null;
  if (!e) return { kind: "none" as const, date: null };
  if (e < todayIso) return { kind: "expired" as const, date: e };
  if (e <= in30Iso) return { kind: "soon" as const, date: e };
  return { kind: "valid" as const, date: e };
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: { ownership?: string; location_kind?: string; ok?: string };
}) {
  const profile = await getCurrentProfile();
  const isSales = profile.data?.role === "SALES";
  // P2: tồn kho đã lọc theo ngành qua view (v_batch_stock /
  // v_batches_for_sales) — trang chỉ hiển thị thêm nhãn ngành + cảnh
  // báo hạn dùng.
  const ctx = await getBusinessLineContext();
  const [stock, locations] = await Promise.all([isSales ? listBatchesForSales() : listBatchStock(), listLocations()]);
  const configured = stock.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
  let rows = stock.data;
  if (searchParams.ownership) rows = rows.filter((r) => r.ownership === searchParams.ownership);
  if (searchParams.location_kind) rows = rows.filter((r) => r.location_kind === searchParams.location_kind);
  const totalQty = rows.reduce((a, r) => a + Number(r.qty), 0);
  const totalValue = rows.reduce((a, r) => a + Number(r.qty) * Number(r.unit_cost), 0);
  const todayIso = new Date().toISOString().slice(0, 10);
  const in30Iso = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const expiredCount = rows.filter((r) => expiryStatus((r as AnyRow).expiry_date, todayIso, in30Iso).kind === "expired").length;
  const soonCount = rows.filter((r) => expiryStatus((r as AnyRow).expiry_date, todayIso, in30Iso).kind === "soon").length;

  const batchOptions = Array.from(new Map(stock.data.map((r) => [r.batch_id, r])).values()).map((r) => ({
    value: r.batch_id,
    label: `${r.batch_code} — ${r.product_name}`,
  }));
  const locationOptions = locations.data.map((l) => ({ value: l.id, label: l.name }));

  return (
    <>
      <PageHeader title="Tồn kho theo lô" description="Số tồn kho không sửa tay được — muốn đổi số thì làm phiếu nhập/xuất, hệ thống tự ghi lại. Kiểm kho bên dưới cũng được ghi lại." />
      {!configured && <NotConfigured />}
      {ctx.mode === "NONE" && <NoBusinessLineNotice />}
      {ctx.mode !== "NONE" && searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      {ctx.mode === "NONE" ? null : (
      <>
      {(expiredCount > 0 || soonCount > 0) && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {expiredCount > 0 && (
            <p>Có {formatNumber(expiredCount)} lô đã hết hạn — không được bán, cần xử lý trước khi bán.</p>
          )}
          {soonCount > 0 && (
            <p>Có {formatNumber(soonCount)} lô sắp hết hạn trong 30 ngày — ưu tiên bán trước (hạn gần nhất trước).</p>
          )}
        </div>
      )}
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <select name="ownership" defaultValue={searchParams.ownership ?? ""} className={`${inputCls} w-auto`}>
          <option value="">Tất cả sở hữu</option>
          <option value="OWNED">Hàng hoá của TVK (OWN)</option>
          <option value="CONSIGNED">Hàng được ký gửi (CONS)</option>
        </select>
        <select name="location_kind" defaultValue={searchParams.location_kind ?? ""} className={`${inputCls} w-auto`}>
          <option value="">Tất cả vị trí</option>
          <option value="OWN_WAREHOUSE">Kho TVK</option>
          <option value="PARTNER_VIRTUAL">Kho đối tác</option>
        </select>
        <button className={btnCls} type="submit">Lọc</button>
      </form>

      <p className="mb-3 text-sm text-slate-600">
        Đang hiển thị <strong>{formatNumber(totalQty)}</strong> đơn vị{!isSales && (<> · giá trị tồn <strong>{formatVND(totalValue)}</strong></>)}
        {!isSales && (<span className="text-slate-400"> (hàng được ký gửi không phải vốn của mình)</span>)}
      </p>

      {rows.length === 0 ? <EmptyState message="Không có dòng tồn kho nào khớp." /> : (
        <TableWrap>
          <thead><tr><th className={thCls}>Lô</th><th className={thCls}>Sản phẩm</th><th className={thCls}>Ngành</th><th className={thCls}>Sở hữu</th><th className={thCls}>Nhập từ</th><th className={thCls}>Vị trí</th><th className={thCls}>Số lượng</th>{!isSales && (<th className={thCls}>Giá vốn</th>)}<th className={thCls}>Ngày nhập</th><th className={thCls}>Hạn dùng</th><th className={thCls}>Trạng thái</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className={`${tdCls} font-mono text-xs`}>{r.batch_code}</td>
                <td className={tdCls}>{r.product_name}</td>
                <td className={tdCls}>{BUSINESS_LINE_LABELS[(r as AnyRow).business_line_code as BusinessLineCode] ?? "—"}</td>
                <td className={tdCls}>{OWNERSHIP_LABELS[r.ownership] ?? r.ownership}</td>
                <td className={tdCls}>{r.supplier_name ?? "—"}</td>
                <td className={tdCls}>{r.location_name}</td>
                <td className={`${tdCls} font-medium`}>{formatNumber(r.qty)}</td>
                {!isSales && (<td className={tdCls}>{formatVND(r.unit_cost)}</td>)}
                <td className={tdCls}>{formatDate(r.received_date)}</td>
                <td className={tdCls}>
                  {(() => {
                    const s = expiryStatus((r as AnyRow).expiry_date, todayIso, in30Iso);
                    if (s.kind === "none") return "—";
                    if (s.kind === "expired") return <span className="font-medium text-red-700">Hết hạn {formatDate(s.date)}</span>;
                    if (s.kind === "soon") return <span className="font-medium text-amber-700">Sắp hết {formatDate(s.date)}</span>;
                    return formatDate(s.date);
                  })()}
                </td>
                <td className={tdCls}><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {!readOnly && (
      <div className="mt-6 max-w-xl">
        <Card title="Kiểm kho và sửa số tồn (hệ thống tự ghi lại)">
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
      )}
    </>
  );
}
