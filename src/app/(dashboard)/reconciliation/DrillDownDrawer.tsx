/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React from "react";
import type { ReconciliationEntry } from "@/types";

interface DrillDownDrawerProps {
  entry: ReconciliationEntry | null;
  onClose: () => void;
}

export default function DrillDownDrawer({ entry, onClose }: DrillDownDrawerProps) {
  if (!entry) return null;

  const drilldown = entry.drilldown_data || {};
  const { type, vouchers, transactions, items } = drilldown;

  const fmt = (n?: number) => (n ?? 0).toLocaleString("vi-VN");

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-sm transition-opacity">
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-2xl bg-white shadow-2xl flex flex-col">
          {/* Header */}
          <div className="border-b border-stone-200 px-6 py-4 bg-stone-50 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                  {entry.item_key}
                </span>
                <h2 className="text-lg font-bold text-stone-900">{entry.item_name}</h2>
              </div>
              <p className="text-xs text-stone-500 mt-1">
                {entry.item_subtext || "Chi tiết các chứng từ và giao dịch gốc bên TVK"}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 transition"
              title="Đóng"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Quick summary bar */}
          <div className="bg-blue-50/60 px-6 py-3 border-b border-blue-100 grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-stone-500 block">Số TVK tự động:</span>
              <span className="font-bold text-blue-700 text-sm">{fmt(entry.tvk_amount)} đ</span>
            </div>
            <div>
              <span className="text-stone-500 block">Số Kế toán:</span>
              <span className="font-bold text-stone-800 text-sm">{fmt(entry.accounting_amount)} đ</span>
            </div>
            <div>
              <span className="text-stone-500 block">Chênh lệch:</span>
              <span
                className={`font-bold text-sm ${
                  Math.abs(entry.difference_amount) < 0.01
                    ? "text-emerald-600"
                    : "text-rose-600"
                }`}
              >
                {entry.difference_amount > 0 ? "+" : ""}
                {fmt(entry.difference_amount)} đ
              </span>
            </div>
          </div>

          {/* Body content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* CASH FUND DRILLDOWN */}
            {type === "CASH_FUND" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs flex justify-between">
                  <span>Số dư đầu kỳ ({drilldown.opening_balance_date || "2026-01-01"}):</span>
                  <span className="font-bold text-stone-800">{fmt(drilldown.opening_balance)} đ</span>
                </div>

                <h3 className="font-semibold text-sm text-stone-800">
                  Lịch sử phát sinh quỹ ({transactions?.length || 0} giao dịch):
                </h3>

                {(!transactions || transactions.length === 0) ? (
                  <div className="text-center py-8 text-stone-400 text-sm">
                    Không có giao dịch quỹ nào phát sinh đến thời điểm này.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-stone-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-stone-100 text-stone-600 font-semibold border-b">
                        <tr>
                          <th className="p-2">Ngày</th>
                          <th className="p-2">Loại</th>
                          <th className="p-2">Diễn giải</th>
                          <th className="p-2 text-right">Số tiền</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {transactions.map((tx: any) => (
                          <tr key={tx.id} className="hover:bg-stone-50">
                            <td className="p-2 font-mono whitespace-nowrap">{tx.date}</td>
                            <td className="p-2">
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-stone-200 text-stone-800">
                                {tx.kind}
                              </span>
                            </td>
                            <td className="p-2 text-stone-700">{tx.note}</td>
                            <td
                              className={`p-2 text-right font-medium font-mono ${
                                tx.amount >= 0 ? "text-emerald-600" : "text-rose-600"
                              }`}
                            >
                              {tx.amount >= 0 ? "+" : ""}
                              {fmt(tx.amount)} đ
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* RECEIVABLE / PAYABLE DRILLDOWN */}
            {(type === "RECEIVABLE" || type === "PAYABLE") && (
              <div className="space-y-4">
                <h3 className="font-semibold text-sm text-stone-800">
                  Chứng từ công nợ chi tiết ({vouchers?.length || 0} chứng từ):
                </h3>

                {(!vouchers || vouchers.length === 0) ? (
                  <div className="text-center py-8 text-stone-400 text-sm">
                    Không có chứng từ công nợ nào còn dư nợ đến thời điểm này.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {vouchers.map((v: any) => (
                      <div
                        key={v.id}
                        className="rounded-lg border border-stone-200 p-3 bg-white hover:border-blue-300 transition"
                      >
                        <div className="flex items-center justify-between text-xs mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-blue-700">{v.code}</span>
                            <span className="text-stone-400">•</span>
                            <span className="text-stone-500 font-mono">{v.date}</span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                              v.status === "PAID"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {v.status === "PAID" ? "Đã thanh toán" : "Còn nợ"}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-xs border-t border-stone-100 pt-2">
                          <div>
                            <span className="text-stone-400 block text-[10px]">Tiền chứng từ:</span>
                            <span className="font-semibold">{fmt(v.doc_amount)} đ</span>
                          </div>
                          <div>
                            <span className="text-stone-400 block text-[10px]">Đã thanh toán:</span>
                            <span className="text-stone-700">{fmt(v.paid_amount)} đ</span>
                          </div>
                          <div>
                            <span className="text-stone-400 block text-[10px]">Còn phải thu/trả:</span>
                            <span className="font-bold text-rose-600">{fmt(v.remaining_amount)} đ</span>
                          </div>
                        </div>

                        {v.payments && v.payments.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-dashed border-stone-200">
                            <span className="text-[10px] text-stone-400 uppercase tracking-wide font-medium">
                              Phiếu thanh toán gắn liền:
                            </span>
                            <div className="mt-1 space-y-1">
                              {v.payments.map((p: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="text-[11px] flex justify-between text-stone-600 font-mono"
                                >
                                  <span>
                                    {p.code} ({p.date} - {p.method})
                                  </span>
                                  <span className="text-emerald-700 font-medium">
                                    -{fmt(p.amount)} đ
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* INVENTORY DRILLDOWN */}
            {type === "INVENTORY" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs flex justify-between">
                  <span>Tổng giá trị tồn kho:</span>
                  <span className="font-bold text-blue-700">{fmt(drilldown.total_value)} đ</span>
                </div>

                <h3 className="font-semibold text-sm text-stone-800">
                  Bảng kê chi tiết các mặt hàng / lô ({items?.length || 0} mặt hàng):
                </h3>

                {(!items || items.length === 0) ? (
                  <div className="text-center py-8 text-stone-400 text-sm">
                    Không có tồn kho nào trong nhóm này.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-stone-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-stone-100 text-stone-600 font-semibold border-b">
                        <tr>
                          <th className="p-2">SKU</th>
                          <th className="p-2">Tên phụ tùng</th>
                          <th className="p-2">Lô / Vị trí</th>
                          <th className="p-2 text-right">SL</th>
                          <th className="p-2 text-right">Đơn giá vốn</th>
                          <th className="p-2 text-right">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {items.map((it: any, idx: number) => (
                          <tr key={idx} className="hover:bg-stone-50">
                            <td className="p-2 font-mono font-bold text-blue-700">{it.sku}</td>
                            <td className="p-2 text-stone-800">{it.product_name}</td>
                            <td className="p-2 text-stone-500 font-mono text-[11px]">
                              {it.batch_code} ({it.location_name})
                            </td>
                            <td className="p-2 text-right font-medium">{it.qty}</td>
                            <td className="p-2 text-right text-stone-600">{fmt(it.unit_cost)} đ</td>
                            <td className="p-2 text-right font-bold text-stone-900">
                              {fmt(it.total_value)} đ
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* REVENUE DRILLDOWN */}
            {type === "REVENUE" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs flex justify-between">
                  <span>Tổng doanh thu:</span>
                  <span className="font-bold text-emerald-700">{fmt(drilldown.total_amount)} đ</span>
                </div>

                <h3 className="font-semibold text-sm text-stone-800">
                  Danh sách chứng từ bán hàng ({vouchers?.length || 0} chứng từ):
                </h3>

                {(!vouchers || vouchers.length === 0) ? (
                  <div className="text-center py-8 text-stone-400 text-sm">
                    Không có chứng từ bán hàng trong kỳ này.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-stone-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-stone-100 text-stone-600 font-semibold border-b">
                        <tr>
                          <th className="p-2">Mã chứng từ</th>
                          <th className="p-2">Ngày</th>
                          <th className="p-2">Khách hàng</th>
                          <th className="p-2">Hoá đơn GTGT</th>
                          <th className="p-2 text-right">Doanh thu</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {vouchers.map((v: any, idx: number) => (
                          <tr key={idx} className="hover:bg-stone-50">
                            <td className="p-2 font-mono font-bold text-blue-700">{v.doc_code}</td>
                            <td className="p-2 font-mono">{v.doc_date}</td>
                            <td className="p-2 text-stone-800">{v.partner_name}</td>
                            <td className="p-2">
                              {v.vat_invoice_no ? (
                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                                  HĐ {v.vat_invoice_no} ({v.vat_symbol})
                                </span>
                              ) : (
                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                                  Chưa xuất HĐ
                                </span>
                              )}
                            </td>
                            <td className="p-2 text-right font-bold text-stone-900">
                              {fmt(v.amount)} đ
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* EXPENSE DRILLDOWN */}
            {type === "EXPENSE" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs flex justify-between">
                  <span>Tổng chi phí nhóm:</span>
                  <span className="font-bold text-rose-600">{fmt(drilldown.total_amount)} đ</span>
                </div>

                <h3 className="font-semibold text-sm text-stone-800">
                  Các phiếu chi vận hành thực tế ({vouchers?.length || 0} phiếu chi):
                </h3>

                {(!vouchers || vouchers.length === 0) ? (
                  <div className="text-center py-8 text-stone-400 text-sm">
                    Không có khoản chi vận hành nào trong kỳ này.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-stone-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-stone-100 text-stone-600 font-semibold border-b">
                        <tr>
                          <th className="p-2">Ngày</th>
                          <th className="p-2">Khoản mục</th>
                          <th className="p-2">Quỹ chi</th>
                          <th className="p-2">Diễn giải</th>
                          <th className="p-2 text-right">Số tiền chi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {vouchers.map((v: any, idx: number) => (
                          <tr key={idx} className="hover:bg-stone-50">
                            <td className="p-2 font-mono whitespace-nowrap">{v.date}</td>
                            <td className="p-2 font-medium text-stone-800">{v.category_name}</td>
                            <td className="p-2 text-stone-600">{v.fund_name}</td>
                            <td className="p-2 text-stone-700">{v.note}</td>
                            <td className="p-2 text-right font-bold text-rose-600">
                              {fmt(v.amount)} đ
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-stone-200 px-6 py-3 bg-stone-50 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-stone-900 text-white text-xs font-medium hover:bg-stone-800 transition"
            >
              Đóng chi tiết
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
