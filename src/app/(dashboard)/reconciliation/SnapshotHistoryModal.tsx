/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState } from "react";
import type { ReconciliationSnapshot, ReconciliationEntry } from "@/types";

interface SnapshotHistoryModalProps {
  snapshots: ReconciliationSnapshot[];
  currentEntries: ReconciliationEntry[];
  userRole: string;
  isOpen: boolean;
  onClose: () => void;
  onSnapshotDeleted: () => void;
}

export default function SnapshotHistoryModal({
  snapshots,
  currentEntries,
  isOpen,
  onClose,
}: SnapshotHistoryModalProps) {
  const [selectedSnapshot, setSelectedSnapshot] = useState<ReconciliationSnapshot | null>(
    snapshots[0] || null
  );

  if (!isOpen) return null;

  const fmt = (n?: number) => (n ?? 0).toLocaleString("vi-VN");

  const currentMap = new Map<string, number>();
  for (const e of currentEntries) {
    currentMap.set(`${e.data_group}__${e.item_key}`, Number(e.tvk_amount || 0));
  }

  const snapshotItems = (selectedSnapshot?.snapshot_items as any[]) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-5xl rounded-xl bg-white shadow-2xl overflow-hidden border border-stone-200 my-8 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-stone-50 px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
              <span>🕒</span> Lịch Sử Bản Chốt Kỳ Đối Chiếu (Frozen Snapshots)
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Tra cứu lại các mốc số liệu đã chốt bất biến và đối chiếu biến động dữ liệu TVK sau ngày chốt
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-200/60 transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal content */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-stone-200">
          {/* Left: Snapshots List */}
          <div className="p-4 overflow-y-auto max-h-[70vh] space-y-2 bg-stone-50/50">
            <span className="text-[11px] font-bold text-stone-400 uppercase tracking-wider block mb-2">
              Danh sách bản chốt ({snapshots.length})
            </span>

            {snapshots.length === 0 ? (
              <div className="text-center py-8 text-stone-400 text-xs">
                Chưa có bản chốt kỳ nào được lưu cho kỳ này.
              </div>
            ) : (
              snapshots.map((s) => {
                const isSelected = selectedSnapshot?.id === s.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSnapshot(s)}
                    className={`rounded-lg p-3 text-xs border cursor-pointer transition ${
                      isSelected
                        ? "bg-white border-blue-500 shadow-sm"
                        : "bg-white border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-stone-900 truncate">{s.name}</span>
                      <span className="font-mono text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                        #{s.snapshot_no}
                      </span>
                    </div>
                    <p className="text-stone-400 text-[10px] mt-1 font-mono">
                      {new Date(s.created_at || "").toLocaleString("vi-VN")}
                    </p>
                    <div className="mt-2 pt-2 border-t border-stone-100 flex justify-between text-[11px]">
                      <span className="text-stone-500">Lệch ròng:</span>
                      <span
                        className={`font-semibold ${
                          Math.abs(s.total_diff) < 0.01 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {fmt(s.total_diff)} đ
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right: Selected Snapshot Detail & Comparison */}
          <div className="md:col-span-2 p-6 overflow-y-auto max-h-[70vh] space-y-4">
            {!selectedSnapshot ? (
              <div className="text-center py-16 text-stone-400 text-sm">
                Hãy chọn một bản chốt kỳ bên trái để xem chi tiết.
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-800 font-mono">
                        Bản #{selectedSnapshot.snapshot_no}
                      </span>
                      <h4 className="text-base font-bold text-stone-900">
                        {selectedSnapshot.name}
                      </h4>
                    </div>
                    <p className="text-xs text-stone-500 mt-1">
                      Kỳ: {selectedSnapshot.period_name} ({selectedSnapshot.from_date} đến{" "}
                      {selectedSnapshot.to_date}) • Thời điểm lưu:{" "}
                      {new Date(selectedSnapshot.created_at || "").toLocaleString("vi-VN")}
                    </p>
                    {selectedSnapshot.note && (
                      <p className="text-xs text-stone-600 mt-2 bg-stone-100 p-2 rounded italic">
                        &ldquo;{selectedSnapshot.note}&rdquo;
                      </p>
                    )}
                  </div>

                  {/* P4b (BL-017): bản chụp đã chốt là bất biến — không sửa,
                      không xoá. Muốn sửa số liệu thì tạo bản chụp hiệu
                      chỉnh mới. */}
                  <p className="text-[11px] text-stone-400">
                    Bản chụp đã chốt — không sửa hay xoá được.
                  </p>
                </div>

                {/* KPI summary of snapshot */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-stone-50 border border-stone-200 p-3 text-xs">
                    <span className="text-stone-500 block">Tổng TVK lúc chốt:</span>
                    <span className="font-bold text-sm text-stone-900">
                      {fmt(selectedSnapshot.total_tvk)} đ
                    </span>
                  </div>
                  <div className="rounded-lg bg-stone-50 border border-stone-200 p-3 text-xs">
                    <span className="text-stone-500 block">Tổng Kế toán lúc chốt:</span>
                    <span className="font-bold text-sm text-stone-900">
                      {fmt(selectedSnapshot.total_acc)} đ
                    </span>
                  </div>
                  <div className="rounded-lg bg-stone-50 border border-stone-200 p-3 text-xs">
                    <span className="text-stone-500 block">Chênh lệch lúc chốt:</span>
                    <span
                      className={`font-bold text-sm ${
                        Math.abs(selectedSnapshot.total_diff) < 0.01
                          ? "text-emerald-600"
                          : "text-rose-600"
                      }`}
                    >
                      {fmt(selectedSnapshot.total_diff)} đ
                    </span>
                  </div>
                </div>

                {/* Items comparison table */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-800">
                      Chi tiết các dòng đối chiếu đóng băng ({snapshotItems.length} dòng):
                    </span>
                    <span className="text-stone-500 text-[11px]">
                      Cột &ldquo;Số TVK Live&rdquo; thể hiện số liệu hiện tại nếu có sửa chứng từ cũ
                    </span>
                  </div>

                  <div className="overflow-x-auto border border-stone-200 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-stone-100 text-stone-600 font-semibold border-b">
                        <tr>
                          <th className="p-2">Khoản mục</th>
                          <th className="p-2 text-right">Số TVK Đóng Băng</th>
                          <th className="p-2 text-right">Số TVK Live Hiện Tại</th>
                          <th className="p-2 text-right">Số Kế Toán</th>
                          <th className="p-2 text-right">Chênh Lệch</th>
                          <th className="p-2 text-center">Phân Loại</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {snapshotItems.map((item: any, idx: number) => {
                          const liveTvk = currentMap.get(`${item.data_group}__${item.item_key}`);
                          const frozenTvk = Number(item.tvk_amount || 0);
                          const hasChangedAfterFreeze =
                            liveTvk !== undefined && Math.abs(liveTvk - frozenTvk) >= 0.01;

                          return (
                            <tr
                              key={idx}
                              className={`hover:bg-stone-50 ${
                                hasChangedAfterFreeze ? "bg-amber-50/40" : ""
                              }`}
                            >
                              <td className="p-2">
                                <span className="font-semibold text-stone-900 block">
                                  {item.item_name}
                                </span>
                                <span className="text-[10px] text-stone-400 font-mono">
                                  {item.item_key}
                                </span>
                                {item.explanation_note && (
                                  <span className="text-[10px] text-stone-500 italic block mt-0.5">
                                    Ghi chú: {item.explanation_note}
                                  </span>
                                )}
                              </td>
                              <td className="p-2 text-right font-mono font-medium text-stone-800">
                                {fmt(frozenTvk)} đ
                              </td>
                              <td className="p-2 text-right font-mono">
                                {liveTvk !== undefined ? (
                                  hasChangedAfterFreeze ? (
                                    <div className="flex flex-col items-end">
                                      <span className="text-amber-700 font-bold">
                                        {fmt(liveTvk)} đ
                                      </span>
                                      <span className="text-[10px] text-amber-600 font-sans">
                                        (Đã đổi {liveTvk - frozenTvk > 0 ? "+" : ""}
                                        {fmt(liveTvk - frozenTvk)})
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-stone-500">{fmt(liveTvk)} đ</span>
                                  )
                                ) : (
                                  <span className="text-stone-400">-</span>
                                )}
                              </td>
                              <td className="p-2 text-right font-mono text-stone-800">
                                {fmt(item.accounting_amount)} đ
                              </td>
                              <td
                                className={`p-2 text-right font-mono font-bold ${
                                  Math.abs(item.difference_amount) < 0.01
                                    ? "text-emerald-600"
                                    : "text-rose-600"
                                }`}
                              >
                                {fmt(item.difference_amount)} đ
                              </td>
                              <td className="p-2 text-center">
                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-stone-100 text-stone-700 border border-stone-200">
                                  {item.discrepancy_status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-stone-50 px-6 py-3 border-t border-stone-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-stone-900 text-white text-xs font-semibold hover:bg-stone-800 transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
