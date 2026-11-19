/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ReconciliationPeriod,
  ReconciliationEntry,
  ReconciliationSnapshot,
  ReconciliationDataGroup,
  DiscrepancyStatus,
  ReconciliationPeriodType,
} from "@/types";
import {
  syncReconciliationAction,
  updateReconciliationEntryAction,
  createReconciliationSnapshotAction,
} from "@/lib/reconciliation-actions";
import {
  buildReconciliationExportWorkbook,
  buildReconciliationTemplateWorkbook,
} from "@/lib/excel-reconciliation";
import DrillDownDrawer from "./DrillDownDrawer";
import ExcelImportModal from "./ExcelImportModal";
import SnapshotHistoryModal from "./SnapshotHistoryModal";

interface ReconciliationClientProps {
  initialPeriod: ReconciliationPeriod | null;
  initialEntries: ReconciliationEntry[];
  initialSnapshots: ReconciliationSnapshot[];
  allPeriods: ReconciliationPeriod[];
  userRole: string;
}

const DATA_GROUPS_CONFIG: {
  key: ReconciliationDataGroup;
  title: string;
  badge: string;
  dotColor: string;
}[] = [
  {
    key: "CASH_FUND",
    title: "1. Quỹ tiền két & Tài khoản ngân hàng",
    badge: "cash_funds",
    dotColor: "bg-blue-500",
  },
  {
    key: "RECEIVABLE",
    title: "2. Phải thu từng khách hàng / Đối tác",
    badge: "partner_receivables",
    dotColor: "bg-emerald-500",
  },
  {
    key: "PAYABLE",
    title: "3. Phải trả từng nhà cung cấp",
    badge: "supplier_payables",
    dotColor: "bg-amber-500",
  },
  {
    key: "INVENTORY",
    title: "4. Tồn kho theo giá trị tổng hợp",
    badge: "stock_valuation",
    dotColor: "bg-purple-500",
  },
  {
    key: "REVENUE_EXPENSE",
    title: "5. Doanh thu & Chi phí theo nhóm gọn",
    badge: "revenue_expenses",
    dotColor: "bg-rose-500",
  },
];

const DISCREPANCY_OPTIONS: { value: DiscrepancyStatus; label: string; color: string }[] = [
  { value: "MATCHED", label: "Đã khớp", color: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { value: "PENDING", label: "Chờ giải trình", color: "bg-rose-100 text-rose-800 border-rose-300" },
  {
    value: "VALID_TAX_TIMING",
    label: "Lệch hợp lệ (Thuế vs Nội bộ)",
    color: "bg-amber-100 text-amber-800 border-amber-300",
  },
  {
    value: "ACCOUNTING_ERROR",
    label: "Lỗi bên kế toán",
    color: "bg-purple-100 text-purple-800 border-purple-300",
  },
  { value: "TVK_ERROR", label: "Lỗi bên TVK", color: "bg-orange-100 text-orange-800 border-orange-300" },
];

export default function ReconciliationClient({
  initialPeriod,
  initialEntries,
  initialSnapshots,
  allPeriods,
  userRole,
}: ReconciliationClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // State
  const period = initialPeriod;
  const [entries, setEntries] = useState<ReconciliationEntry[]>(initialEntries);
  const snapshots = initialSnapshots;

  // Filter & Period selection state
  const [periodType, setPeriodType] = useState<ReconciliationPeriodType>(
    initialPeriod?.period_type || "MONTH"
  );
  const [selectedMonth, setSelectedMonth] = useState<string>(
    initialPeriod?.from_date?.slice(0, 7) || "2026-10"
  );
  const [customFrom, setCustomFrom] = useState<string>(
    initialPeriod?.from_date || "2026-10-01"
  );
  const [customTo, setCustomTo] = useState<string>(
    initialPeriod?.to_date || "2026-10-31"
  );

  // Modals & Drawers
  const [activeDrillDown, setActiveDrillDown] = useState<ReconciliationEntry | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [isCreateSnapshotOpen, setIsCreateSnapshotOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshotNote, setSnapshotNote] = useState("");

  // Loading & sync feedback
  const [syncing, setSyncing] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  const canEdit = userRole === "OWNER" || userRole === "ACCOUNTING";
  const isOwner = userRole === "OWNER";

  const fmt = (n?: number) => (n ?? 0).toLocaleString("vi-VN");

  // Xử lý thay đổi kỳ đối chiếu
  const handleSelectPeriod = (type: ReconciliationPeriodType, monthVal?: string, fromVal?: string, toVal?: string) => {
    let from = fromVal || customFrom;
    let to = toVal || customTo;

    if (type === "MONTH") {
      const ym = monthVal || selectedMonth;
      setSelectedMonth(ym);
      from = `${ym}-01`;
      const [yearStr, monthStr] = ym.split("-");
      const lastDay = new Date(Number(yearStr), Number(monthStr), 0).getDate();
      to = `${ym}-${String(lastDay).padStart(2, "0")}`;
    }

    setPeriodType(type);
    setCustomFrom(from);
    setCustomTo(to);

    startTransition(() => {
      router.push(`/reconciliation?type=${type}&from=${from}&to=${to}`);
      router.refresh();
    });
  };

  // Đồng bộ số liệu live TVK
  const handleSyncTVK = async () => {
    if (!period) return;
    setSyncing(true);
    setActionMessage(null);

    try {
      const res = await syncReconciliationAction(period.id);
      if (res.success) {
        setActionMessage({
          type: "success",
          text: `Đã đồng bộ thành công ${res.count} khoản mục với dữ liệu TVK mới nhất.`,
        });
        startTransition(() => {
          router.refresh();
        });
      } else {
        setActionMessage({ type: "error", text: res.error });
      }
    } finally {
      setSyncing(false);
    }
  };

  // Cập nhật số liệu kế toán hoặc ghi chú của một entry
  const handleUpdateEntry = async (
    entryId: string,
    updates: {
      accountingAmount?: number;
      discrepancyStatus?: DiscrepancyStatus;
      explanationNote?: string | null;
    }
  ) => {
    if (!canEdit) return;

    // Cập nhật optimistic trên giao diện
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const newAcc = updates.accountingAmount !== undefined ? updates.accountingAmount : e.accounting_amount;
        const newDiff = Number(e.tvk_amount || 0) - newAcc;
        let newStatus = updates.discrepancyStatus || e.discrepancy_status;
        if (updates.accountingAmount !== undefined && !updates.discrepancyStatus) {
          if (Math.abs(newDiff) < 0.01) {
            newStatus = "MATCHED";
          } else if (e.discrepancy_status === "MATCHED") {
            newStatus = "PENDING";
          }
        }
        return {
          ...e,
          accounting_amount: newAcc,
          difference_amount: newDiff,
          discrepancy_status: newStatus,
          explanation_note:
            updates.explanationNote !== undefined ? updates.explanationNote : e.explanation_note,
        };
      })
    );

    try {
      const res = await updateReconciliationEntryAction({
        entryId,
        ...updates,
      });

      if (!res.success) {
        setActionMessage({ type: "error", text: res.error });
      }
    } catch (err: any) {
      setActionMessage({ type: "error", text: err.message || "Lỗi cập nhật dòng đối chiếu" });
    }
  };

  // Tạo Snapshot (Lưu bản chốt kỳ)
  const handleCreateSnapshot = async () => {
    if (!period || !isOwner) return;
    setSyncing(true);
    setActionMessage(null);

    try {
      const res = await createReconciliationSnapshotAction(
        period.id,
        snapshotName || undefined,
        snapshotNote || undefined
      );

      if (res.success) {
        setIsCreateSnapshotOpen(false);
        setSnapshotName("");
        setSnapshotNote("");
        setActionMessage({
          type: "success",
          text: "Đã lưu bản chốt kỳ (Snapshot) bất biến thành công!",
        });
        startTransition(() => {
          router.refresh();
        });
      } else {
        setActionMessage({ type: "error", text: res.error });
      }
    } finally {
      setSyncing(false);
    }
  };

  // Xuất file Excel 2 sheet
  const handleExportExcel = async () => {
    if (!period) return;
    try {
      const dateRangeStr = `${period.from_date} đến ${period.to_date}`;
      const buf = await buildReconciliationExportWorkbook({
        periodName: period.name,
        dateRange: dateRangeStr,
        entries,
      });

      const blob = new Blob([buf as any], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bien_Ban_Doi_Chieu_${period.from_date}_${period.to_date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Lỗi xuất file Excel: " + err.message);
    }
  };

  // Tải file mẫu Excel
  const handleDownloadTemplate = async () => {
    try {
      const buf = await buildReconciliationTemplateWorkbook(entries);
      const blob = new Blob([buf as any], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Mau_Doi_Chieu_Ke_Toan_TVK.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Lỗi tải file mẫu: " + err.message);
    }
  };

  // Tính KPI tổng hợp (Loại trừ các dòng tham khảo & dòng cộng đúp)
  let totalTvk = 0;
  let totalAcc = 0;
  let matchedCount = 0;
  let pendingCount = 0;
  let validTaxCount = 0;
  let accErrorCount = 0;
  let tvkErrorCount = 0;

  for (const e of entries) {
    const isExcluded = e.item_key === "REV_TOTAL" || e.item_key === "INV_CONSIGNED_REF";
    if (!isExcluded) {
      totalTvk += Number(e.tvk_amount || 0);
      totalAcc += Number(e.accounting_amount || 0);
    }

    switch (e.discrepancy_status) {
      case "MATCHED":
        matchedCount++;
        break;
      case "PENDING":
        pendingCount++;
        break;
      case "VALID_TAX_TIMING":
        validTaxCount++;
        break;
      case "ACCOUNTING_ERROR":
        accErrorCount++;
        break;
      case "TVK_ERROR":
        tvkErrorCount++;
        break;
    }
  }

  const netDiff = totalTvk - totalAcc;

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {actionMessage && (
        <div
          className={`p-3 rounded-lg text-xs font-medium border flex items-center justify-between ${
            actionMessage.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          <span>{actionMessage.text}</span>
          <button
            onClick={() => setActionMessage(null)}
            className="text-stone-400 hover:text-stone-700 ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* TOP HEADER & CONTROLS */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">
              Trung Tâm Đối Chiếu Kế Toán 2 Tầng & Chốt Kỳ
            </h1>
            {period && (
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  period.status === "RECONCILED"
                    ? "bg-purple-100 text-purple-800 border border-purple-200"
                    : period.status === "LOCKED"
                    ? "bg-stone-200 text-stone-800"
                    : "bg-blue-100 text-blue-800 border border-blue-200"
                }`}
              >
                {period.status === "RECONCILED" ? "ĐÃ CHỐT KỲ" : period.status === "LOCKED" ? "ĐÃ KHOÁ" : "ĐANG MỞ"}
              </span>
            )}
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Đối soát độc lập 2 tầng: Số liệu thực tế vận hành TVK ↔ Số liệu Kế toán thuế / Bảng cân đối ngoài
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-50 transition flex items-center gap-1.5"
            >
              <span>📥</span> Import Excel
            </button>
          )}

          <button
            onClick={handleDownloadTemplate}
            className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-50 transition flex items-center gap-1.5"
          >
            <span>📄</span> File mẫu
          </button>

          <button
            onClick={handleExportExcel}
            className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-50 transition flex items-center gap-1.5"
          >
            <span>📊</span> Xuất biên bản .xlsx
          </button>

          {isOwner && (
            <button
              onClick={() => {
                setSnapshotName(
                  period ? `${period.name} - Bản chốt ${snapshots.length + 1}` : ""
                );
                setIsCreateSnapshotOpen(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition flex items-center gap-1.5"
            >
              <span>💾</span> Lưu bản chốt kỳ (Snapshot)
            </button>
          )}

          <button
            onClick={() => setIsSnapshotModalOpen(true)}
            className="px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 text-xs font-semibold transition flex items-center gap-1.5"
          >
            <span>🕒</span> Lịch sử ({snapshots.length})
          </button>
        </div>
      </div>

      {/* PERIOD SELECTOR & SYNC BAR */}
      <div className="bg-stone-50 p-4 rounded-xl border border-stone-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-stone-700">Chọn kỳ đối chiếu:</span>

          {/* Type selector */}
          <div className="inline-flex rounded-lg border border-stone-300 bg-white p-0.5">
            <button
              onClick={() => handleSelectPeriod("MONTH")}
              className={`px-3 py-1 rounded-md font-medium transition ${
                periodType === "MONTH" ? "bg-stone-900 text-white shadow-sm" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              Theo Tháng
            </button>
            <button
              onClick={() => handleSelectPeriod("WEEK")}
              className={`px-3 py-1 rounded-md font-medium transition ${
                periodType === "WEEK" ? "bg-stone-900 text-white shadow-sm" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              Theo Tuần
            </button>
            <button
              onClick={() => handleSelectPeriod("CUSTOM")}
              className={`px-3 py-1 rounded-md font-medium transition ${
                periodType === "CUSTOM" ? "bg-stone-900 text-white shadow-sm" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              Tuỳ chọn ngày
            </button>
          </div>

          {/* Month selector dropdown */}
          {periodType === "MONTH" && (
            <select
              value={selectedMonth}
              onChange={(e) => handleSelectPeriod("MONTH", e.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 font-semibold text-stone-800 shadow-sm"
            >
              <option value="2026-09">Tháng 09/2026 (Khối mẫu Q3)</option>
              <option value="2026-10">Tháng 10/2026 (Kỳ kiểm chứng chính)</option>
              <option value="2026-11">Tháng 11/2026 (Chốt đợt HOWO)</option>
              <option value="2026-12">Tháng 12/2026</option>
              <option value="2026-01">Tháng 01/2026</option>
              {allPeriods
                .filter(
                  (p) =>
                    p.period_type === "MONTH" &&
                    !["2026-09", "2026-10", "2026-11", "2026-12", "2026-01"].includes(
                      p.from_date.slice(0, 7)
                    )
                )
                .map((p) => (
                  <option key={p.id} value={p.from_date.slice(0, 7)}>
                    {p.name}
                  </option>
                ))}
            </select>
          )}

          {/* Date Range picker */}
          {(periodType === "CUSTOM" || periodType === "WEEK") && (
            <div className="flex items-center gap-1.5 bg-white border border-stone-300 px-2 py-1 rounded-lg">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="text-stone-800 text-xs border-none focus:outline-none"
              />
              <span className="text-stone-400">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="text-stone-800 text-xs border-none focus:outline-none"
              />
              <button
                onClick={() => handleSelectPeriod(periodType, undefined, customFrom, customTo)}
                className="ml-1 px-2 py-0.5 bg-blue-600 text-white rounded text-[11px] font-semibold hover:bg-blue-700"
              >
                Áp dụng
              </button>
            </div>
          )}
        </div>

        {/* Sync Live TVK button */}
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              disabled={syncing || isPending}
              onClick={handleSyncTVK}
              className="px-3 py-1.5 rounded-lg bg-white border border-stone-300 hover:border-blue-500 text-stone-700 hover:text-blue-600 font-semibold shadow-sm transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <svg
                className={`w-3.5 h-3.5 ${syncing || isPending ? "animate-spin text-blue-600" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {syncing ? "Đang đồng bộ..." : "Đồng bộ số TVK"}
            </button>
          )}
        </div>
      </div>

      {/* KPI SUMMARY CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* Tổng TVK */}
        <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
          <span className="text-[11px] font-medium text-stone-500 block">Tổng số TVK</span>
          <span className="text-sm font-bold text-blue-700 font-mono mt-1 block">
            {fmt(totalTvk)} đ
          </span>
          <span className="text-[10px] text-stone-400 block mt-0.5">Tự động tính từ sổ TVK</span>
        </div>

        {/* Tổng Kế toán */}
        <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
          <span className="text-[11px] font-medium text-stone-500 block">Tổng Kế toán</span>
          <span className="text-sm font-bold text-stone-900 font-mono mt-1 block">
            {fmt(totalAcc)} đ
          </span>
          <span className="text-[10px] text-stone-400 block mt-0.5">Kế toán nhập / import</span>
        </div>

        {/* Chênh lệch ròng */}
        <div
          className={`p-3.5 rounded-xl border shadow-sm ${
            Math.abs(netDiff) < 0.01
              ? "bg-emerald-50/60 border-emerald-200"
              : "bg-rose-50/60 border-rose-200"
          }`}
        >
          <span className="text-[11px] font-medium text-stone-600 block">Chênh lệch ròng</span>
          <span
            className={`text-sm font-bold font-mono mt-1 block ${
              Math.abs(netDiff) < 0.01 ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {netDiff > 0 ? "+" : ""}
            {fmt(netDiff)} đ
          </span>
          <span
            className={`text-[10px] font-semibold block mt-0.5 ${
              Math.abs(netDiff) < 0.01 ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {Math.abs(netDiff) < 0.01 ? "✓ Khớp hoàn toàn" : "🔴 Có chênh lệch"}
          </span>
        </div>

        {/* Đã khớp */}
        <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
          <span className="text-[11px] font-medium text-stone-500 block">Đã khớp (MATCHED)</span>
          <span className="text-lg font-bold text-emerald-600 mt-1 block font-mono">
            {matchedCount}
          </span>
          <span className="text-[10px] text-stone-400 block mt-0.5">Khoản mục = 0đ</span>
        </div>

        {/* Chờ giải trình */}
        <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
          <span className="text-[11px] font-medium text-stone-500 block">Chờ giải trình</span>
          <span
            className={`text-lg font-bold mt-1 block font-mono ${
              pendingCount > 0 ? "text-rose-600" : "text-stone-400"
            }`}
          >
            {pendingCount}
          </span>
          <span className="text-[10px] text-stone-400 block mt-0.5">Chưa phân loại lệch</span>
        </div>

        {/* Lệch hợp lệ */}
        <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
          <span className="text-[11px] font-medium text-stone-500 block">Lệch hợp lệ</span>
          <span className="text-lg font-bold text-amber-600 mt-1 block font-mono">
            {validTaxCount}
          </span>
          <span className="text-[10px] text-stone-400 block mt-0.5">Thuế vs Ký gửi nội bộ</span>
        </div>

        {/* Lỗi bên KT */}
        <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
          <span className="text-[11px] font-medium text-stone-500 block">Lỗi Kế toán</span>
          <span className="text-lg font-bold text-purple-600 mt-1 block font-mono">
            {accErrorCount}
          </span>
          <span className="text-[10px] text-stone-400 block mt-0.5">Sót phiếu/nhầm nợ</span>
        </div>

        {/* Lỗi bên TVK */}
        <div className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-sm">
          <span className="text-[11px] font-medium text-stone-500 block">Lỗi bên TVK</span>
          <span className="text-lg font-bold text-orange-600 mt-1 block font-mono">
            {tvkErrorCount}
          </span>
          <span className="text-[10px] text-stone-400 block mt-0.5">Kho nhập trùng/quên</span>
        </div>
      </div>

      {/* 5 DATA GROUPS ACCORDION / TABLES */}
      <div className="space-y-6">
        {DATA_GROUPS_CONFIG.map((group) => {
          const groupEntries = entries.filter((e) => e.data_group === group.key);
          const groupTvk = groupEntries.reduce((sum, e) => {
            if (e.item_key === "REV_TOTAL" || e.item_key === "INV_CONSIGNED_REF") return sum;
            return sum + Number(e.tvk_amount || 0);
          }, 0);
          const groupAcc = groupEntries.reduce((sum, e) => {
            if (e.item_key === "REV_TOTAL" || e.item_key === "INV_CONSIGNED_REF") return sum;
            return sum + Number(e.accounting_amount || 0);
          }, 0);
          const groupDiff = groupTvk - groupAcc;

          return (
            <div
              key={group.key}
              className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden"
            >
              {/* Group Header */}
              <div className="bg-stone-50/80 px-5 py-3.5 border-b border-stone-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${group.dotColor}`} />
                  <h3 className="font-bold text-sm text-stone-900">{group.title}</h3>
                  <span className="text-xs text-stone-400 font-mono">({groupEntries.length} mục)</span>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono">
                  <div>
                    <span className="text-stone-400 mr-1.5 font-sans">TVK:</span>
                    <span className="font-semibold text-blue-700">{fmt(groupTvk)} đ</span>
                  </div>
                  <div>
                    <span className="text-stone-400 mr-1.5 font-sans">Kế toán:</span>
                    <span className="font-semibold text-stone-800">{fmt(groupAcc)} đ</span>
                  </div>
                  <div>
                    <span className="text-stone-400 mr-1.5 font-sans">Lệch:</span>
                    <span
                      className={`font-bold ${
                        Math.abs(groupDiff) < 0.01 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {groupDiff > 0 ? "+" : ""}
                      {fmt(groupDiff)} đ
                    </span>
                  </div>
                </div>
              </div>

              {/* Group Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-100/60 text-stone-600 font-semibold border-b border-stone-200">
                    <tr>
                      <th className="py-2.5 px-4 w-52">Khoản mục / Đối tượng</th>
                      <th className="py-2.5 px-4 text-right w-40">Số TVK (đ)</th>
                      <th className="py-2.5 px-4 text-right w-44">Số Kế toán (đ)</th>
                      <th className="py-2.5 px-4 text-right w-40">Chênh lệch (đ)</th>
                      <th className="py-2.5 px-4 w-48 text-center">Phân loại lệch</th>
                      <th className="py-2.5 px-4">Ghi chú giải trình</th>
                      <th className="py-2.5 px-4 text-center w-28">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {groupEntries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-6 text-stone-400 text-xs">
                          Chưa có khoản mục phát sinh trong kỳ đối chiếu này.
                        </td>
                      </tr>
                    ) : (
                      groupEntries.map((entry) => {
                        const isConsignedRef = entry.item_key === "INV_CONSIGNED_REF";
                        const isRevTotal = entry.item_key === "REV_TOTAL";
                        const diff = Number(entry.difference_amount || 0);
                        const isMatched = Math.abs(diff) < 0.01;

                        return (
                          <tr
                            key={entry.id}
                            className={`hover:bg-blue-50/30 transition ${
                              isConsignedRef
                                ? "bg-stone-50/70 text-stone-600 italic"
                                : isRevTotal
                                ? "bg-stone-50 font-bold"
                                : ""
                            }`}
                          >
                            {/* Tên khoản mục */}
                            <td className="py-3 px-4">
                              <span className="font-semibold text-stone-900 block">
                                {entry.item_name}
                              </span>
                              {entry.item_subtext && (
                                <span className="text-[11px] text-stone-500 block mt-0.5">
                                  {entry.item_subtext}
                                </span>
                              )}
                              <span className="text-[10px] font-mono text-stone-400">
                                {entry.item_key}
                              </span>
                            </td>

                            {/* Số TVK */}
                            <td className="py-3 px-4 text-right font-mono font-bold text-blue-700">
                              {fmt(entry.tvk_amount)}
                            </td>

                            {/* Số Kế toán (Editable) */}
                            <td className="py-3 px-4 text-right">
                              {canEdit && !isRevTotal ? (
                                <div className="inline-flex items-center gap-1 justify-end">
                                  <input
                                    type="number"
                                    defaultValue={entry.accounting_amount || 0}
                                    onBlur={(e) => {
                                      const val = Number(e.target.value || 0);
                                      if (val !== entry.accounting_amount) {
                                        handleUpdateEntry(entry.id, { accountingAmount: val });
                                      }
                                    }}
                                    className="w-36 text-right px-2 py-1 rounded border border-stone-300 font-mono font-medium text-stone-900 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                                  />
                                </div>
                              ) : (
                                <span className="font-mono font-medium text-stone-800">
                                  {fmt(entry.accounting_amount)}
                                </span>
                              )}
                            </td>

                            {/* Chênh lệch */}
                            <td className="py-3 px-4 text-right font-mono font-bold">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-xs ${
                                  isMatched
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-rose-50 text-rose-700"
                                }`}
                              >
                                {diff > 0 ? "+" : ""}
                                {fmt(diff)}
                              </span>
                            </td>

                            {/* Phân loại lệch */}
                            <td className="py-3 px-4 text-center">
                              {canEdit && !isRevTotal ? (
                                <select
                                  value={entry.discrepancy_status}
                                  onChange={(e) =>
                                    handleUpdateEntry(entry.id, {
                                      discrepancyStatus: e.target.value as DiscrepancyStatus,
                                    })
                                  }
                                  className={`text-[11px] font-semibold px-2 py-1 rounded-md border text-center ${
                                    DISCREPANCY_OPTIONS.find((o) => o.value === entry.discrepancy_status)?.color ||
                                    "border-stone-300"
                                  }`}
                                >
                                  {DISCREPANCY_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${
                                    DISCREPANCY_OPTIONS.find((o) => o.value === entry.discrepancy_status)?.color ||
                                    "border-stone-300"
                                  }`}
                                >
                                  {DISCREPANCY_OPTIONS.find((o) => o.value === entry.discrepancy_status)?.label ||
                                    entry.discrepancy_status}
                                </span>
                              )}
                            </td>

                            {/* Ghi chú giải trình */}
                            <td className="py-3 px-4">
                              {canEdit && !isRevTotal ? (
                                <input
                                  type="text"
                                  placeholder="Nhập ghi chú giải trình lý do lệch..."
                                  defaultValue={entry.explanation_note || ""}
                                  onBlur={(e) => {
                                    const text = e.target.value.trim();
                                    if (text !== (entry.explanation_note || "")) {
                                      handleUpdateEntry(entry.id, { explanationNote: text || null });
                                    }
                                  }}
                                  className="w-full px-2 py-1 rounded border border-stone-200 text-xs text-stone-700 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              ) : (
                                <span className="text-stone-600 text-xs italic">
                                  {entry.explanation_note || "-"}
                                </span>
                              )}
                            </td>

                            {/* Thao tác (Xem chứng từ gốc) */}
                            <td className="py-3 px-4 text-center">
                              <button
                                onClick={() => setActiveDrillDown(entry)}
                                className="px-2.5 py-1 rounded-md bg-stone-100 hover:bg-blue-100 hover:text-blue-800 text-stone-700 font-semibold text-[11px] transition"
                                title="Xem danh sách chứng từ và giao dịch gốc"
                              >
                                Chi tiết
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* DRILL DOWN DRAWER */}
      <DrillDownDrawer
        entry={activeDrillDown}
        onClose={() => setActiveDrillDown(null)}
      />

      {/* EXCEL IMPORT MODAL */}
      <ExcelImportModal
        periodId={period?.id || ""}
        entries={entries}
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportSuccess={() => {
          setActionMessage({
            type: "success",
            text: "Đã cập nhật số liệu từ file Excel thành công!",
          });
          startTransition(() => {
            router.refresh();
          });
        }}
      />

      {/* SNAPSHOT HISTORY MODAL */}
      <SnapshotHistoryModal
        snapshots={snapshots}
        currentEntries={entries}
        userRole={userRole}
        isOpen={isSnapshotModalOpen}
        onClose={() => setIsSnapshotModalOpen(false)}
        onSnapshotDeleted={() => {
          setActionMessage({
            type: "success",
            text: "Đã xoá bản snapshot thành công.",
          });
          startTransition(() => {
            router.refresh();
          });
        }}
      />

      {/* CREATE SNAPSHOT CONFIRMATION MODAL (OWNER ONLY) */}
      {isCreateSnapshotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl p-6 border border-stone-200 space-y-4">
            <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
              <span>💾</span> Xác Nhận Lưu Bản Chốt Kỳ (Snapshot)
            </h3>
            <p className="text-xs text-stone-600 leading-relaxed">
              Hệ thống sẽ đóng băng toàn bộ số liệu 5 nhóm tại thời điểm này thành một bản lưu lịch sử bất biến.
              Các chứng từ vận hành hàng ngày của TVK <strong>không bị khoá cứng</strong>, vẫn có thể bán hàng và xuất kho bình thường.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-stone-700 font-medium mb-1">
                  Tên bản chốt kỳ:
                </label>
                <input
                  type="text"
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
                  placeholder="Ví dụ: Tháng 10/2026 - Bản chốt số 1"
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-stone-700 font-medium mb-1">
                  Ghi chú chốt kỳ:
                </label>
                <textarea
                  value={snapshotNote}
                  onChange={(e) => setSnapshotNote(e.target.value)}
                  placeholder="Ghi chú nội dung chốt với kế toán thuế hoặc giải trình chính..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateSnapshotOpen(false)}
                className="px-4 py-2 rounded-lg border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-50"
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={handleCreateSnapshot}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow disabled:opacity-50"
              >
                {syncing ? "Đang lưu..." : "Xác nhận chốt kỳ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
