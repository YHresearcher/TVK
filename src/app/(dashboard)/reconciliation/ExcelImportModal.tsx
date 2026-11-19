/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useRef } from "react";
import { readFirstSheetAOA } from "@/lib/excel-parse";
import {
  detectReconciliationColumns,
  parseReconciliationRows,
  type ColumnMappingConfig,
  type ParsedReconciliationRow,
} from "@/lib/excel-reconciliation";
import { importReconciliationEntriesAction } from "@/lib/reconciliation-actions";
import type { ReconciliationEntry } from "@/types";

interface ExcelImportModalProps {
  periodId: string;
  entries: ReconciliationEntry[];
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: () => void;
}

export default function ExcelImportModal({
  periodId,
  entries,
  isOpen,
  onClose,
  onImportSuccess,
}: ExcelImportModalProps) {
  const [rawRows, setRawRows] = useState<unknown[][]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [mapping, setMapping] = useState<ColumnMappingConfig>({
    headerRowIdx: 0,
    keyCol: 1,
    nameCol: 2,
    amountCol: 3,
    noteCol: 4,
  });
  const [parsedItems, setParsedItems] = useState<ParsedReconciliationRow[]>([]);
  const [autoDetected, setAutoDetected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    setFileName(file.name);
    setLoading(true);

    try {
      const buf = await file.arrayBuffer();
      const rows = await readFirstSheetAOA(buf);

      if (!rows || rows.length === 0) {
        throw new Error("File Excel không có dữ liệu.");
      }

      setRawRows(rows);

      // Quét tìm dòng tiêu đề thực sự (quét tối đa 10 dòng đầu tìm dòng auto-detect được)
      let headerIdx = 0;
      let detectedMap = detectReconciliationColumns((rows[0] as unknown[]) || []).mapping;
      let isAuto = false;

      for (let i = 0; i < Math.min(10, rows.length); i++) {
        const row = (rows[i] as unknown[]) || [];
        const det = detectReconciliationColumns(row);
        if (det.autoDetected) {
          headerIdx = i;
          detectedMap = det.mapping;
          isAuto = true;
          break;
        }
      }

      // Fallback nếu không có dòng nào auto-detected: tìm dòng đầu tiên có ít nhất 2 ô chữ
      if (!isAuto) {
        for (let i = 0; i < Math.min(5, rows.length); i++) {
          const row = (rows[i] as any[]) || [];
          if (row.filter((c) => typeof c === "string" && c.trim().length > 0).length >= 2) {
            headerIdx = i;
            const det = detectReconciliationColumns(row);
            detectedMap = det.mapping;
            isAuto = det.autoDetected;
            break;
          }
        }
      }

      detectedMap.headerRowIdx = headerIdx;
      setMapping(detectedMap);
      setAutoDetected(isAuto);

      const { parsedRows } = parseReconciliationRows(rows, detectedMap);
      setParsedItems(parsedRows);
    } catch (err: any) {
      setErrorMsg(err.message || "Lỗi đọc file Excel");
    } finally {
      setLoading(false);
    }
  };

  const handleMappingChange = (field: keyof ColumnMappingConfig, val: number) => {
    const newMap = { ...mapping, [field]: val };
    setMapping(newMap);
    if (rawRows.length > 0) {
      const { parsedRows } = parseReconciliationRows(rawRows, newMap);
      setParsedItems(parsedRows);
    }
  };

  const handleConfirmImport = async () => {
    if (parsedItems.length === 0) {
      setErrorMsg("Không có dữ liệu hợp lệ để import.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await importReconciliationEntriesAction(
        periodId,
        parsedItems.map((p) => ({
          itemKey: p.itemKey,
          itemName: p.itemName,
          accountingAmount: p.accountingAmount,
          explanationNote: p.explanationNote,
        }))
      );

      if (!res.success) {
        throw new Error(res.error);
      }

      setSuccessMsg(res.message || "Import thành công!");
      setTimeout(() => {
        onImportSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || "Lỗi khi nạp dữ liệu vào hệ thống.");
    } finally {
      setLoading(false);
    }
  };

  const headers = (rawRows[mapping.headerRowIdx] as any[]) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl overflow-hidden border border-stone-200 my-8">
        {/* Header */}
        <div className="bg-stone-50 px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-stone-900">
              Nhập Số Liệu Kế Toán Từ File Excel
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Hỗ trợ mẫu chuẩn TVK hoặc tự động nhận diện cấu hình cột linh hoạt
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

        {/* Modal body */}
        <div className="p-6 space-y-5">
          {errorMsg && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 font-medium">
              ⚠️ {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700 font-medium">
              ✓ {successMsg}
            </div>
          )}

          {/* Upload zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-stone-300 rounded-xl p-6 text-center hover:border-blue-500 hover:bg-blue-50/30 cursor-pointer transition"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="flex flex-col items-center justify-center gap-2">
              <span className="text-3xl">📥</span>
              <p className="text-sm font-semibold text-stone-800">
                {fileName ? `Đã chọn file: ${fileName}` : "Bấm vào đây để chọn file Excel (.xlsx, .xls)"}
              </p>
              <p className="text-xs text-stone-400">
                Kéo thả file bảng tính kế toán gửi để tự động khớp dữ liệu
              </p>
            </div>
          </div>

          {/* Column mapping configuration */}
          {rawRows.length > 0 && (
            <div className="bg-stone-50 rounded-xl p-4 border border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-600">
                  Cấu hình ánh xạ cột {autoDetected && <span className="text-emerald-600 font-normal">(Đã tự động nhận diện)</span>}
                </span>
                <span className="text-xs text-stone-400 font-mono">
                  {rawRows.length} dòng được đọc
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-stone-600 mb-1 font-medium">Cột Mã khoản mục:</label>
                  <select
                    className="w-full rounded border border-stone-300 p-1.5 bg-white text-xs"
                    value={mapping.keyCol}
                    onChange={(e) => handleMappingChange("keyCol", Number(e.target.value))}
                  >
                    <option value={-1}>-- Không dùng --</option>
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        Cột {String.fromCharCode(65 + idx)}: {String(h || `Cột ${idx + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-stone-600 mb-1 font-medium">Cột Tên khoản mục:</label>
                  <select
                    className="w-full rounded border border-stone-300 p-1.5 bg-white text-xs"
                    value={mapping.nameCol}
                    onChange={(e) => handleMappingChange("nameCol", Number(e.target.value))}
                  >
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        Cột {String.fromCharCode(65 + idx)}: {String(h || `Cột ${idx + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-stone-600 mb-1 font-medium">Cột Số tiền Kế toán:</label>
                  <select
                    className="w-full rounded border border-stone-300 p-1.5 bg-white text-xs"
                    value={mapping.amountCol}
                    onChange={(e) => handleMappingChange("amountCol", Number(e.target.value))}
                  >
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        Cột {String.fromCharCode(65 + idx)}: {String(h || `Cột ${idx + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-stone-600 mb-1 font-medium">Cột Ghi chú giải trình:</label>
                  <select
                    className="w-full rounded border border-stone-300 p-1.5 bg-white text-xs"
                    value={mapping.noteCol}
                    onChange={(e) => handleMappingChange("noteCol", Number(e.target.value))}
                  >
                    <option value={-1}>-- Không có --</option>
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        Cột {String.fromCharCode(65 + idx)}: {String(h || `Cột ${idx + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Preview Table */}
          {parsedItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-stone-800">
                  Xem trước dữ liệu import ({parsedItems.length} khoản mục):
                </span>
                <span className="text-stone-500">
                  Khớp với danh sách hiện tại ({entries.length} mục)
                </span>
              </div>

              <div className="max-h-56 overflow-y-auto border border-stone-200 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-100 text-stone-600 font-semibold sticky top-0 border-b">
                    <tr>
                      <th className="p-2 w-12 text-center">Dòng</th>
                      <th className="p-2">Mã / Tên trong file</th>
                      <th className="p-2 text-right">Số tiền KT</th>
                      <th className="p-2">Ghi chú</th>
                      <th className="p-2 text-center">Trạng thái khớp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {parsedItems.slice(0, 15).map((item, idx) => {
                      const isMatched = entries.some(
                        (e) =>
                          (item.itemKey && e.item_key.toLowerCase() === item.itemKey.toLowerCase()) ||
                          e.item_name.toLowerCase().trim() === item.itemName.toLowerCase().trim()
                      );

                      return (
                        <tr key={idx} className="hover:bg-stone-50">
                          <td className="p-2 text-center text-stone-400 font-mono">{item.rowIdx}</td>
                          <td className="p-2">
                            <span className="font-semibold text-stone-900 block">{item.itemName}</span>
                            {item.itemKey && (
                              <span className="text-[10px] font-mono text-stone-400">
                                {item.itemKey}
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-right font-mono font-medium text-stone-800">
                            {item.accountingAmount.toLocaleString("vi-VN")} đ
                          </td>
                          <td className="p-2 text-stone-500 text-[11px] truncate max-w-xs">
                            {item.explanationNote || "-"}
                          </td>
                          <td className="p-2 text-center">
                            {isMatched ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800">
                                ✓ Khớp TVK
                              </span>
                            ) : (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                                Chưa có trên TVK
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {parsedItems.length > 15 && (
                <p className="text-[11px] text-stone-400 text-center">
                  ... và {parsedItems.length - 15} dòng khác sẽ được nạp
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-stone-50 px-6 py-4 border-t border-stone-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-100 transition"
          >
            Huỷ bỏ
          </button>
          <button
            type="button"
            disabled={loading || parsedItems.length === 0}
            onClick={handleConfirmImport}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow disabled:opacity-50 transition flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Đang xử lý...
              </>
            ) : (
              `Xác nhận nạp ${parsedItems.length} khoản mục`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
