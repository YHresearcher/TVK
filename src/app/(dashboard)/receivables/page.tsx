import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { createSettlementAction, recordReceivablePaymentAction } from "@/lib/actions";
import { getCurrentProfile, listPartners, listReceivables, listSettlements } from "@/lib/queries";
import { formatDate, formatVND } from "@/lib/format";
import { isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [receivables, settlements, partners, profile] = await Promise.all([
    listReceivables(),
    listSettlements(),
    listPartners(),
    getCurrentProfile(),
  ]);
  const configured = receivables.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
  const partnerName = new Map(partners.data.map((p) => [p.id, p.name]));
  const open = receivables.data.filter((r) => r.status === "UNPAID" || r.status === "PARTIAL");
  const totalOutstanding = open.reduce((a, r) => a + Number(r.amount) - Number(r.amount_paid), 0);
  const partnerSettlements = settlements.data.filter((s) => s.party_kind === "PARTNER");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Phải thu đối tác" description="Được tạo tự động khi xác nhận một giao dịch ghi nợ hoặc một chứng từ tiêu thụ của đối tác (BH/KG). Số tiền BH là sau giảm giá; số tiền KG dùng giá chuyển giao đã thoả thuận." />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      <p className="mb-4 text-sm text-slate-600">Tổng còn phải thu: <strong>{formatVND(totalOutstanding)}</strong></p>

      {receivables.data.length === 0 ? <EmptyState message="Chưa có khoản phải thu." /> : (
        <TableWrap>
          <thead><tr><th className={thCls}>Đối tác</th><th className={thCls}>Số tiền</th><th className={thCls}>Đã thu</th><th className={thCls}>Còn phải thu</th><th className={thCls}>Hạn thu</th><th className={thCls}>Trạng thái</th></tr></thead>
          <tbody>
            {receivables.data.map((r) => {
              const overdue = r.due_date && r.due_date < today && (r.status === "UNPAID" || r.status === "PARTIAL");
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className={tdCls}>{partnerName.get(r.partner_id) ?? "—"}</td>
                  <td className={tdCls}>{formatVND(r.amount)}</td>
                  <td className={tdCls}>{formatVND(r.amount_paid)}</td>
                  <td className={`${tdCls} font-medium`}>{formatVND(Number(r.amount) - Number(r.amount_paid))}</td>
                  <td className={`${tdCls} ${overdue ? "font-semibold text-red-600" : ""}`}>{formatDate(r.due_date)}{overdue ? " (quá hạn)" : ""}</td>
                  <td className={tdCls}><StatusBadge status={r.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}

      {!readOnly && (
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Ghi nhận tiền thu từ đối tác (PT)">
          <form action={recordReceivablePaymentAction} className="space-y-3">
            <div><label className={labelCls}>Khoản phải thu đang mở *</label>
              <select name="receivable_id" required className={inputCls}>
                <option value="">— Chọn —</option>
                {open.map((r) => (
                  <option key={r.id} value={r.id}>
                    {partnerName.get(r.partner_id)} — còn phải thu {formatVND(Number(r.amount) - Number(r.amount_paid))}
                  </option>
                ))}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Số tiền *</label><input name="amount" type="number" step="1000" required className={inputCls} /></div>
              <div><label className={labelCls}>Phương thức</label>
                <select name="method" className={inputCls}><option value="BANK">Chuyển khoản</option><option value="CASH">Tiền mặt</option></select></div>
            </div>
            <div><label className={labelCls}>Ngày thu</label><input name="payment_date" type="date" className={inputCls} /></div>
            <button type="submit" className={`${btnCls} w-full`}>Ghi nhận thu tiền</button>
          </form>
        </Card>

        <Card title="Tạo đợt đối soát (DS) cho một đối tác">
          <form action={createSettlementAction} className="space-y-3">
            <input type="hidden" name="party_kind" value="PARTNER" />
            <div><label className={labelCls}>Đối tác *</label>
              <select name="partner_id" required className={inputCls}>
                <option value="">— Chọn —</option>
                {partners.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Từ ngày</label><input name="period_from" type="date" className={inputCls} /></div>
              <div><label className={labelCls}>Đến ngày</label><input name="period_to" type="date" className={inputCls} /></div>
            </div>
            <div className="space-y-1">
              <p className={labelCls}>Các khoản phải thu đang mở đưa vào đối soát (của đối tác ở trên)</p>
              {open.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="receivable_id" value={r.id} className="h-4 w-4" />
                  {partnerName.get(r.partner_id)} — còn phải thu {formatVND(Number(r.amount) - Number(r.amount_paid))}, hạn {formatDate(r.due_date)}
                </label>
              ))}
            </div>
            <button type="submit" className={`${btnCls} w-full`}>Tạo đối soát</button>
          </form>
        </Card>
      </div>
      )}

      {partnerSettlements.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Các đợt đối soát</h2>
          <TableWrap>
            <thead><tr><th className={thCls}>Mã</th><th className={thCls}>Đối tác</th><th className={thCls}>Kỳ</th><th className={thCls}>Tổng</th><th className={thCls}>Trạng thái</th></tr></thead>
            <tbody>
              {partnerSettlements.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className={`${tdCls} font-mono text-xs`}>{s.doc_code}</td>
                  <td className={tdCls}>{partnerName.get(s.partner_id) ?? "—"}</td>
                  <td className={tdCls}>{formatDate(s.period_from)} → {formatDate(s.period_to)}</td>
                  <td className={tdCls}>{formatVND(s.total_amount)}</td>
                  <td className={tdCls}><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}
    </>
  );
}
