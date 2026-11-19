import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import AgingTable from "@/components/AgingTable";
import { buildAging } from "@/lib/aging";
import { createSettlementAction, recordPayablePaymentAction } from "@/lib/actions";
import { getCurrentProfile, listCashFunds, listPayables, listPurchaseReceipts, listSalesDocuments, listSettlements, listSuppliers } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PayablesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [payables, settlements, suppliers, salesDocs, purchaseReceipts, funds, profile] = await Promise.all([
    listPayables(),
    listSettlements(),
    listSuppliers(),
    listSalesDocuments(),
    listPurchaseReceipts(),
    listCashFunds(),
    getCurrentProfile(),
  ]);
  const configured = payables.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
  const supplierName = new Map(suppliers.data.map((s) => [s.id, s.name]));
  const activeFunds = funds.data.filter((f) => f.is_active);
  const hasBankFund = activeFunds.some((f) => f.kind === "BANK");
  // Mã chứng từ gốc của từng khoản phải trả: khoản mua hàng -> phiếu nhập
  // (PN-...), khoản ký gửi đã bán -> chứng từ bán (BH/KG-...).
  const salesDocCode = new Map(salesDocs.data.map((d) => [d.id, d.doc_code]));
  const purchaseReceiptCode = new Map(purchaseReceipts.data.map((r) => [r.id, r.doc_code]));
  const sourceLabel = (p: (typeof payables.data)[number]) =>
    p.source_kind === "PURCHASE"
      ? (purchaseReceiptCode.get(p.purchase_receipt_id) ?? "Phiếu nhập")
      : (salesDocCode.get(p.source_document_id) ?? "—");
  const open = payables.data.filter((p) => p.status === "UNPAID" || p.status === "PARTIAL");
  const totalOutstanding = open.reduce((a, p) => a + Number(p.amount) - Number(p.amount_paid), 0);
  const supplierSettlements = settlements.data.filter((s) => s.party_kind === "SUPPLIER");

  return (
    <>
      <PageHeader title="Phải trả nhà cung cấp" description="Khoản phải trả được tạo tự động theo 2 cách: khi một lô ký gửi bán được (theo đúng giá ký gửi đã thoả thuận của lô đó), và khi xác nhận phiếu nhập mua hàng (bằng tổng tiền phiếu, hạn trả theo số ngày trả của nhà cung cấp đó). Giảm giá cho khách hàng không bao giờ thay đổi các số tiền này." />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      <p className="mb-4 text-sm text-slate-600">Tổng còn nợ: <strong>{formatVND(totalOutstanding)}</strong></p>

      {open.length > 0 && (
        <div className="mb-4">
          <AgingTable
            title="Tuổi nợ phải trả"
            partyLabel="Nhà cung cấp"
            rows={buildAging(
              open.map((p) => ({ partyId: p.supplier_id, due_date: p.due_date, amount: p.amount, amount_paid: p.amount_paid })),
              supplierName,
            )}
          />
        </div>
      )}

      {payables.data.length === 0 ? <EmptyState message="Chưa có khoản phải trả. Xác nhận một phiếu nhập mua hàng hoặc bán một lô ký gửi để tạo khoản phải trả." /> : (
        <TableWrap>
          <thead><tr><th className={thCls}>Nhà cung cấp</th><th className={thCls}>Chứng từ</th><th className={`${thCls} text-right`}>Số lượng</th><th className={`${thCls} text-right`}>Giá ký gửi</th><th className={`${thCls} text-right`}>Số tiền</th><th className={`${thCls} text-right`}>Đã trả</th><th className={`${thCls} text-right`}>Còn nợ</th><th className={thCls}>Hạn trả</th><th className={thCls}>Trạng thái</th></tr></thead>
          <tbody>
            {payables.data.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td className={tdCls}>{supplierName.get(p.supplier_id) ?? "—"}</td>
                <td className={`${tdCls} font-mono text-xs`}>{sourceLabel(p)}</td>
                <td className={`${tdCls} text-right font-mono`}>{p.qty == null ? "—" : formatNumber(p.qty)}</td>
                <td className={`${tdCls} text-right font-mono`}>{p.unit_price == null ? "—" : formatVND(p.unit_price)}</td>
                <td className={`${tdCls} text-right font-mono font-medium text-slate-900`}>{formatVND(p.amount)}</td>
                <td className={`${tdCls} text-right font-mono text-emerald-700`}>{formatVND(p.amount_paid)}</td>
                <td className={`${tdCls} text-right font-mono font-medium text-rose-700`}>{formatVND(Number(p.amount) - Number(p.amount_paid))}</td>
                <td className={tdCls}>{formatDate(p.due_date)}</td>
                <td className={tdCls}><StatusBadge status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {!readOnly && (
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Ghi nhận thanh toán cho nhà cung cấp (PC)">
          <form action={recordPayablePaymentAction} className="space-y-3">
            <div><label className={labelCls}>Khoản phải trả đang mở *</label>
              <select name="payable_id" required className={inputCls}>
                <option value="">— Chọn —</option>
                {open.map((p) => (
                  <option key={p.id} value={p.id}>
                    {supplierName.get(p.supplier_id)} — {sourceLabel(p)} — còn nợ {formatVND(Number(p.amount) - Number(p.amount_paid))}
                  </option>
                ))}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Số tiền *</label><input name="amount" type="number" step="1000" required className={inputCls} /></div>
              <div><label className={labelCls}>Phương thức</label>
                <select name="method" className={inputCls}><option value="BANK">Chuyển khoản</option><option value="CASH">Tiền mặt</option></select></div>
            </div>
            <div><label className={labelCls}>Quỹ tiền *</label>
              <select name="fund_id" required className={inputCls}>
                <option value="">— Chọn —</option>
                {activeFunds.map((f) => (
                  <option key={f.id} value={f.id}>{f.name} — {f.kind === "CASH" ? "Tiền mặt" : "Ngân hàng"}</option>
                ))}
              </select>
              {!hasBankFund && <p className="mt-1 text-xs text-slate-500">Chưa có tài khoản ngân hàng — thêm ở Cài đặt → Quỹ tiền.</p>}
            </div>
            <div><label className={labelCls}>Ngày thanh toán</label><input name="payment_date" type="date" className={inputCls} /></div>
            <SubmitButton className={`${btnCls} w-full`}>Ghi nhận thanh toán</SubmitButton>
          </form>
        </Card>

        <Card title="Tạo đợt chốt sổ (DS) cho một nhà cung cấp">
          <form action={createSettlementAction} className="space-y-3">
            <input type="hidden" name="party_kind" value="SUPPLIER" />
            <div><label className={labelCls}>Nhà cung cấp *</label>
              <select name="supplier_id" required className={inputCls}>
                <option value="">— Chọn —</option>
                {suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Từ ngày</label><input name="period_from" type="date" className={inputCls} /></div>
              <div><label className={labelCls}>Đến ngày</label><input name="period_to" type="date" className={inputCls} /></div>
            </div>
            <div className="space-y-1">
              <p className={labelCls}>Các khoản phải trả chưa trả hết đưa vào đợt chốt sổ (của nhà cung cấp ở trên)</p>
              {open.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="payable_id" value={p.id} className="h-4 w-4" />
                  {supplierName.get(p.supplier_id)} — {sourceLabel(p)} — còn nợ {formatVND(Number(p.amount) - Number(p.amount_paid))}, hạn {formatDate(p.due_date)}
                </label>
              ))}
            </div>
            <SubmitButton className={`${btnCls} w-full`}>Tạo đợt chốt sổ</SubmitButton>
          </form>
        </Card>
      </div>
      )}

      {supplierSettlements.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Các đợt chốt sổ</h2>
          <TableWrap>
            <thead><tr><th className={thCls}>Mã</th><th className={thCls}>Nhà cung cấp</th><th className={thCls}>Kỳ</th><th className={`${thCls} text-right`}>Tổng</th><th className={thCls}>Trạng thái</th></tr></thead>
            <tbody>
              {supplierSettlements.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                  <td className={`${tdCls} font-mono text-xs font-semibold text-slate-900`}>{s.doc_code}</td>
                  <td className={tdCls}>{supplierName.get(s.supplier_id) ?? "—"}</td>
                  <td className={tdCls}>{formatDate(s.period_from)} → {formatDate(s.period_to)}</td>
                  <td className={`${tdCls} text-right font-mono font-medium text-slate-900`}>{formatVND(s.total_amount)}</td>
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
