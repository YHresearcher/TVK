"use client";

import { useState } from "react";
import type { ExecutiveAlertItem } from "@/lib/audit";
import { formatDate, todayISO } from "@/lib/format";

export default function DownloadAlertsExcelButton({
  alerts,
  label = "📥 Tải danh sách cần xử lý (.xlsx)",
  className,
  variant = "danger",
}: {
  alerts?: ExecutiveAlertItem[];
  label?: string;
  className?: string;
  variant?: "danger" | "primary" | "secondary" | "ghost";
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      if (alerts && alerts.length > 0) {
        // Xuất trực tiếp ở client tức thì không cần đợi gọi API
        const XLSX = await import("xlsx");
        const rows = alerts.map((a) => ({
          "Thời gian": formatDate(a.time),
          "Loại cảnh báo": a.level === "RED" ? "ĐỎ (Khẩn cấp)" : "VÀNG (Cảnh báo)",
          "Đối tác/NCC": a.partnerOrSupplier,
          "Mã chứng từ/Lô hàng": a.docOrBatch,
          "Số lượng/Số tiền chênh lệch": a.discrepancy,
          "Lý do cảnh báo": a.reason,
        }));

        const ws = XLSX.utils.json_to_sheet(rows);
        ws["!cols"] = [
          { wch: 14 },
          { wch: 18 },
          { wch: 28 },
          { wch: 24 },
          { wch: 26 },
          { wch: 65 },
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sai lệch TVK");
        const filename = `TVK_Danh_sach_sai_lech_${todayISO()}.xlsx`;
        XLSX.writeFile(wb, filename);
      } else {
        // Tải qua endpoint
        window.location.href = "/api/export/alerts";
      }
    } catch (err) {
      console.error("Lỗi xuất Excel:", err);
      // Fallback gọi endpoint
      window.location.href = "/api/export/alerts";
    } finally {
      setDownloading(false);
    }
  }

  const baseCls =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  const variantMap = {
    danger:
      "bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline-rose-600 active:bg-rose-800",
    primary:
      "bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600 active:bg-blue-800",
    secondary:
      "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-slate-500",
    ghost:
      "text-rose-600 hover:bg-rose-50 hover:text-rose-700 border border-rose-200",
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      className={className ?? `${baseCls} ${variantMap[variant]}`}
      title="Tải file Excel để gửi nhanh Zalo cho Kế toán và Thủ kho giải trình"
    >
      {downloading ? (
        <>
          <svg
            className="h-3.5 w-3.5 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <span>Đang tạo file Excel...</span>
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
