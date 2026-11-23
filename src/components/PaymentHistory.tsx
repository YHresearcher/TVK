import { Card, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import { recordSettlementPaymentAction, reversePaymentAction } from "@/lib/actions";
import {
  getReversalLog,
  isReversiblePayment,
  paymentReversalLabel,
  type PaymentWithAllocations,
} from "@/lib/payment-allocations";
import { formatDate, formatVND } from "@/lib/format";
import type { AnyRow } from "@/lib/types";

/**
 * P3 — Lịch sử thanh toán + phân bổ theo ngành, thanh toán đợt chốt sổ
 * (DS) và đảo bút toán. Chỉ hiển thị cho OWNER / ACCOUNTING (bảng
 * payments chỉ cho 2 role này xem theo RLS 0003).
 *
 * - Lịch sử: phiếu thu/chi + các phiếu đảo của chúng, kèm phân bổ từng
 *   ngành (Dầu nhớt / Phụ tùng) và trạng thái đảo.
 * - Thanh toán DS: chỉ ghi settlement_id; trigger tự phân bổ theo dòng.
 * - Đảo bút toán: OWNER + KẾ TOÁN (quyết của chủ 23/11 21:48 — trước
 *   đó chỉ Kế toán theo quyết định kế toán 28/10/2026).
 * - Nhật ký đảo bút toán (P4): mọi phiếu đảo kèm phiếu gốc, số tiền,
 *   lý do, người đảo, thời gian — OWNER và Kế toán đều xem được.
 */
export default function PaymentHistory({
  kind,
  partyKind,
  payments,
  settlements,
  funds,
  role,
  returnTo,
}: {
  kind: "IN" | "OUT";
  partyKind: "PARTNER" | "SUPPLIER";
  payments: PaymentWithAllocations[];
  settlements: AnyRow[];
  funds: AnyRow[];
  role: string | null | undefined;
  returnTo: string;
}) {
  if (role !== "OWNER" && role !== "ACCOUNTING") return null;
  const isIn = kind === "IN";
  const verb = isIn ? "thu tiền" : "chi tiền";

  // Đã thanh toán cho từng đợt chốt sổ (phiếu đảo trừ lại).
  const paidBySettlement = new Map<string, number>();
  for (const p of payments) {
    if (!p.settlement_id) continue;
    const signed = p.reversal_of_id ? -Number(p.amount) : Number(p.amount);
    paidBySettlement.set(p.settlement_id, (paidBySettlement.get(p.settlement_id) ?? 0) + signed);
  }
  const openSettlements = settlements.filter(
    (s) => Number(s.total_amount) - (paidBySettlement.get(String(s.id)) ?? 0) > 0,
  );
  const reversible = payments.filter((p) => isReversiblePayment(p, payments));
  // P4: nhật ký đảo — chỉ phiếu đảo, kèm phiếu gốc/lý do/người đảo/giờ đảo.
  const reversalLog = getReversalLog(payments);

  return (
    <>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title={`Ghi nhận ${verb} đợt chốt sổ (DS)`}>
          {openSettlements.length === 0 ? (
            <p className="text-sm text-slate-500">Chưa có đợt chốt sổ nào còn dư nợ.</p>
          ) : (
            <form action={recordSettlementPaymentAction} className="space-y-3">
              <input type="hidden" name="party_kind" value={partyKind} />
              <div>
                <label className={labelCls}>Đợt chốt sổ còn dư *</label>
                <select name="settlement_id" required className={inputCls}>
                  <option value="">— Chọn —</option>
                  {openSettlements.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.doc_code} — còn {formatVND(Number(s.total_amount) - (paidBySettlement.get(String(s.id)) ?? 0))}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Số tiền *</label>
                  <input name="amount" type="number" step="1000" required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Phương thức</label>
                  <select name="method" className={inputCls}>
                    <option value="BANK">Chuyển khoản</option>
                    <option value="CASH">Tiền mặt</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Quỹ tiền *</label>
                <select name="fund_id" required className={inputCls}>
                  <option value="">— Chọn —</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} — {f.kind === "CASH" ? "Tiền mặt" : "Ngân hàng"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Ngày {isIn ? "thu" : "chi"}</label>
                <input name="payment_date" type="date" className={inputCls} />
              </div>
              <SubmitButton className={`${btnCls} w-full`}>Ghi nhận {verb} đợt chốt sổ</SubmitButton>
              <p className="text-xs text-slate-500">
                Hệ thống tự phân bổ tiền theo từng dòng của đợt chốt sổ (theo thứ tự dòng) và theo ngành hàng.
                Trả vượt tổng dư của đợt sẽ bị chặn.
              </p>
            </form>
          )}
        </Card>

        <Card title="Đảo bút toán thanh toán">
          {reversible.length === 0 ? (
            <p className="text-sm text-slate-500">Chưa có phiếu nào đảo được.</p>
          ) : (
            <form action={reversePaymentAction} className="space-y-3">
              <input type="hidden" name="return_to" value={returnTo} />
              <div>
                <label className={labelCls}>Phiếu cần đảo *</label>
                <select name="payment_id" required className={inputCls}>
                  <option value="">— Chọn —</option>
                  {reversible.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.doc_code} — {p.obligationLabel} — {formatVND(p.amount)} ({formatDate(p.payment_date)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Lý do đảo bút toán *</label>
                <textarea name="reason" required rows={3} className={inputCls} placeholder="VD: Ghi nhầm số tiền, trùng phiếu…" />
              </div>
              <SubmitButton className={`${btnCls} w-full`}>Đảo bút toán</SubmitButton>
              <p className="text-xs text-slate-500">
                Phiếu gốc giữ nguyên — hệ thống tạo phiếu đảo ngược chiều, trừ đúng số tiền đã ghi và trả lại
                công nợ + quỹ. Phiếu đã đảo không đảo lại được. Chủ cửa hàng và Kế toán đều đảo được.
              </p>
            </form>
          )}
        </Card>
      </div>

      {payments.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            Lịch sử {verb} + phân bổ theo ngành
          </h2>
          <TableWrap>
            <thead>
              <tr>
                <th className={thCls}>Mã phiếu</th>
                <th className={thCls}>Ngày</th>
                <th className={thCls}>Đối tượng</th>
                <th className={thCls}>Phân bổ theo ngành</th>
                <th className={`${thCls} text-right`}>Số tiền</th>
                <th className={thCls}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const label = paymentReversalLabel(p, p.reversedByDocCode);
                const signed = p.reversal_of_id ? -p.amount : p.amount;
                return (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                    <td className={`${tdCls} font-mono text-xs font-semibold text-slate-900`}>{p.doc_code}</td>
                    <td className={tdCls}>{formatDate(p.payment_date)}</td>
                    <td className={tdCls}>{p.obligationLabel}</td>
                    <td className={tdCls}>
                      {p.allocationSummary.length === 0
                        ? "—"
                        : p.allocationSummary.map((s) => `${s.lineLabel}: ${formatVND(s.amount)}`).join(" • ")}
                    </td>
                    <td
                      className={`${tdCls} text-right font-mono font-medium ${
                        signed < 0 ? "text-rose-700" : p.payment_kind === "IN" ? "text-emerald-700" : "text-slate-900"
                      }`}
                    >
                      {formatVND(signed)}
                    </td>
                    <td className={tdCls}>{label || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-xs text-slate-500">
            Phiếu đảo không sửa/xoá phiếu gốc — chỉ trừ đúng số tiền của phiếu bị đảo, công nợ và quỹ được trả lại
            tương ứng.
          </p>
        </div>
      )}

      {reversalLog.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Nhật ký đảo bút toán</h2>
          <TableWrap>
            <thead>
              <tr>
                <th className={thCls}>Phiếu đảo</th>
                <th className={thCls}>Phiếu gốc</th>
                <th className={`${thCls} text-right`}>Số tiền</th>
                <th className={thCls}>Lý do</th>
                <th className={thCls}>Người đảo</th>
                <th className={thCls}>Thời gian đảo</th>
              </tr>
            </thead>
            <tbody>
              {reversalLog.map((r) => (
                <tr key={r.reversalId} className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                  <td className={`${tdCls} font-mono text-xs font-semibold text-slate-900`}>{r.reversalCode}</td>
                  <td className={`${tdCls} font-mono text-xs`}>{r.originalCode || "—"}</td>
                  <td className={`${tdCls} text-right font-mono font-medium text-rose-700`}>{formatVND(r.amount)}</td>
                  <td className={tdCls}>{r.reason || "—"}</td>
                  <td className={tdCls}>{r.createdByName ?? "—"}</td>
                  <td className={tdCls}>{r.createdAt ? new Date(r.createdAt).toLocaleString("vi-VN") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-xs text-slate-500">
            Mỗi lần đảo đều ghi lại phiếu gốc, phiếu đảo, số tiền, lý do bắt buộc, người đảo và thời gian — Chủ cửa
            hàng và Kế toán đều xem được ở đây.
          </p>
        </div>
      )}
    </>
  );
}
