import { createClient } from "@/lib/supabase/server";
import { formatDate, formatNumber, formatVND, todayISO } from "@/lib/format";
import type { AnyRow } from "@/lib/types";

export interface CashFlowRunway {
  configured: boolean;
  today: string;
  // Kỳ 14 ngày
  inflow14: number;
  outflow14: number;
  net14: number;
  safetyRatio14: number;
  safetyStatus14: "SAFE" | "WARNING" | "DANGER";
  // Kỳ 30 ngày
  inflow30: number;
  outflow30: number;
  net30: number;
  safetyRatio30: number;
  safetyStatus30: "SAFE" | "WARNING" | "DANGER";
  // Chi tiết phân rã
  overdueReceivables: number;
  overduePayables: number;
  inflow0to14: number;
  outflow0to14: number;
  inflow15to30: number;
  outflow15to30: number;
  inflowAfter30: number;
  outflowAfter30: number;
  // Khuyến nghị điều hành
  recommendation: string;
}

export interface ExecutiveAlertItem {
  id: string;
  time: string;
  level: "RED" | "AMBER";
  levelLabel: string;
  partnerOrSupplier: string;
  docOrBatch: string;
  discrepancy: string;
  reason: string;
  rawAmount: number;
  category: "CONSIGNMENT_MISMATCH" | "OVERDUE_RECEIVABLE" | "OVERDUE_PAYABLE" | "EXPIRING_CONSIGNMENT" | "LOW_STOCK";
}

export interface ExecutiveAlertsResult {
  configured: boolean;
  alerts: ExecutiveAlertItem[];
  redCount: number;
  amberCount: number;
  totalAlerts: number;
  excelRows: Record<string, string | number>[];
}

export interface ThreeWayMatchingRow {
  id: string;
  // Cột 1: Thực tế Giao nhận / Kho
  physicalDocCode: string;
  physicalDate: string;
  physicalKind: string;
  physicalQty: number;
  // Cột 2: Doanh số & Giá trị nội bộ
  salesDocCode: string;
  salesDocDate: string;
  salesDocKind: string; // BH / KG
  partnerName: string;
  productSku: string;
  productName: string;
  batchCode: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  unitCost: number;
  grossProfit: number;
  marginPercent: number;
  // Cột 3: Pháp lý & Công nợ
  invoiceStatus: "ISSUED" | "PENDING_INVOICE" | "OVERDUE_INVOICE";
  invoiceStatusLabel: string;
  invoiceNo: string;
  invoiceSymbol: string;
  invoiceDate: string;
  daysUninvoiced: number;
  // Trạng thái công nợ
  debtStatus: "PAID" | "PENDING_PAYMENT" | "OVERDUE_PAYMENT" | "NO_DEBT";
  debtStatusLabel: string;
  debtDueDate: string;
  debtDaysOverdue: number;
  remainingAmount: number;
  // Tổng hợp tín hiệu đối soát 3 bên
  signal: "RED" | "AMBER" | "GREEN";
  signalLabel: string;
  discrepancyReason: string;
}

export interface ThreeWayAuditResult {
  configured: boolean;
  rows: ThreeWayMatchingRow[];
  totalCount: number;
  filteredCount: number;
  discrepancyRows: ThreeWayMatchingRow[];
  redCount: number;
  amberCount: number;
  greenCount: number;
  uninvoicedCount: number;
  overdueInvoiceCount: number;
  overdueDebtCount: number;
  totalUninvoicedAmount: number;
  totalOverdueDebtAmount: number;
}

/** Tính số ngày chênh lệch giữa hai chuỗi ngày YYYY-MM-DD (d2 - d1). */
function diffDays(d1: string, d2: string): number {
  const t1 = Date.parse(d1);
  const t2 = Date.parse(d2);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 0;
  return Math.floor((t2 - t1) / 86400000);
}

/**
 * 1. DỰ BÁO DÒNG TIỀN 14-30 NGÀY TỚI (CASH FLOW RUNWAY)
 * So sánh dòng tiền vào dự kiến (phải thu đối tác) vs dòng tiền ra dự kiến (phải trả NCC ký gửi đã bán)
 */
export async function getCashFlowRunway(): Promise<CashFlowRunway> {
  const supabase = await createClient();
  const today = todayISO();

  const emptyResult: CashFlowRunway = {
    configured: false,
    today,
    inflow14: 0,
    outflow14: 0,
    net14: 0,
    safetyRatio14: 1,
    safetyStatus14: "SAFE",
    inflow30: 0,
    outflow30: 0,
    net30: 0,
    safetyRatio30: 1,
    safetyStatus30: "SAFE",
    overdueReceivables: 0,
    overduePayables: 0,
    inflow0to14: 0,
    outflow0to14: 0,
    inflow15to30: 0,
    outflow15to30: 0,
    inflowAfter30: 0,
    outflowAfter30: 0,
    recommendation: "Hệ thống chưa kết nối cơ sở dữ liệu.",
  };

  if (!supabase) return emptyResult;

  const [receivablesRes, payablesRes] = await Promise.all([
    supabase
      .from("partner_receivables")
      .select("amount, amount_paid, status, due_date")
      .in("status", ["UNPAID", "PARTIAL"]),
    supabase
      .from("supplier_payables")
      .select("amount, amount_paid, status, due_date")
      .in("status", ["UNPAID", "PARTIAL"]),
  ]);

  const receivables = (receivablesRes.data ?? []) as AnyRow[];
  const payables = (payablesRes.data ?? []) as AnyRow[];

  let overdueReceivables = 0;
  let inflow0to14 = 0;
  let inflow15to30 = 0;
  let inflowAfter30 = 0;

  for (const r of receivables) {
    const remain = Math.max(Number(r.amount ?? 0) - Number(r.amount_paid ?? 0), 0);
    if (remain <= 0) continue;
    const dueDate = r.due_date ? String(r.due_date).slice(0, 10) : today;
    const days = diffDays(today, dueDate);

    if (days < 0) {
      overdueReceivables += remain;
    } else if (days <= 14) {
      inflow0to14 += remain;
    } else if (days <= 30) {
      inflow15to30 += remain;
    } else {
      inflowAfter30 += remain;
    }
  }

  let overduePayables = 0;
  let outflow0to14 = 0;
  let outflow15to30 = 0;
  let outflowAfter30 = 0;

  for (const p of payables) {
    const remain = Math.max(Number(p.amount ?? 0) - Number(p.amount_paid ?? 0), 0);
    if (remain <= 0) continue;
    const dueDate = p.due_date ? String(p.due_date).slice(0, 10) : today;
    const days = diffDays(today, dueDate);

    if (days < 0) {
      overduePayables += remain;
    } else if (days <= 14) {
      outflow0to14 += remain;
    } else if (days <= 30) {
      outflow15to30 += remain;
    } else {
      outflowAfter30 += remain;
    }
  }

  // Dòng tiền 14 ngày: Đến hạn trong 14 ngày (+ khoản quá hạn thanh toán)
  const inflow14 = overdueReceivables + inflow0to14;
  const outflow14 = overduePayables + outflow0to14;
  const net14 = inflow14 - outflow14;
  const safetyRatio14 = outflow14 > 0 ? inflow14 / outflow14 : inflow14 > 0 ? 99 : 1;

  let safetyStatus14: "SAFE" | "WARNING" | "DANGER" = "SAFE";
  if (net14 < 0 || safetyRatio14 < 0.85) {
    safetyStatus14 = "DANGER";
  } else if (safetyRatio14 < 1.15) {
    safetyStatus14 = "WARNING";
  }

  // Dòng tiền 30 ngày: Đến hạn trong 30 ngày (+ quá hạn)
  const inflow30 = overdueReceivables + inflow0to14 + inflow15to30;
  const outflow30 = overduePayables + outflow0to14 + outflow15to30;
  const net30 = inflow30 - outflow30;
  const safetyRatio30 = outflow30 > 0 ? inflow30 / outflow30 : inflow30 > 0 ? 99 : 1;

  let safetyStatus30: "SAFE" | "WARNING" | "DANGER" = "SAFE";
  if (net30 < 0 || safetyRatio30 < 0.85) {
    safetyStatus30 = "DANGER";
  } else if (safetyRatio30 < 1.15) {
    safetyStatus30 = "WARNING";
  }

  // Khuyến nghị điều hành
  let recommendation = "";
  if (safetyStatus14 === "DANGER") {
    recommendation = `⚠️ BÁO ĐỘNG NGÂN QUỸ 14 NGÀY: Thâm hụt ròng ${formatVND(Math.abs(net14))} đ (chi trả vượt thu). Cần ưu tiên đôn đốc thu ${formatVND(overdueReceivables)} đ công nợ quá hạn từ các gara ngay trong tuần này.`;
  } else if (safetyStatus30 === "DANGER") {
    recommendation = `⚠️ ÁP LỰC THANH KHOẢN 30 NGÀY: Dự kiến thâm hụt ròng ${formatVND(Math.abs(net30))} đ do đến hạn trả NCC. Cần kế hoạch thu nợ đối tác và giãn hạn thanh toán các lô ký gửi.`;
  } else if (safetyStatus14 === "WARNING") {
    recommendation = `⚡ NGÂN QUỸ CÂN BẰNG TẠM THỜI: Dòng tiền ròng 14 ngày dương nhẹ (+${formatVND(net14)} đ), tỷ lệ độ phủ ${Math.round(safetyRatio14 * 100)}%. Cần bám sát lịch thu tiền gara để không trễ hẹn NCC.`;
  } else {
    recommendation = `✅ DÒNG TIỀN AN TOÀN: Dòng tiền ròng 30 ngày dự kiến thặng dư +${formatVND(net30)} đ (độ phủ chi trả đạt ${Math.round(safetyRatio30 * 100)}%). Ngân quỹ ổn định.`;
  }

  return {
    configured: true,
    today,
    inflow14,
    outflow14,
    net14,
    safetyRatio14,
    safetyStatus14,
    inflow30,
    outflow30,
    net30,
    safetyRatio30,
    safetyStatus30,
    overdueReceivables,
    overduePayables,
    inflow0to14,
    outflow0to14,
    inflow15to30,
    outflow15to30,
    inflowAfter30,
    outflowAfter30,
    recommendation,
  };
}

/**
 * 2. TRUNG TÂM BÁO ĐỘNG ĐÈN TÍN HIỆU & DANH SÁCH SAI LỆCH XUẤT EXCEL
 * Gom toàn bộ cảnh báo nghiêm trọng nhất:
 * - Chênh lệch ký gửi đối tác
 * - Công nợ quá hạn (thu/trả)
 * - Lô ký gửi sắp hết hạn hoàn trả
 * - Tồn kho dưới mức an toàn
 */
export async function getExecutiveAlerts(): Promise<ExecutiveAlertsResult> {
  const supabase = await createClient();
  const today = todayISO();

  if (!supabase) {
    return {
      configured: false,
      alerts: [],
      redCount: 0,
      amberCount: 0,
      totalAlerts: 0,
      excelRows: [],
    };
  }

  const [
    partnerConsRes,
    receivablesRes,
    payablesRes,
    batchesRes,
    productStockRes,
    productMinsRes,
  ] = await Promise.all([
    supabase.from("v_partner_consignment").select("*"),
    supabase
      .from("partner_receivables")
      .select("id, amount, amount_paid, due_date, status, partners(name), sales_documents(doc_code)")
      .in("status", ["UNPAID", "PARTIAL"]),
    supabase
      .from("supplier_payables")
      .select("id, amount, amount_paid, due_date, status, suppliers(name), stock_batches(batch_code)")
      .in("status", ["UNPAID", "PARTIAL"]),
    supabase
      .from("stock_batches")
      .select("id, batch_code, received_date, return_by_date, ownership, status, suppliers(name), products(sku, name), batch_locations(qty, location_id, locations(location_kind))")
      .eq("ownership", "CONSIGNED")
      .eq("status", "ACTIVE"),
    supabase.from("v_product_stock").select("*"),
    supabase.from("products").select("id, sku, name, min_stock"),
  ]);

  const alerts: ExecutiveAlertItem[] = [];

  // 1. Chênh lệch số lượng ký gửi tại đối tác (ĐÈN ĐỎ)
  const partnerCons = (partnerConsRes.data ?? []) as AnyRow[];
  for (const pc of partnerCons) {
    const sent = Number(pc.qty_sent ?? 0);
    const consumed = Number(pc.qty_consumed ?? 0);
    const returned = Number(pc.qty_returned ?? 0);
    const still = Number(pc.qty_still_at_partner ?? 0);
    const expectedSent = consumed + returned + still;
    const diff = sent - expectedSent;

    if (diff !== 0) {
      const diffAbs = Math.abs(diff);
      alerts.push({
        id: `cons-diff-${pc.partner_id}`,
        time: today,
        level: "RED",
        levelLabel: "🔴 ĐỎ (Nguy cấp)",
        partnerOrSupplier: String(pc.partner_name ?? "Đối tác"),
        docOrBatch: `Ký gửi tại ${pc.partner_name}`,
        discrepancy: `Lệch ${diff > 0 ? "+" : "-"}${formatNumber(diffAbs)} cái`,
        reason: `Số lượng không khớp: Đã gửi (${formatNumber(sent)}) ≠ Tiêu thụ (${formatNumber(consumed)}) + Đã trả (${formatNumber(returned)}) + Còn giữ (${formatNumber(still)}). Cần đối chiếu kho gara gấp.`,
        rawAmount: diffAbs,
        category: "CONSIGNMENT_MISMATCH",
      });
    }
  }

  // 2. Phải thu đối tác quá hạn
  const receivables = (receivablesRes.data ?? []) as AnyRow[];
  for (const r of receivables) {
    const remain = Math.max(Number(r.amount ?? 0) - Number(r.amount_paid ?? 0), 0);
    if (remain <= 0) continue;
    const dueDate = r.due_date ? String(r.due_date).slice(0, 10) : "";
    if (!dueDate || dueDate >= today) continue;

    const daysOverdue = diffDays(dueDate, today);
    const isSevere = daysOverdue > 14 || remain >= 50000000;
    const pName = (r.partners as AnyRow)?.name ?? "Đối tác";
    const docCode = (r.sales_documents as AnyRow)?.doc_code ?? "—";

    alerts.push({
      id: `recv-overdue-${r.id}`,
      time: dueDate,
      level: isSevere ? "RED" : "AMBER",
      levelLabel: isSevere ? "🔴 ĐỎ (Nguy cấp)" : "🟡 VÀNG (Cảnh báo)",
      partnerOrSupplier: String(pName),
      docOrBatch: String(docCode),
      discrepancy: `${formatVND(remain)} đ`,
      reason: `Quá hạn thanh toán ${daysOverdue} ngày (Hạn: ${formatDate(dueDate)}). Cần đôn đốc thu tiền gara.`,
      rawAmount: remain,
      category: "OVERDUE_RECEIVABLE",
    });
  }

  // 3. Phải trả NCC quá hạn
  const payables = (payablesRes.data ?? []) as AnyRow[];
  for (const p of payables) {
    const remain = Math.max(Number(p.amount ?? 0) - Number(p.amount_paid ?? 0), 0);
    if (remain <= 0) continue;
    const dueDate = p.due_date ? String(p.due_date).slice(0, 10) : "";
    if (!dueDate || dueDate >= today) continue;

    const daysOverdue = diffDays(dueDate, today);
    const isSevere = daysOverdue > 7 || remain >= 30000000;
    const sName = (p.suppliers as AnyRow)?.name ?? "Nhà cung cấp";
    const batchCode = (p.stock_batches as AnyRow)?.batch_code ?? "—";

    alerts.push({
      id: `pay-overdue-${p.id}`,
      time: dueDate,
      level: isSevere ? "RED" : "AMBER",
      levelLabel: isSevere ? "🔴 ĐỎ (Nguy cấp)" : "🟡 VÀNG (Cảnh báo)",
      partnerOrSupplier: String(sName),
      docOrBatch: `Lô ${batchCode}`,
      discrepancy: `${formatVND(remain)} đ`,
      reason: `Hàng ký gửi đã bán nhưng chậm trả tiền NCC ${daysOverdue} ngày (Hạn: ${formatDate(dueDate)}). Rủi ro giữ nguồn cung.`,
      rawAmount: remain,
      category: "OVERDUE_PAYABLE",
    });
  }

  // 4. Lô hàng nhận ký gửi sắp hết hạn hoàn trả (hoặc đã quá hạn)
  const batches = (batchesRes.data ?? []) as AnyRow[];
  for (const b of batches) {
    if (!b.return_by_date) continue;
    const returnDate = String(b.return_by_date).slice(0, 10);
    const daysUntilReturn = diffDays(today, returnDate);

    // Tính tồn thực tế trong kho TVK
    const locs = (b.batch_locations ?? []) as AnyRow[];
    const onHandOwnWh = locs
      .filter((bl) => (bl.locations as AnyRow)?.location_kind === "OWN_WAREHOUSE")
      .reduce((sum, bl) => sum + Number(bl.qty ?? 0), 0);

    if (onHandOwnWh <= 0) continue;

    if (daysUntilReturn < 0) {
      // Đã quá hạn trả hàng NCC
      const sName = (b.suppliers as AnyRow)?.name ?? "Nhà cung cấp";
      const pSku = (b.products as AnyRow)?.sku ?? "";
      const pName = (b.products as AnyRow)?.name ?? "";

      alerts.push({
        id: `batch-exp-over-${b.id}`,
        time: returnDate,
        level: "RED",
        levelLabel: "🔴 ĐỎ (Nguy cấp)",
        partnerOrSupplier: String(sName),
        docOrBatch: `Lô ${b.batch_code} (${pSku})`,
        discrepancy: `${formatNumber(onHandOwnWh)} cái tồn`,
        reason: `Đã QUÁ HẠN hoàn trả ký gửi ${Math.abs(daysUntilReturn)} ngày (Hạn: ${formatDate(returnDate)}). Sản phẩm: ${pName}. Cần xuất trả NCC hoặc chốt mua.`,
        rawAmount: onHandOwnWh,
        category: "EXPIRING_CONSIGNMENT",
      });
    } else if (daysUntilReturn <= 30) {
      // Sắp đến hạn trả hàng NCC trong 30 ngày
      const sName = (b.suppliers as AnyRow)?.name ?? "Nhà cung cấp";
      const pSku = (b.products as AnyRow)?.sku ?? "";
      const pName = (b.products as AnyRow)?.name ?? "";

      alerts.push({
        id: `batch-exp-soon-${b.id}`,
        time: returnDate,
        level: "AMBER",
        levelLabel: "🟡 VÀNG (Cảnh báo)",
        partnerOrSupplier: String(sName),
        docOrBatch: `Lô ${b.batch_code} (${pSku})`,
        discrepancy: `${formatNumber(onHandOwnWh)} cái tồn`,
        reason: `Lô ký gửi còn ${daysUntilReturn} ngày đến hạn hoàn trả (Hạn: ${formatDate(returnDate)}). Sản phẩm: ${pName}. Cần đẩy bán hoặc lên lịch hoàn trả.`,
        rawAmount: onHandOwnWh,
        category: "EXPIRING_CONSIGNMENT",
      });
    }
  }

  // 5. Hàng tồn dưới mức an toàn (Low stock)
  const minMap = new Map(((productMinsRes.data ?? []) as AnyRow[]).map((p) => [p.id, Number(p.min_stock ?? 0)]));
  const pStock = (productStockRes.data ?? []) as AnyRow[];
  for (const ps of pStock) {
    const minVal = minMap.get(ps.product_id) ?? 0;
    if (minVal > 0 && Number(ps.total_qty ?? 0) <= minVal) {
      const curQty = Number(ps.total_qty ?? 0);
      const shortage = minVal - curQty;
      alerts.push({
        id: `low-stock-${ps.product_id}`,
        time: today,
        level: "AMBER",
        levelLabel: "🟡 VÀNG (Cảnh báo)",
        partnerOrSupplier: "Kho nội bộ TVK",
        docOrBatch: `SKU ${ps.sku}`,
        discrepancy: `Tồn ${formatNumber(curQty)} / Tối thiểu ${formatNumber(minVal)} (Thiếu ${formatNumber(shortage)})`,
        reason: `Tồn kho dưới ngưỡng an toàn (sản phẩm ${ps.name}). Nguy cơ thiếu hàng đáp ứng đơn cho gara.`,
        rawAmount: shortage,
        category: "LOW_STOCK",
      });
    }
  }

  // Sắp xếp: Đỏ lên trước, Vàng sau; trong cùng cấp ưu tiên giá trị chênh lệch lớn
  alerts.sort((a, b) => {
    if (a.level !== b.level) return a.level === "RED" ? -1 : 1;
    return b.rawAmount - a.rawAmount;
  });

  const redCount = alerts.filter((a) => a.level === "RED").length;
  const amberCount = alerts.filter((a) => a.level === "AMBER").length;

  // Chuẩn bị dữ liệu bảng Excel chuẩn theo yêu cầu:
  // Cột: Thời gian, Loại cảnh báo (Đỏ/Vàng), Đối tác/NCC, Mã chứng từ/Lô hàng, Số lượng/Số tiền chênh lệch, Lý do cảnh báo rõ ràng để gửi giải trình
  const excelRows = alerts.map((a) => ({
    "Thời gian": formatDate(a.time),
    "Loại cảnh báo": a.level === "RED" ? "ĐỎ (Khẩn cấp)" : "VÀNG (Cảnh báo)",
    "Đối tác/NCC": a.partnerOrSupplier,
    "Mã chứng từ/Lô hàng": a.docOrBatch,
    "Số lượng/Số tiền chênh lệch": a.discrepancy,
    "Lý do cảnh báo": a.reason,
  }));

  return {
    configured: true,
    alerts,
    redCount,
    amberCount,
    totalAlerts: alerts.length,
    excelRows,
  };
}

/**
 * 3. MA TRẬN ĐỐI SOÁT 3 BÊN (3-WAY MATCHING AUDIT)
 * So khớp: Phiếu giao nhận/kho thực tế ↔ Doanh số nội bộ ↔ Hoá đơn GTGT & Công nợ
 */
export async function getThreeWayMatchingAudit(filter?: {
  signal?: string; // ALL, RED, AMBER, GREEN
  partnerId?: string;
  days?: number; // 7, 30, 60, 90, 0 = ALL
}): Promise<ThreeWayAuditResult> {
  const supabase = await createClient();
  const today = todayISO();

  const emptyResult: ThreeWayAuditResult = {
    configured: false,
    rows: [],
    totalCount: 0,
    filteredCount: 0,
    discrepancyRows: [],
    redCount: 0,
    amberCount: 0,
    greenCount: 0,
    uninvoicedCount: 0,
    overdueInvoiceCount: 0,
    overdueDebtCount: 0,
    totalUninvoicedAmount: 0,
    totalOverdueDebtAmount: 0,
  };

  if (!supabase) return emptyResult;

  // Lấy các chứng từ bán hàng / phân bổ đã xác nhận
  let query = supabase
    .from("sales_documents")
    .select(`
      id, doc_code, doc_kind, doc_date, partner_id, customer_name, is_credit, status, discount_amount,
      allocation_id, sales_order_id,
      partners(id, name),
      sales_orders(doc_code, order_date),
      allocation_slips(doc_code, report_id, consumption_reports(doc_code, report_date))
    `)
    .eq("status", "CONFIRMED")
    .order("doc_date", { ascending: false });

  if (filter?.partnerId) {
    query = query.eq("partner_id", filter.partnerId);
  }

  if (filter?.days && filter.days > 0) {
    const cutoff = new Date(Date.now() - filter.days * 86400000).toISOString().slice(0, 10);
    query = query.gte("doc_date", cutoff);
  } else {
    query = query.limit(1000);
  }

  const { data: docs, error: docErr } = await query;
  if (docErr || !docs || docs.length === 0) return { ...emptyResult, configured: true };

  const docIds = docs.map((d: AnyRow) => d.id as string);

  // Lấy chi tiết các dòng chứng từ và công nợ
  const [linesRes, recvRes] = await Promise.all([
    supabase
      .from("sales_document_lines")
      .select("id, document_id, product_id, batch_id, allocation_line_id, qty, unit_price, line_total, products(sku, name), stock_batches(batch_code, unit_cost)")
      .in("document_id", docIds),
    supabase
      .from("partner_receivables")
      .select("id, source_document_id, amount, amount_paid, due_date, status")
      .in("source_document_id", docIds),
  ]);

  const lines = (linesRes.data ?? []) as AnyRow[];
  const recvList = (recvRes.data ?? []) as AnyRow[];

  // Truy vấn chính xác các dòng hoá đơn GTGT theo lineIds thực tế để tránh giới hạn 1000 dòng toàn bảng
  const lineIds = lines.map((l) => l.id as string);
  const vatByLineId = new Map<string, AnyRow>();
  const CHUNK_SIZE = 200;
  for (let i = 0; i < lineIds.length; i += CHUNK_SIZE) {
    const chunk = lineIds.slice(i, i + CHUNK_SIZE);
    const { data: chunkVatLines } = await supabase
      .from("vat_invoice_lines")
      .select("id, sales_document_line_id, is_active, vat_invoices(invoice_no, symbol, invoice_date, status)")
      .in("sales_document_line_id", chunk)
      .eq("is_active", true);

    for (const vl of (chunkVatLines ?? []) as AnyRow[]) {
      if (vl.is_active && vl.vat_invoices) {
        vatByLineId.set(String(vl.sales_document_line_id), vl.vat_invoices as AnyRow);
      }
    }
  }

  // Map công nợ theo source_document_id
  const recvByDocId = new Map<string, AnyRow>();
  for (const r of recvList) {
    recvByDocId.set(String(r.source_document_id), r);
  }

  // Map thông tin chứng từ theo doc.id
  const docMap = new Map<string, AnyRow>();
  for (const d of docs as AnyRow[]) {
    docMap.set(d.id, d);
  }

  const allRows: ThreeWayMatchingRow[] = [];
  const filteredRows: ThreeWayMatchingRow[] = [];
  const discrepancyRows: ThreeWayMatchingRow[] = [];
  let redCount = 0;
  let amberCount = 0;
  let greenCount = 0;
  let uninvoicedCount = 0;
  let overdueInvoiceCount = 0;
  let overdueDebtCount = 0;
  let totalUninvoicedAmount = 0;
  let totalOverdueDebtAmount = 0;

  for (const line of lines) {
    const doc = docMap.get(line.document_id);
    if (!doc) continue;

    const partnerName = String(
      (doc.partners as AnyRow)?.name ?? doc.customer_name ?? "Khách vãng lai"
    );
    const sku = String((line.products as AnyRow)?.sku ?? "—");
    const productName = String((line.products as AnyRow)?.name ?? "Sản phẩm");
    const batchCode = String((line.stock_batches as AnyRow)?.batch_code ?? "—");
    const unitCost = Number((line.stock_batches as AnyRow)?.unit_cost ?? 0);
    const unitPrice = Number(line.unit_price ?? 0);
    const qty = Number(line.qty ?? 0);
    const lineTotal = Number(line.line_total ?? qty * unitPrice);
    const grossProfit = lineTotal - qty * unitCost;
    const marginPercent = lineTotal > 0 ? Math.round((grossProfit / lineTotal) * 100) : 0;

    // Bên 1: Thực tế giao nhận / kho
    let physicalDocCode = "Kho TVK xuất thẳng";
    let physicalDate = String(doc.doc_date ?? today).slice(0, 10);
    let physicalKind = doc.doc_kind === "BH" ? "Bán tại quầy" : "Ký gửi";

    const alloc = doc.allocation_slips as AnyRow;
    const so = doc.sales_orders as AnyRow;

    if (alloc) {
      const rep = alloc.consumption_reports as AnyRow;
      if (rep?.doc_code) {
        physicalDocCode = `${rep.doc_code} (PB: ${alloc.doc_code})`;
        physicalDate = String(rep.report_date ?? doc.doc_date).slice(0, 10);
        physicalKind = "Báo cáo tiêu thụ gara";
      } else if (alloc.doc_code) {
        physicalDocCode = String(alloc.doc_code);
        physicalKind = "Phiếu phân bổ";
      }
    } else if (so?.doc_code) {
      physicalDocCode = `${so.doc_code} (Kho TVK xuất thẳng)`;
      physicalDate = String(so.order_date ?? doc.doc_date).slice(0, 10);
      physicalKind = "Đơn bán hàng tại quầy";
    }

    // Bên 3: Hoá đơn GTGT
    const vatInv = vatByLineId.get(String(line.id));
    let invoiceStatus: "ISSUED" | "PENDING_INVOICE" | "OVERDUE_INVOICE" = "ISSUED";
    let invoiceStatusLabel = "Đã xuất";
    let invoiceNo = "—";
    let invoiceSymbol = "—";
    let invoiceDate = "—";
    const daysUninvoiced = diffDays(String(doc.doc_date).slice(0, 10), today);

    if (vatInv && vatInv.invoice_no) {
      invoiceStatus = "ISSUED";
      invoiceStatusLabel = "🟢 Đã xuất";
      invoiceNo = String(vatInv.invoice_no);
      invoiceSymbol = String(vatInv.symbol ?? "");
      invoiceDate = formatDate(vatInv.invoice_date);
    } else {
      if (daysUninvoiced > 5) {
        invoiceStatus = "OVERDUE_INVOICE";
        invoiceStatusLabel = `🔴 Chậm xuất (${daysUninvoiced} ngày)`;
        overdueInvoiceCount++;
      } else {
        invoiceStatus = "PENDING_INVOICE";
        invoiceStatusLabel = `🟡 Chưa xuất (${daysUninvoiced} ngày)`;
      }
      uninvoicedCount++;
      totalUninvoicedAmount += lineTotal;
    }

    // Bên 3: Trạng thái công nợ
    const recv = recvByDocId.get(String(doc.id));
    let debtStatus: "PAID" | "PENDING_PAYMENT" | "OVERDUE_PAYMENT" | "NO_DEBT" = "NO_DEBT";
    let debtStatusLabel = "Tiền mặt / Không nợ";
    let debtDueDate = "—";
    let debtDaysOverdue = 0;
    let remainingAmount = 0;

    if (recv) {
      remainingAmount = Math.max(Number(recv.amount ?? 0) - Number(recv.amount_paid ?? 0), 0);
      debtDueDate = recv.due_date ? String(recv.due_date).slice(0, 10) : "";

      if (recv.status === "PAID" || remainingAmount <= 0) {
        debtStatus = "PAID";
        debtStatusLabel = "🟢 Đã thanh toán";
      } else if (debtDueDate && debtDueDate < today) {
        debtDaysOverdue = diffDays(debtDueDate, today);
        debtStatus = "OVERDUE_PAYMENT";
        debtStatusLabel = `🔴 Quá hạn ${debtDaysOverdue} ngày`;
        overdueDebtCount++;
        totalOverdueDebtAmount += remainingAmount;
      } else {
        debtStatus = "PENDING_PAYMENT";
        debtStatusLabel = `🟡 Trong hạn (${formatDate(debtDueDate)})`;
      }
    }

    // Đánh giá Tín hiệu 3 Bên: Đỏ - Vàng - Xanh
    let signal: "RED" | "AMBER" | "GREEN" = "GREEN";
    let signalLabel = "🟢 Khớp hoàn toàn";
    const issues: string[] = [];

    // Kiểm tra Đỏ
    if (invoiceStatus === "OVERDUE_INVOICE") {
      issues.push(`Chậm xuất HĐ GTGT quá 5 ngày (${daysUninvoiced} ngày)`);
    }
    if (debtStatus === "OVERDUE_PAYMENT") {
      issues.push(`Công nợ quá hạn ${debtDaysOverdue} ngày (${formatVND(remainingAmount)} đ)`);
    }
    if (unitCost > 0 && unitPrice < unitCost) {
      issues.push(`Bán lỗ dưới giá vốn (Giá bán ${formatVND(unitPrice)} < Vốn ${formatVND(unitCost)})`);
    }

    if (issues.length > 0) {
      signal = "RED";
      signalLabel = "🔴 Đèn Đỏ (Lệch / Quá hạn)";
      redCount++;
    } else if (invoiceStatus === "PENDING_INVOICE" || debtStatus === "PENDING_PAYMENT") {
      // Kiểm tra Vàng
      const warnings: string[] = [];
      if (invoiceStatus === "PENDING_INVOICE") warnings.push("Chờ xuất HĐ trong hạn");
      if (debtStatus === "PENDING_PAYMENT") warnings.push("Chờ thanh toán trong hạn");
      signal = "AMBER";
      signalLabel = "🟡 Đèn Vàng (Đang theo dõi)";
      issues.push(...warnings);
      amberCount++;
    } else {
      greenCount++;
    }

    const row: ThreeWayMatchingRow = {
      id: `${line.id}`,
      physicalDocCode,
      physicalDate,
      physicalKind,
      physicalQty: qty,
      salesDocCode: String(doc.doc_code),
      salesDocDate: String(doc.doc_date).slice(0, 10),
      salesDocKind: String(doc.doc_kind),
      partnerName,
      productSku: sku,
      productName,
      batchCode,
      qty,
      unitPrice,
      lineTotal,
      unitCost,
      grossProfit,
      marginPercent,
      invoiceStatus,
      invoiceStatusLabel,
      invoiceNo,
      invoiceSymbol,
      invoiceDate,
      daysUninvoiced,
      debtStatus,
      debtStatusLabel,
      debtDueDate,
      debtDaysOverdue,
      remainingAmount,
      signal,
      signalLabel,
      discrepancyReason: issues.join("; ") || "Đã khớp 3 bên chuẩn xác",
    };

    allRows.push(row);
    if (signal === "RED") {
      discrepancyRows.push(row);
    }
    if (!filter?.signal || filter.signal === "ALL" || filter.signal === signal) {
      filteredRows.push(row);
    }
  }

  return {
    configured: true,
    rows: filteredRows,
    totalCount: allRows.length,
    filteredCount: filteredRows.length,
    discrepancyRows,
    redCount,
    amberCount,
    greenCount,
    uninvoicedCount,
    overdueInvoiceCount,
    overdueDebtCount,
    totalUninvoicedAmount,
    totalOverdueDebtAmount,
  };
}
