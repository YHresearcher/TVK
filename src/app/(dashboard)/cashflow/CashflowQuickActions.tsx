/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useTransition } from "react";
import { formatVND, todayISO } from "@/lib/format";
import { inputCls, labelCls, btnCls, btnGhostCls } from "@/components/ui";
import {
  createOperatingCashMovementAction,
  transferInternalCashFundsAction,
  createCashCategoryAction,
  toggleCashCategoryAction,
} from "@/lib/actions";
import type { CashCategoryRow } from "@/lib/queries";
import type { AnyRow } from "@/lib/types";

interface CashflowQuickActionsProps {
  isOwner: boolean;
  funds: AnyRow[];
  categories: CashCategoryRow[];
}

export default function CashflowQuickActions({
  isOwner,
  funds,
  categories,
}: CashflowQuickActionsProps) {
  const [activeModal, setActiveModal] = useState<
    "IN" | "OUT" | "TRANSFER" | "SETTINGS" | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form states
  const [transferSource, setTransferSource] = useState<string>("");
  const [transferDest, setTransferDest] = useState<string>("");

  if (!isOwner) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-500 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Chế độ xem (Chỉ Chủ cửa hàng mới có quyền ghi nhận thu chi vận hành, chuyển quỹ và cấu hình khoản mục).
        </span>
        <span className="font-semibold text-slate-600">Quyền: Giám sát & Báo cáo</span>
      </div>
    );
  }

  const activeFunds = funds.filter((f) => f.is_active !== false);
  const inCategories = categories.filter((c) => c.kind === "IN" && c.is_active);
  const outCategories = categories.filter((c) => c.kind === "OUT" && c.is_active);

  const openModal = (type: "IN" | "OUT" | "TRANSFER" | "SETTINGS") => {
    setErrorMsg(null);
    setActiveModal(type);
    if (type === "TRANSFER" && activeFunds.length >= 2) {
      setTransferSource(String(activeFunds[0].id));
      setTransferDest(String(activeFunds[1].id));
    }
  };

  const closeModal = () => {
    setActiveModal(null);
    setErrorMsg(null);
  };

  return (
    <div>
      {/* Quick Actions Buttons Bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Thu vận hành */}
        <button
          type="button"
          onClick={() => openModal("IN")}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Ghi nhận Thu vận hành
        </button>

        {/* Chi vận hành */}
        <button
          type="button"
          onClick={() => openModal("OUT")}
          className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-rose-700 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
          Ghi nhận Chi vận hành
        </button>

        {/* Chuyển quỹ nội bộ */}
        <button
          type="button"
          onClick={() => openModal("TRANSFER")}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          Chuyển quỹ nội bộ
        </button>

        {/* Cài đặt khoản mục */}
        <button
          type="button"
          onClick={() => openModal("SETTINGS")}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors ml-auto"
        >
          <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Cài đặt khoản mục ({categories.length})
        </button>
      </div>

      {/* =========================================================================
          MODAL 1: THU VẬN HÀNH
      ========================================================================= */}
      {activeModal === "IN" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-100 p-1.5 text-emerald-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </span>
                <h3 className="text-base font-bold text-slate-900">Ghi Nhận Thu Vận Hành</h3>
              </div>
              <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
                {errorMsg}
              </div>
            )}

            <form
              action={async (formData) => {
                setErrorMsg(null);
                startTransition(async () => {
                  try {
                    await createOperatingCashMovementAction(formData);
                    closeModal();
                  } catch (e: unknown) {
                    setErrorMsg(e instanceof Error ? e.message : "Lỗi khi ghi nhận thu vận hành.");
                  }
                });
              }}
              className="mt-4 space-y-4"
            >
              <input type="hidden" name="return_to" value="/cashflow" />

              <div>
                <label className={labelCls}>Quỹ tiền nhận *</label>
                <select name="fund_id" required className={inputCls} defaultValue={activeFunds[0]?.id}>
                  {activeFunds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.kind === "CASH" ? "Két tiền mặt" : "Ngân hàng"}) — Số dư: {formatVND(Number(f.balance ?? 0))} đ
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Khoản mục thu *</label>
                <select name="category_id" required className={inputCls} defaultValue={inCategories[0]?.id}>
                  {inCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{c.code}] {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Số tiền (VNĐ) *</label>
                  <input
                    type="number"
                    name="amount"
                    required
                    min={1000}
                    step={1000}
                    placeholder="VD: 5000000"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Ngày ghi nhận *</label>
                  <input
                    type="date"
                    name="movement_date"
                    required
                    defaultValue={todayISO()}
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Diễn giải / Ghi chú</label>
                <input
                  type="text"
                  name="note"
                  placeholder="VD: Thu lãi tiền gửi ngân hàng tháng 5"
                  className={inputCls}
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button type="button" onClick={closeModal} className={btnGhostCls} disabled={isPending}>
                  Huỷ bỏ
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {isPending ? "Đang xử lý..." : "Lưu phiếu thu"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: CHI VẬN HÀNH
      ========================================================================= */}
      {activeModal === "OUT" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-rose-100 p-1.5 text-rose-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </span>
                <h3 className="text-base font-bold text-slate-900">Ghi Nhận Chi Vận Hành</h3>
              </div>
              <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
                {errorMsg}
              </div>
            )}

            <form
              action={async (formData) => {
                setErrorMsg(null);
                startTransition(async () => {
                  try {
                    await createOperatingCashMovementAction(formData);
                    closeModal();
                  } catch (e: unknown) {
                    setErrorMsg(e instanceof Error ? e.message : "Lỗi khi ghi nhận chi vận hành.");
                  }
                });
              }}
              className="mt-4 space-y-4"
            >
              <input type="hidden" name="return_to" value="/cashflow" />

              <div>
                <label className={labelCls}>Quỹ tiền chi *</label>
                <select name="fund_id" required className={inputCls} defaultValue={activeFunds[0]?.id}>
                  {activeFunds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.kind === "CASH" ? "Két tiền mặt" : "Ngân hàng"}) — Số dư: {formatVND(Number(f.balance ?? 0))} đ
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Khoản mục chi *</label>
                <select name="category_id" required className={inputCls} defaultValue={outCategories[0]?.id}>
                  {outCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{c.code}] {c.name} {c.is_fixed ? "★ (Cố định)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Số tiền chi (VNĐ) *</label>
                  <input
                    type="number"
                    name="amount"
                    required
                    min={1000}
                    step={1000}
                    placeholder="VD: 15000000"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Ngày ghi nhận *</label>
                  <input
                    type="date"
                    name="movement_date"
                    required
                    defaultValue={todayISO()}
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Diễn giải / Ghi chú</label>
                <input
                  type="text"
                  name="note"
                  placeholder="VD: Tiền thuê mặt bằng kho tháng 5/2026"
                  className={inputCls}
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button type="button" onClick={closeModal} className={btnGhostCls} disabled={isPending}>
                  Huỷ bỏ
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
                >
                  {isPending ? "Đang xử lý..." : "Lưu phiếu chi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 3: CHUYỂN QUỸ NỘI BỘ
      ========================================================================= */}
      {activeModal === "TRANSFER" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-blue-100 p-1.5 text-blue-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </span>
                <h3 className="text-base font-bold text-slate-900">Chuyển Quỹ Tiền Nội Bộ</h3>
              </div>
              <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              Tự động sinh 2 bản ghi đối ứng (− Quỹ nguồn, + Quỹ đích) và không tính vào doanh thu hoặc chi phí.
            </p>

            {errorMsg && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
                {errorMsg}
              </div>
            )}

            <form
              action={async (formData) => {
                setErrorMsg(null);
                if (transferSource === transferDest) {
                  setErrorMsg("Quỹ nguồn và quỹ đích không được trùng nhau.");
                  return;
                }
                startTransition(async () => {
                  try {
                    await transferInternalCashFundsAction(formData);
                    closeModal();
                  } catch (e: unknown) {
                    setErrorMsg(e instanceof Error ? e.message : "Lỗi khi chuyển quỹ nội bộ.");
                  }
                });
              }}
              className="mt-4 space-y-4"
            >
              <input type="hidden" name="return_to" value="/cashflow" />

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Quỹ nguồn (Ghi giảm −) *</label>
                  <select
                    name="source_fund_id"
                    required
                    className={inputCls}
                    value={transferSource}
                    onChange={(e) => setTransferSource(e.target.value)}
                  >
                    {activeFunds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({formatVND(Number(f.balance ?? 0))} đ)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Quỹ đích (Ghi tăng +) *</label>
                  <select
                    name="dest_fund_id"
                    required
                    className={inputCls}
                    value={transferDest}
                    onChange={(e) => setTransferDest(e.target.value)}
                  >
                    {activeFunds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({formatVND(Number(f.balance ?? 0))} đ)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Số tiền chuyển (VNĐ) *</label>
                  <input
                    type="number"
                    name="amount"
                    required
                    min={1000}
                    step={1000}
                    placeholder="VD: 20000000"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Ngày chuyển quỹ *</label>
                  <input
                    type="date"
                    name="transfer_date"
                    required
                    defaultValue={todayISO()}
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Ghi chú chuyển quỹ</label>
                <input
                  type="text"
                  name="note"
                  placeholder="VD: Rút tiền ngân hàng nạp két tiền mặt phục vụ chi tiêu"
                  className={inputCls}
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button type="button" onClick={closeModal} className={btnGhostCls} disabled={isPending}>
                  Huỷ bỏ
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {isPending ? "Đang xử lý..." : "Xác nhận chuyển quỹ"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 4: CÀI ĐẶT DANH MỤC KHOẢN MỤC THU / CHI
      ========================================================================= */}
      {activeModal === "SETTINGS" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl border border-slate-200 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Cài Đặt Khoản Mục Thu / Chi Vận Hành</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Quản lý danh mục khoản mục gọn phục vụ đối soát và dự báo chi phí cố định dòng tiền.
                </p>
              </div>
              <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
                {errorMsg}
              </div>
            )}

            {/* Bảng danh sách khoản mục hiện có */}
            <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="px-3 py-2">Mã</th>
                    <th className="px-3 py-2">Tên khoản mục</th>
                    <th className="px-3 py-2">Loại</th>
                    <th className="px-3 py-2">Nhóm</th>
                    <th className="px-3 py-2">Cố định?</th>
                    <th className="px-3 py-2 text-right">Ngân sách/tháng</th>
                    <th className="px-3 py-2 text-center">Bật/Tắt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {categories.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2 font-mono text-[11px] font-bold text-slate-900">{c.code}</td>
                      <td className="px-3 py-2">{c.name}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          c.kind === "IN" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                        }`}>
                          {c.kind === "IN" ? "Thu" : "Chi"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-[11px]">{c.group_key}</td>
                      <td className="px-3 py-2">
                        {c.is_fixed ? (
                          <span className="text-amber-600 font-bold">★ Cố định</span>
                        ) : (
                          <span className="text-slate-400">Biến phí</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {c.monthly_budget > 0 ? `${formatVND(c.monthly_budget)} đ` : "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <form
                          action={async (formData) => {
                            startTransition(async () => {
                              try {
                                await toggleCashCategoryAction(formData);
                              } catch (e: unknown) {
                                setErrorMsg(e instanceof Error ? e.message : "Lỗi khi cập nhật trạng thái.");
                              }
                            });
                          }}
                        >
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="return_to" value="/cashflow" />
                          <button
                            type="submit"
                            className={`rounded px-2 py-0.5 text-[10px] font-bold transition-colors ${
                              c.is_active
                                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                            }`}
                          >
                            {c.is_active ? "Đang bật" : "Đã tắt"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Form Thêm Khoản Mục Mới */}
            <div className="mt-6 border-t border-slate-200 pt-4">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                Thêm Khoản Mục Thu / Chi Mới
              </h4>
              <form
                action={async (formData) => {
                  setErrorMsg(null);
                  startTransition(async () => {
                    try {
                      await createCashCategoryAction(formData);
                      closeModal();
                    } catch (e: unknown) {
                      setErrorMsg(e instanceof Error ? e.message : "Lỗi khi thêm khoản mục.");
                    }
                  });
                }}
                className="grid gap-3 sm:grid-cols-3"
              >
                <input type="hidden" name="return_to" value="/cashflow" />

                <div>
                  <label className={labelCls}>Mã khoản mục *</label>
                  <input
                    type="text"
                    name="code"
                    required
                    placeholder="VD: CHI_MARKETING"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Tên khoản mục *</label>
                  <input
                    type="text"
                    name="name"
                    required
                    placeholder="VD: Chi phí quảng cáo số"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Loại *</label>
                  <select name="kind" className={inputCls} defaultValue="OUT">
                    <option value="OUT">Chi (Tiền ra)</option>
                    <option value="IN">Thu (Tiền vào)</option>
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Nhóm chi phí *</label>
                  <select name="group_key" className={inputCls} defaultValue="OTHER">
                    <option value="SALARY">Lương & Nhân sự (SALARY)</option>
                    <option value="RENT">Mặt bằng & Kho bãi (RENT)</option>
                    <option value="TRANSPORT">Vận chuyển & Giao nhận (TRANSPORT)</option>
                    <option value="TAX">Thuế, Phí & Lệ phí (TAX)</option>
                    <option value="OTHER">Chi phí khác (OTHER)</option>
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Ngân sách ước tính/tháng</label>
                  <input
                    type="number"
                    name="monthly_budget"
                    defaultValue={0}
                    step={100000}
                    className={inputCls}
                  />
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="is_fixed"
                    name="is_fixed"
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="is_fixed" className="text-xs font-medium text-slate-700 cursor-pointer">
                    Chi phí cố định hàng tháng (đưa vào Runway)
                  </label>
                </div>

                <div className="sm:col-span-3 flex justify-end gap-3 pt-2">
                  <button type="button" onClick={closeModal} className={btnGhostCls}>
                    Đóng
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    className={btnCls}
                  >
                    {isPending ? "Đang lưu..." : "Thêm khoản mục"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
