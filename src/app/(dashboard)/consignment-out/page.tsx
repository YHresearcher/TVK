import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import ItemsRows from "@/components/ItemsRows";
import { confirmConsignmentOutAction, createConsignmentOutAction } from "@/lib/actions";
import { listBatchStock, listConsignmentOutSlips, listPartners } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { OWNERSHIP_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ConsignmentOutPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [slips, partners, batchStock] = await Promise.all([
    listConsignmentOutSlips(),
    listPartners(),
    listBatchStock(),
  ]);
  const configured = slips.configured;
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

  return (
    <>
      <PageHeader
        title="Gửi ký gửi (GK)"
        description="Gửi hàng cho đối tác chỉ thay đổi nơi giữ hàng — quyền sở hữu vẫn của mình, chưa ghi doanh thu và chưa ghi phải thu cho tới khi đối tác báo tiêu thụ. Gửi tiếp lô của nhà cung cấp (ô D) bị chặn trừ khi nhà cung cấp đó cho phép."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      <div className="space-y-6">
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
              { name: "batch_id", label: "Lô (tại kho của mình)", type: "select", options: batchOptions },
              { name: "qty", label: "Số lượng", type: "number" },
              { name: "term", label: "Điều khoản", type: "select", options: [
                { value: "CONSIGNMENT", label: "Ký gửi (CONSIGNMENT)" },
                { value: "PURCHASE", label: "Mua đứt, xuất hoá đơn sau (PURCHASE)" },
              ] },
              { name: "transfer_price", label: "Giá chuyển giao / giá thoả thuận (₫)", type: "number", step: "1000" },
            ]} initialRows={2} />
            <p className="text-xs text-slate-500">Kho nguồn được tự động xác định từ vị trí hiện tại của lô. Điều khoản quyết định hạn mức phân bổ sau này (vd. tối đa 5 MUA ĐỨT / 10 KÝ GỬI).</p>
            <button type="submit" className={btnCls}>Tạo phiếu nháp</button>
          </form>
        </Card>

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
                    {s.status === "DRAFT" && (
                      <form action={confirmConsignmentOutAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className={btnGhostCls}>Xác nhận → chuyển hàng tới đối tác</button>
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
