"use client";

import { useState } from "react";
import type { ThreeWayMatchingRow } from "@/lib/audit";
import { formatDate, todayISO } from "@/lib/format";

export default function AuditCenterClient({
  rows,
  discrepancyRows,
}: {
  rows: ThreeWayMatchingRow[];
  discrepancyRows: ThreeWayMatchingRow[];
}) {
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function exportToExcel(targetRows: ThreeWayMatchingRow[], filenamePrefix: string) {
    if (!targetRows.length) {
      setNotice("Không có dòng dữ liệu nào để xuất file Excel.");
      setTimeout(() => setNotice(null), 4000);
      return;
    }
    setExporting(true);
    setNotice(null);
    try {
      const XLSX = await import("xlsx");
      const exportData = targetRows.map((r) => ({
        "Tín hiệu": r.signalLabel,
        "Thực tế giao/tiêu thụ": r.physicalDocCode,
        "Ngày thực tế": formatDate(r.physicalDate),
        "Mã chứng từ nội bộ": r.salesDocCode,
        "Ngày chứng từ": formatDate(r.salesDocDate),
        "Loại": r.salesDocKind,
        "Đối tác/Gara": r.partnerName,
        "SKU": r.productSku,
        "Tên sản phẩm": r.productName,
        "Lô hàng": r.batchCode,
        "Số lượng": r.qty,
        "Đơn giá bán": r.unitPrice,
        "Thành tiền bán": r.lineTotal,
        "Giá vốn lô": r.unitCost,
        "Lãi gộp": r.grossProfit,
        "Tỷ suất (%)": r.marginPercent,
        "Tình trạng HĐ GTGT": r.invoiceStatusLabel,
        "Số HĐ": r.invoiceNo,
        "Ký hiệu HĐ": r.invoiceSymbol,
        "Ngày HĐ": r.invoiceDate,
        "Trạng thái công nợ": r.debtStatusLabel,
        "Hạn công nợ": formatDate(r.debtDueDate),
        "Tiền nợ còn lại": r.remainingAmount,
        "Kết luận kiểm soát / Sai lệch": r.discrepancyReason,
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      ws["!cols"] = [
        { wch: 18 }, // Tín hiệu
        { wch: 22 }, // Thực tế
        { wch: 14 }, // Ngày
        { wch: 16 }, // Chứng từ
        { wch: 14 }, // Ngày
        { wch: 8 },  // Loại
        { wch: 26 }, // Đối tác
        { wch: 16 }, // SKU
        { wch: 28 }, // Tên SP
        { wch: 16 }, // Lô
        { wch: 10 }, // SL
        { wch: 14 }, // Đơn giá
        { wch: 16 }, // Thành tiền
        { wch: 14 }, // Giá vốn
        { wch: 14 }, // Lãi gộp
        { wch: 12 }, // %
        { wch: 22 }, // Tình trạng HĐ
        { wch: 12 }, // Số HĐ
        { wch: 14 }, // Ký hiệu
        { wch: 14 }, // Ngày HĐ
        { wch: 22 }, // Trạng thái nợ
        { wch: 14 }, // Hạn nợ
        { wch: 16 }, // Nợ còn lại
        { wch: 45 }, // Kết luận
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "DoiSoat3Ben");
      const filename = `${filenamePrefix}_${todayISO()}.xlsx`;
      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error("Lỗi xuất Excel:", err);
      setNotice("Có lỗi khi tạo file Excel. Vui lòng thử lại.");
      setTimeout(() => setNotice(null), 4000);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Nút xuất dòng lệch */}
        <button
          type="button"
          onClick={() => exportToExcel(discrepancyRows, "TVK_Doi_soat_cac_dong_lech")}
          disabled={exporting || discrepancyRows.length === 0}
          className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-40 transition-colors"
          title="Chỉ xuất các dòng có sai lệch / Đèn Đỏ để gửi giải trình"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>Tải danh sách cần xử lý ({discrepancyRows.length}) (.xlsx)</span>
        </button>

        {/* Nút xuất toàn bộ danh sách đang lọc */}
        <button
          type="button"
          onClick={() => exportToExcel(rows, "TVK_Bang_doi_soat_3_ben")}
          disabled={exporting || rows.length === 0}
          className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40 transition-colors"
          title="Xuất các dòng đang hiển thị theo bộ lọc"
        >
          <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Xuất bảng đang xem ({rows.length}) (.xlsx)</span>
        </button>
      </div>

      {notice && (
        <span className="rounded bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 border border-rose-200">
          {notice}
        </span>
      )}
    </div>
  );
}
