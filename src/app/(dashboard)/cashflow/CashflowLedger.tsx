/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMemo, useState, useTransition } from "react";
import { formatDate, formatVND } from "@/lib/format";
import { inputCls, labelCls, btnGhostCls } from "@/components/ui";
import { cancelCashMovementAction } from "@/lib/actions";
import type { UnifiedCashMovementRow } from "@/lib/queries";
import type { AnyRow } from "@/lib/types";

interface CashflowLedgerProps {
  movements: UnifiedCashMovementRow[];
  funds: AnyRow[];
  isOwner: boolean;
}

export default function CashflowLedger({
  movements,
  funds,
  isOwner,
}: CashflowLedgerProps) {
  const [selectedFund, setSelectedFund] = useState<string>("ALL");
  const [selectedKind, setSelectedKind] = useState<string>("ALL");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modal huỷ phiếu
  const [cancellingItem, setCancellingItem] = useState<UnifiedCashMovementRow | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Lọc dữ liệu client-side nhanh chóng
  const filtered = useMemo(() => {
    return movements.filter((m) => {
      if (selectedFund !== "ALL" && m.fund_id !== selectedFund) return false;

      if (selectedKind !== "ALL") {
        if (selectedKind === "DEBT_IN") {
          if (m.movement_kind !== "DEBT_PAYMENT" || m.amount <= 0) return false;
        } else if (selectedKind === "DEBT_OUT") {
          if (m.movement_kind !== "DEBT_PAYMENT" || m.amount >= 0) return false;
        } else if (selectedKind === "OPERATING_IN") {
          if (m.movement_kind !== "OPERATING" || m.amount <= 0) return false;
        } else if (selectedKind === "OPERATING_OUT") {
          if (m.movement_kind !== "OPERATING" || m.amount >= 0) return false;
        } else if (selectedKind === "INTERNAL_TRANSFER") {
          if (m.movement_kind !== "INTERNAL_TRANSFER") return false;
        } else if (selectedKind === "REVERSAL") {
          if (m.movement_kind !== "REVERSAL") return false;
        }
      }

      if (fromDate && m.movement_date < fromDate) return false;
      if (toDate && m.movement_date > toDate) return false;

      if (searchQuery.trim().length > 0) {
        const q = searchQuery.trim().toLowerCase();
        const doc = m.payment_doc_code?.toLowerCase() || "";
        const note = m.note?.toLowerCase() || "";
        const cat = m.category_name?.toLowerCase() || "";
        const fund = m.fund_name.toLowerCase();
        const rsn = m.cancel_reason?.toLowerCase() || "";
        if (!doc.includes(q) && !note.includes(q) && !cat.includes(q) && !fund.includes(q) && !rsn.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [movements, selectedFund, selectedKind, fromDate, toDate, searchQuery]);

  // Tổng hợp nhanh các dòng được lọc
  const totalIn = filtered
    .filter((m) => !m.is_cancelled && m.amount > 0 && m.movement_kind !== "INTERNAL_TRANSFER" && m.movement_kind !== "REVERSAL")
    .reduce((sum, m) => sum + m.amount, 0);

  const totalOut = filtered
    .filter((m) => !m.is_cancelled && m.amount < 0 && m.movement_kind !== "INTERNAL_TRANSFER" && m.movement_kind !== "REVERSAL")
    .reduce((sum, m) => sum + Math.abs(m.amount), 0);

  const netFiltered = totalIn - totalOut;

  const handleOpenCancel = (item: UnifiedCashMovementRow) => {
    setCancellingItem(item);
    setCancelReason("");
    setErrorMsg(null);
  };

  const handleCloseCancel = () => {
    setCancellingItem(null);
    setCancelReason("");
    setErrorMsg(null);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Header & Filter Bar */}
      <div className="border-b border-slate-100 pb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Sổ Nhật Ký Giao Dịch Ngân Quỹ Hợp Nhất
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Gộp toàn diện giao dịch: Thu/Chi công nợ, Thu/Chi vận hành, Chuyển quỹ nội bộ và Bút toán đảo huỷ.
            </p>
          </div>

          {/* KPI tóm tắt trong bộ lọc */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-800 font-semibold border border-emerald-200">
              Thu: +{formatVND(totalIn)} đ
            </span>
            <span className="rounded-lg bg-rose-50 px-2.5 py-1 text-rose-800 font-semibold border border-rose-200">
              Chi: -{formatVND(totalOut)} đ
            </span>
            <span className={`rounded-lg px-2.5 py-1 font-bold border ${
              netFiltered >= 0
                ? "bg-slate-100 text-slate-900 border-slate-300"
                : "bg-rose-100 text-rose-900 border-rose-300"
            }`}>
              Tiền còn lại (thu trừ chi): {netFiltered >= 0 ? "+" : ""}{formatVND(netFiltered)} đ
            </span>
          </div>
        </div>

        {/* Thanh điều khiển Bộ lọc */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Lọc Quỹ tiền */}
          <div>
            <label className={labelCls}>Quỹ tiền</label>
            <select
              value={selectedFund}
              onChange={(e) => setSelectedFund(e.target.value)}
              className={inputCls}
            >
              <option value="ALL">Tất cả quỹ ({funds.length})</option>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.kind === "CASH" ? "Két" : "Bank"})
                </option>
              ))}
            </select>
          </div>

          {/* Lọc Nghiệp vụ */}
          <div>
            <label className={labelCls}>Loại nghiệp vụ</label>
            <select
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value)}
              className={inputCls}
            >
              <option value="ALL">Tất cả nghiệp vụ</option>
              <option value="DEBT_IN">Thu công nợ khách hàng (IN)</option>
              <option value="DEBT_OUT">Chi trả công nợ NCC (OUT)</option>
              <option value="OPERATING_IN">Thu vận hành khác (IN)</option>
              <option value="OPERATING_OUT">Chi phí vận hành (OUT)</option>
              <option value="INTERNAL_TRANSFER">Chuyển quỹ nội bộ (CQ)</option>
              <option value="REVERSAL">Bút toán đảo huỷ (REV)</option>
            </select>
          </div>

          {/* Từ ngày */}
          <div>
            <label className={labelCls}>Từ ngày</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* Đến ngày */}
          <div>
            <label className={labelCls}>Đến ngày</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* Tìm kiếm */}
          <div>
            <label className={labelCls}>Tìm kiếm</label>
            <input
              type="text"
              placeholder="Mã phiếu, ghi chú, khoản mục..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
      </div>

      {/* Bảng giao dịch */}
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
          <thead>
            <tr className="bg-slate-50/90 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
              <th className="px-3.5 py-3">Ngày</th>
              <th className="px-3.5 py-3">Mã phiếu / Phân loại</th>
              <th className="px-3.5 py-3">Quỹ tiền</th>
              <th className="px-3.5 py-3">Khoản mục / Diễn giải</th>
              <th className="px-3.5 py-3 text-right">Tiền vào (+)</th>
              <th className="px-3.5 py-3 text-right">Tiền ra (−)</th>
              <th className="px-3.5 py-3">Người lập</th>
              <th className="px-3.5 py-3 text-center">Trạng thái</th>
              <th className="px-3.5 py-3 text-center">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400">
                  Không tìm thấy giao dịch nào phù hợp với điều kiện lọc.
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const isPositive = item.amount > 0;
                const isTransfer = item.movement_kind === "INTERNAL_TRANSFER";
                const isReversal = item.movement_kind === "REVERSAL";

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50/70 transition-colors ${
                      item.is_cancelled ? "bg-rose-50/20 opacity-75" : ""
                    }`}
                  >
                    {/* Ngày */}
                    <td className="px-3.5 py-3 text-slate-600 whitespace-nowrap">
                      {item.movement_date ? formatDate(item.movement_date) : "—"}
                    </td>

                    {/* Mã phiếu / Phân loại */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-mono font-bold text-slate-900">
                          {item.payment_doc_code || (isTransfer ? "CQ-NOIBO" : isReversal ? "REV-DAO" : "VH-PHIEU")}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {item.movement_kind === "DEBT_PAYMENT"
                            ? isPositive
                              ? "Thu nợ đối tác"
                              : "Chi trả nợ NCC"
                            : item.movement_kind === "OPERATING"
                            ? isPositive
                              ? "Thu vận hành"
                              : "Chi vận hành"
                            : item.movement_kind === "INTERNAL_TRANSFER"
                            ? isPositive
                              ? "Chuyển vào quỹ đích"
                              : "Chuyển từ quỹ nguồn"
                            : "Bút toán đảo huỷ"}
                        </span>
                      </div>
                    </td>

                    {/* Quỹ tiền */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <span className="font-semibold text-slate-900">{item.fund_name}</span>
                      {isTransfer && item.counter_fund_name && (
                        <p className="text-[10px] text-slate-500">
                          {isPositive ? `Từ: ${item.counter_fund_name}` : `Đến: ${item.counter_fund_name}`}
                        </p>
                      )}
                    </td>

                    {/* Khoản mục / Diễn giải */}
                    <td className="px-3.5 py-3 max-w-xs">
                      {item.category_name && (
                        <p className="font-semibold text-blue-700 text-xs">
                          {item.category_name}
                        </p>
                      )}
                      <p className="truncate text-slate-600 text-[11px]" title={item.note || ""}>
                        {item.note || "—"}
                      </p>
                    </td>

                    {/* Tiền vào (+) */}
                    <td className="px-3.5 py-3 text-right whitespace-nowrap">
                      {isPositive ? (
                        <span className={`font-black ${item.is_cancelled ? "line-through text-slate-400" : "text-emerald-700"}`}>
                          +{formatVND(item.amount)} đ
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* Tiền ra (−) */}
                    <td className="px-3.5 py-3 text-right whitespace-nowrap">
                      {!isPositive ? (
                        <span className={`font-black ${item.is_cancelled ? "line-through text-slate-400" : "text-rose-700"}`}>
                          -{formatVND(Math.abs(item.amount))} đ
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* Người lập */}
                    <td className="px-3.5 py-3 text-slate-500 whitespace-nowrap text-[11px]">
                      {item.created_by_name || "Hệ thống"}
                    </td>

                    {/* Trạng thái */}
                    <td className="px-3.5 py-3 text-center whitespace-nowrap">
                      {item.is_cancelled ? (
                        <div className="flex flex-col items-center">
                          <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                            Đã đảo huỷ
                          </span>
                          {item.cancel_reason && (
                            <span className="text-[10px] text-rose-600 max-w-[120px] truncate" title={item.cancel_reason}>
                              {item.cancel_reason}
                            </span>
                          )}
                        </div>
                      ) : isReversal ? (
                        <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800">
                          Bút toán đảo
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                          Bình thường
                        </span>
                      )}
                    </td>

                    {/* Thao tác */}
                    <td className="px-3.5 py-3 text-center whitespace-nowrap">
                      {isOwner && !item.is_cancelled && !isReversal ? (
                        <button
                          type="button"
                          onClick={() => handleOpenCancel(item)}
                          className="rounded px-2 py-1 text-[11px] font-semibold text-rose-600 border border-rose-200 hover:bg-rose-50 transition-colors"
                        >
                          Huỷ phiếu
                        </button>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* =========================================================================
          MODAL: HUỶ PHIẾU QUA BÚT TOÁN ĐẢO (REVERSAL ENTRY)
      ========================================================================= */}
      {cancellingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-rose-100 p-1.5 text-rose-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </span>
                <h3 className="text-base font-bold text-slate-900">Huỷ Phiếu Dòng Tiền & Tạo Bút Toán Đảo</h3>
              </div>
              <button type="button" onClick={handleCloseCancel} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="mt-4 rounded-lg bg-amber-50 p-3.5 text-xs text-amber-800 border border-amber-200 leading-relaxed">
              <strong>Cơ chế bảo toàn dấu vết:</strong> Phiếu gốc sẽ KHÔNG bị xoá khỏi cơ sở dữ liệu. Hệ thống sẽ đánh dấu là đã huỷ và ghi thêm một lần đảo để đưa số dư về 0 chính xác.
            </div>

            {/* Thông tin phiếu sắp huỷ */}
            <div className="mt-3.5 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div className="flex justify-between">
                <span className="text-slate-500">Mã phiếu / Nghiệp vụ:</span>
                <span className="font-bold text-slate-900">{cancellingItem.payment_doc_code || cancellingItem.movement_kind}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Ngày ghi nhận:</span>
                <span>{formatDate(cancellingItem.movement_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Quỹ tiền:</span>
                <span className="font-semibold">{cancellingItem.fund_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Số tiền:</span>
                <span className={`font-black ${cancellingItem.amount > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {cancellingItem.amount > 0 ? "+" : ""}{formatVND(cancellingItem.amount)} đ
                </span>
              </div>
              {cancellingItem.note && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Diễn giải:</span>
                  <span className="text-right">{cancellingItem.note}</span>
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
                {errorMsg}
              </div>
            )}

            <form
              action={async (formData) => {
                setErrorMsg(null);
                if (!cancelReason.trim()) {
                  setErrorMsg("Bắt buộc phải nhập lý do huỷ phiếu.");
                  return;
                }
                startTransition(async () => {
                  try {
                    await cancelCashMovementAction(formData);
                    handleCloseCancel();
                  } catch (e: unknown) {
                    setErrorMsg(e instanceof Error ? e.message : "Lỗi khi huỷ phiếu dòng tiền.");
                  }
                });
              }}
              className="mt-4 space-y-4"
            >
              <input type="hidden" name="movement_id" value={cancellingItem.id} />
              <input type="hidden" name="return_to" value="/cashflow" />

              <div>
                <label className={labelCls}>Lý do huỷ phiếu (Bắt buộc) *</label>
                <textarea
                  name="reason"
                  required
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Nhập lý do huỷ chi tiết (VD: Nhập nhầm số tiền thanh toán hoặc trùng phiếu chi)..."
                  className={inputCls}
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button type="button" onClick={handleCloseCancel} className={btnGhostCls} disabled={isPending}>
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={isPending || !cancelReason.trim()}
                  className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
                >
                  {isPending ? "Đang xử lý đảo huỷ..." : "Xác nhận tạo lần ghi đảo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
