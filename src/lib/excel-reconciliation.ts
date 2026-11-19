/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReconciliationEntry, ReconciliationDataGroup } from "@/types";
import { normalizeHeader, toNum, toStr } from "./excel-parse";

export interface ParsedReconciliationRow {
  rowIdx: number;
  dataGroup?: ReconciliationDataGroup;
  itemKey?: string;
  itemName: string;
  accountingAmount: number;
  explanationNote?: string;
}

export interface ColumnMappingConfig {
  headerRowIdx: number;
  keyCol: number;
  nameCol: number;
  amountCol: number;
  noteCol: number;
}

const GROUP_NAMES: Record<ReconciliationDataGroup, string> = {
  CASH_FUND: "1. Quỹ tiền két & ngân hàng",
  RECEIVABLE: "2. Phải thu đối tác",
  PAYABLE: "3. Phải trả nhà cung cấp",
  INVENTORY: "4. Tồn kho tổng hợp",
  REVENUE_EXPENSE: "5. Doanh thu & Chi phí",
};

const STATUS_LABELS: Record<string, string> = {
  MATCHED: "Đã khớp",
  PENDING: "Chờ giải trình",
  VALID_TAX_TIMING: "Lệch hợp lệ (Thuế vs Nội bộ)",
  ACCOUNTING_ERROR: "Lỗi bên kế toán",
  TVK_ERROR: "Lỗi bên TVK",
};

/**
 * Tự động tìm vị trí các cột trong dòng tiêu đề
 */
export function detectReconciliationColumns(headerRow: unknown[]): {
  mapping: ColumnMappingConfig;
  autoDetected: boolean;
} {
  const normHeaders = headerRow.map(normalizeHeader);

  let keyCol = -1;
  let nameCol = -1;
  let amountCol = -1;
  let noteCol = -1;

  normHeaders.forEach((h, idx) => {
    // 1. Mã khoản mục (Code / Key)
    if (
      ["ma", "makhoanmuc", "madoituong", "code", "itemkey"].includes(h) ||
      h.startsWith("ma")
    ) {
      if (keyCol === -1) keyCol = idx;
    }

    // 2. Tên khoản mục / Đối tượng (Name)
    if (
      (
        ["ten", "tenkhoanmuc", "tendoituong", "name", "doituong", "khachhang", "ncc"].includes(h) ||
        h.includes("ten") ||
        (h.includes("doituong") && !h.startsWith("ma")) ||
        (h.includes("khoanmuc") && !h.startsWith("ma")) ||
        h.includes("khachhang") ||
        h.includes("nhacungcap") ||
        h.includes("ncc") ||
        h.includes("doitac")
      ) &&
      !h.startsWith("ma")
    ) {
      if (nameCol === -1) nameCol = idx;
    }

    // 3. Số tiền (Amount)
    if (
      [
        "sotien",
        "sotienketoan",
        "sodu",
        "soduketoan",
        "ketoan",
        "amount",
        "accamount",
        "phatsinh",
      ].includes(h) ||
      h.includes("sodu") ||
      h.includes("sotien") ||
      h.includes("phatsinh") ||
      h.includes("amount") ||
      h.includes("duno") ||
      h.includes("duco") ||
      h.includes("giatri")
    ) {
      if (amountCol === -1) amountCol = idx;
    }

    // 4. Ghi chú (Note)
    if (
      ["ghichu", "ghichuketoan", "giaitrinh", "note", "diengiai"].includes(h) ||
      h.includes("ghichu") ||
      h.includes("giaitrinh") ||
      h.includes("diengiai")
    ) {
      if (noteCol === -1) noteCol = idx;
    }
  });

  const autoDetected = nameCol !== -1 && amountCol !== -1;

  return {
    mapping: {
      headerRowIdx: 0,
      keyCol: keyCol !== -1 ? keyCol : 1,
      nameCol: nameCol !== -1 ? nameCol : 2,
      amountCol: amountCol !== -1 ? amountCol : 3,
      noteCol: noteCol !== -1 ? noteCol : 4,
    },
    autoDetected,
  };
}

/**
 * Phân tích dữ liệu AOA từ file Excel đã tải lên theo mapping đã chọn
 */
export function parseReconciliationRows(
  rows: unknown[][],
  mapping: ColumnMappingConfig
): {
  parsedRows: ParsedReconciliationRow[];
  skippedCount: number;
} {
  const parsedRows: ParsedReconciliationRow[] = [];
  let skippedCount = 0;

  for (let r = mapping.headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !Array.isArray(row) || row.length === 0) {
      skippedCount++;
      continue;
    }

    const itemKey = mapping.keyCol >= 0 ? toStr(row[mapping.keyCol]) : "";
    const itemName = mapping.nameCol >= 0 ? toStr(row[mapping.nameCol]) : "";
    const accountingAmount = mapping.amountCol >= 0 ? toNum(row[mapping.amountCol]) : 0;
    const explanationNote = mapping.noteCol >= 0 ? toStr(row[mapping.noteCol]) : "";

    // Bỏ qua dòng trống không có tên và không có mã
    if (!itemName && !itemKey) {
      skippedCount++;
      continue;
    }

    parsedRows.push({
      rowIdx: r + 1,
      itemKey: itemKey || undefined,
      itemName: itemName || itemKey,
      accountingAmount,
      explanationNote: explanationNote || undefined,
    });
  }

  return { parsedRows, skippedCount };
}

/**
 * Tính tổng số TVK, Kế toán và Chênh lệch cho snapshot (Mathematical Invariant)
 * Luôn loại trừ REV_TOTAL (tránh cộng đúp doanh thu) và INV_CONSIGNED_REF (hàng ký gửi tham khảo)
 */
export function calculateSnapshotTotals(
  entries: Array<{
    item_key: string;
    tvk_amount?: number | null;
    accounting_amount?: number | null;
  }>
): { totalTvk: number; totalAcc: number; totalDiff: number } {
  const nonExcluded = entries.filter(
    (e) => e.item_key !== "REV_TOTAL" && e.item_key !== "INV_CONSIGNED_REF"
  );
  const totalTvk = nonExcluded.reduce((acc, e) => acc + Number(e.tvk_amount || 0), 0);
  const totalAcc = nonExcluded.reduce((acc, e) => acc + Number(e.accounting_amount || 0), 0);
  const totalDiff = totalTvk - totalAcc;
  return { totalTvk, totalAcc, totalDiff };
}

/**
 * Xuất file Excel Biên bản đối chiếu 2 tầng gồm 2 sheet
 * Sheet 1: Biên bản tổng hợp 5 nhóm
 * Sheet 2: Danh sách các khoản mục chênh lệch cần giải trình
 */
export async function buildReconciliationExportWorkbook(params: {
  periodName: string;
  dateRange: string;
  entries: ReconciliationEntry[];
}): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const { periodName, dateRange, entries } = params;

  // -------------------------------------------------------------------------
  // SHEET 1: BIÊN BẢN TỔNG HỢP
  // -------------------------------------------------------------------------
  const sheet1Data: (string | number)[][] = [
    ["CÔNG TY TNHH PHỤ TÙNG Ô TÔ TVK"],
    ["BIÊN BẢN ĐỐI CHIẾU SỐ LIỆU 2 TẦNG (TVK ↔ KẾ TOÁN NGOÀI)"],
    [`Kỳ đối chiếu: ${periodName} (${dateRange})`],
    [`Thời điểm xuất báo cáo: ${new Date().toLocaleString("vi-VN")}`],
    [],
    [
      "STT",
      "Nhóm dữ liệu",
      "Mã khoản mục",
      "Tên khoản mục",
      "Diễn giải / Chi tiết",
      "Số TVK (VNĐ)",
      "Số Kế toán (VNĐ)",
      "Chênh lệch (VNĐ)",
      "Đánh giá / Phân loại",
      "Ghi chú giải trình",
    ],
  ];

  let stt = 1;
  let totalTvk = 0;
  let totalAcc = 0;
  let totalDiff = 0;

  for (const e of entries) {
    const isExcluded = e.item_key === "REV_TOTAL" || e.item_key === "INV_CONSIGNED_REF";
    const tvk = Number(e.tvk_amount || 0);
    const acc = Number(e.accounting_amount || 0);
    const diff = Number(e.difference_amount || 0);

    if (!isExcluded) {
      totalTvk += tvk;
      totalAcc += acc;
      totalDiff += diff;
    }

    sheet1Data.push([
      stt++,
      GROUP_NAMES[e.data_group] || e.data_group,
      e.item_key,
      e.item_name,
      e.item_subtext || "",
      tvk,
      acc,
      diff,
      STATUS_LABELS[e.discrepancy_status] || e.discrepancy_status,
      e.explanation_note || "",
    ]);
  }

  // Dòng tổng cộng
  sheet1Data.push([
    "",
    "TỔNG CỘNG (TÀI SẢN & DOANH THU THỰC)",
    "",
    "",
    "Không tính dòng tham khảo ký gửi & dòng tổng đúp",
    totalTvk,
    totalAcc,
    totalDiff,
    totalDiff === 0 ? "Khớp hoàn toàn" : "Có chênh lệch",
    "",
  ]);

  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);

  // Set column widths
  ws1["!cols"] = [
    { wch: 6 },  // STT
    { wch: 28 }, // Nhóm
    { wch: 22 }, // Mã
    { wch: 32 }, // Tên
    { wch: 38 }, // Diễn giải
    { wch: 18 }, // Số TVK
    { wch: 18 }, // Số KT
    { wch: 18 }, // Lệch
    { wch: 26 }, // Trạng thái
    { wch: 40 }, // Ghi chú
  ];

  XLSX.utils.book_append_sheet(wb, ws1, "Bien_Ban_Tong_Hop");

  // -------------------------------------------------------------------------
  // SHEET 2: DANH SÁCH SAI LỆCH CẦN GIẢI TRÌNH
  // -------------------------------------------------------------------------
  const discrepantEntries = entries.filter(
    (e) => Math.abs(Number(e.difference_amount || 0)) >= 0.01
  );

  const sheet2Data: (string | number)[][] = [
    ["CÔNG TY TNHH PHỤ TÙNG Ô TÔ TVK"],
    ["DANH SÁCH CÁC KHOẢN MỤC SAI LỆCH CẦN GIẢI TRÌNH"],
    [`Kỳ đối chiếu: ${periodName} (${dateRange})`],
    [`Tổng số khoản mục lệch: ${discrepantEntries.length} mục`],
    [],
    [
      "STT",
      "Nhóm dữ liệu",
      "Mã khoản mục",
      "Tên khoản mục",
      "Số TVK (VNĐ)",
      "Số Kế toán (VNĐ)",
      "Chênh lệch (TVK - KT)",
      "Phân loại nguyên nhân",
      "Nội dung giải trình",
    ],
  ];

  let stt2 = 1;
  for (const e of discrepantEntries) {
    sheet2Data.push([
      stt2++,
      GROUP_NAMES[e.data_group] || e.data_group,
      e.item_key,
      e.item_name,
      Number(e.tvk_amount || 0),
      Number(e.accounting_amount || 0),
      Number(e.difference_amount || 0),
      STATUS_LABELS[e.discrepancy_status] || e.discrepancy_status,
      e.explanation_note || "Chưa có giải trình",
    ]);
  }

  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
  ws2["!cols"] = [
    { wch: 6 },
    { wch: 28 },
    { wch: 22 },
    { wch: 32 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 26 },
    { wch: 45 },
  ];

  XLSX.utils.book_append_sheet(wb, ws2, "Danh_Sach_Sai_Lech");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Uint8Array(wbout);
}

/**
 * Tạo file mẫu Excel chuẩn để kế toán điền số liệu nạp vào hệ thống
 */
export async function buildReconciliationTemplateWorkbook(
  entries?: ReconciliationEntry[]
): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const templateData: (string | number)[][] = [
    ["MẪU NHẬP SỐ LIỆU ĐỐI CHIẾU KẾ TOÁN (TVK)"],
    ["Hướng dẫn: Điền số liệu kế toán vào cột 'Số tiền Kế toán (VNĐ)' và ghi chú nếu có."],
    [],
    [
      "Nhóm dữ liệu",
      "Mã khoản mục",
      "Tên khoản mục",
      "Số tiền Kế toán (VNĐ)",
      "Ghi chú Kế toán",
    ],
  ];

  if (entries && entries.length > 0) {
    for (const e of entries) {
      templateData.push([
        GROUP_NAMES[e.data_group] || e.data_group,
        e.item_key,
        e.item_name,
        Number(e.accounting_amount || 0),
        e.explanation_note || "",
      ]);
    }
  } else {
    // Dữ liệu mẫu demo
    templateData.push(
      ["1. Quỹ tiền két & ngân hàng", "FUND_CASH", "Két tiền mặt", 25000000, "Khớp sổ quỹ"],
      ["1. Quỹ tiền két & ngân hàng", "FUND_VCB", "Ngân hàng VCB", 120500000, "Khớp sao kê"],
      ["2. Phải thu đối tác", "REC_AU_CHAU", "Cty Âu Châu", 416343000, "Công nợ theo HĐ GTGT"],
      ["3. Phải trả nhà cung cấp", "PAY_SMS", "SMS Trung Quốc", 210000000, "Nợ nhập lô 09/2026"],
      ["4. Tồn kho tổng hợp", "INV_OWN_WAREHOUSE", "Hàng sở hữu tại kho TVK", 3224220325, "Theo sổ kho"],
      ["5. Doanh thu & Chi phí", "REV_VAT_ISSUED", "Doanh thu: Đã xuất HĐ GTGT", 416343000, "Kê khai thuế"]
    );
  }

  const ws = XLSX.utils.aoa_to_sheet(templateData);
  ws["!cols"] = [
    { wch: 28 },
    { wch: 22 },
    { wch: 35 },
    { wch: 24 },
    { wch: 40 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Mau_Doi_Chieu");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Uint8Array(wbout);
}
