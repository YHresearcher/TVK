import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import ItemsRows from "@/components/ItemsRows";
import { confirmReturnAction, createReturnAction } from "@/lib/actions";
import { getCurrentProfile, listBatchStock, listPartners, listReturnDocuments, listSuppliers } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { OWNERSHIP_LABELS, RETURN_KINDS, RETURN_KIND_LABELS, RETURN_REASONS, RETURN_REASON_LABELS, isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [docs, batchStock, partners, suppliers, profile] = await Promise.all([
    listReturnDocuments(),
    listBatchStock(),
    listPartners(),
    listSuppliers(),
    getCurrentProfile(),
  ]);
  const configured = docs.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
  const partnerName = new Map(partners.data.map((p) => [p.id, p.name]));
  const supplierName = new Map(suppliers.data.map((s) => [s.id, s.name]));
  const partnerOptions = partners.data.map((p) => ({ value: p.id, label: p.name }));
  const supplierOptions = suppliers.data.map((s) => ({ value: s.id, label: s.name }));
  const allBatches = Array.from(new Map(batchStock.data.map((r) => [r.batch_id, r])).values());
  const batchOptions = allBatches.map((r) => ({
    value: r.batch_id,
    label: `${r.batch_code} — ${r.product_name} · ${OWNERSHIP_LABELS[r.ownership] ?? r.ownership} · tại ${r.location_name}`,
  }));

  return (
    <>
      <PageHeader
        title="Trả hàng & bảo hành (TH)"
        description="Hàng trả luôn quay về đúng lô GỐC của nó, để nhà cung cấp và giá vốn vẫn truy vết được. Nếu một lô ký gửi bị trả đã bán nhưng khoản phải trả chưa thanh toán, Kế toán huỷ khoản phải trả đó; nếu đã thanh toán, sẽ trừ vào đợt đối soát tiếp theo."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      <div className="space-y-6">
        {!readOnly && (
        <Card title="Phiếu trả hàng mới">
          <form action={createReturnAction} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div><label className={labelCls}>Loại trả hàng *</label>
                <select name="return_kind" required className={inputCls}>
                  {RETURN_KINDS.map((k) => <option key={k} value={k}>{RETURN_KIND_LABELS[k] ?? k}</option>)}
                </select></div>
              <div><label className={labelCls}>Đối tác (khách / đối tác trả)</label>
                <select name="partner_id" className={inputCls}><option value="">— Chọn —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div><label className={labelCls}>Nhà cung cấp (trả nhà cung cấp)</label>
                <select name="supplier_id" className={inputCls}><option value="">— Chọn —</option>{supplierOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
            </div>
            <ItemsRows fields={[
              { name: "batch_id", label: "Lô gốc", type: "select", options: batchOptions },
              { name: "qty", label: "Số lượng", type: "number" },
              { name: "reason", label: "Lý do", type: "select", options: RETURN_REASONS.map((r) => ({ value: r, label: RETURN_REASON_LABELS[r] ?? r })) },
            ]} initialRows={1} />
            <p className="text-xs text-slate-500">Vị trí được tự động xác định: khách trả vào kho đầu tiên của mình, đối tác trả di chuyển từ kho ảo của đối tác về kho của mình, trả nhà cung cấp xuất khỏi hệ thống từ kho của mình.</p>
            <button type="submit" className={btnCls}>Tạo phiếu trả nháp</button>
          </form>
        </Card>
        )}

        {docs.data.length === 0 ? <EmptyState message="Chưa có phiếu trả hàng." /> : (
          <TableWrap>
            <thead><tr><th className={thCls}>Mã</th><th className={thCls}>Loại</th><th className={thCls}>Bên liên quan</th><th className={thCls}>Ngày</th><th className={thCls}>Trạng thái</th><th className={thCls}></th></tr></thead>
            <tbody>
              {docs.data.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className={`${tdCls} font-mono text-xs`}>{d.doc_code}</td>
                  <td className={tdCls}>{RETURN_KIND_LABELS[d.return_kind] ?? d.return_kind}</td>
                  <td className={tdCls}>{d.partner_id ? partnerName.get(d.partner_id) : d.supplier_id ? supplierName.get(d.supplier_id) : "—"}</td>
                  <td className={tdCls}>{formatDate(d.return_date)}</td>
                  <td className={tdCls}><StatusBadge status={d.status} /></td>
                  <td className={tdCls}>
                    {d.status === "DRAFT" && !readOnly && (
                      <form action={confirmReturnAction}>
                        <input type="hidden" name="id" value={d.id} />
                        <button type="submit" className={btnGhostCls}>Xác nhận → di chuyển hàng</button>
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
