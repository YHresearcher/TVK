/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ReconciliationPeriod,
  ReconciliationEntry,
  ReconciliationSnapshot,
  ReconciliationDataGroup,
  ReconciliationPeriodType,
} from "@/types";

export interface ReconciliationKPIs {
  totalTvk: number;
  totalAcc: number;
  netDiff: number;
  matchedCount: number;
  pendingCount: number;
  validTaxTimingCount: number;
  accountingErrorCount: number;
  tvkErrorCount: number;
}

export interface ComputedReconciliationLine {
  data_group: ReconciliationDataGroup;
  item_key: string;
  item_name: string;
  item_subtext?: string;
  tvk_amount: number;
  drilldown_data: any;
}

/**
 * Tính toán số liệu trực tiếp TVK cho 5 nhóm đối chiếu trong khoảng thời gian [fromDate, toDate].
 */
export async function computeLiveTVKMetrics(
  fromDate: string,
  toDate: string
): Promise<ComputedReconciliationLine[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const lines: ComputedReconciliationLine[] = [];

  // =========================================================================
  // (1) QUỸ TIỀN TỪNG KÉT / NGÂN HÀNG (cash_funds, cash_movements)
  // =========================================================================
  const { data: funds } = await supabase
    .from("cash_funds")
    .select("id, name, kind, opening_balance, opening_balance_date, is_active")
    .order("name", { ascending: true });

  const fundRows = (funds ?? []) as any[];
  const fundIds = fundRows.map((f) => f.id);

  const movementsByFund = new Map<string, any[]>();
  if (fundIds.length > 0) {
    const { data: movs } = await supabase
      .from("cash_movements")
      .select("id, fund_id, amount, movement_date, movement_kind, note, is_cancelled")
      .in("fund_id", fundIds)
      .lte("movement_date", toDate)
      .order("movement_date", { ascending: false });

    const movRows = (movs ?? []) as any[];
    for (const m of movRows) {
      // Trong mô hình bút toán đảo (double-entry reversal), dòng huỷ gốc (+A)
      // và bút toán đảo (-A) tự triệt tiêu về 0. Không bỏ qua m.is_cancelled
      // để đảm bảo khớp chính xác với view v_cash_fund_balances.
      const arr = movementsByFund.get(m.fund_id) ?? [];
      arr.push(m);
      movementsByFund.set(m.fund_id, arr);
    }
  }

  for (const f of fundRows) {
    const fMovs = movementsByFund.get(f.id) ?? [];
    const sumAmount = fMovs.reduce((acc, m) => acc + Number(m.amount || 0), 0);
    const endingBalance = Number(f.opening_balance || 0) + sumAmount;

    lines.push({
      data_group: "CASH_FUND",
      item_key: `FUND_${f.id}`,
      item_name: f.name,
      item_subtext: f.kind === "CASH" ? "Két tiền mặt" : "Tài khoản ngân hàng",
      tvk_amount: endingBalance,
      drilldown_data: {
        type: "CASH_FUND",
        fund_name: f.name,
        opening_balance: Number(f.opening_balance || 0),
        opening_balance_date: f.opening_balance_date,
        transactions: fMovs.map((m) => ({
          id: m.id,
          code: `M-${m.id.slice(0, 8).toUpperCase()}`,
          date: m.movement_date,
          kind: m.movement_kind,
          amount: Number(m.amount),
          note: m.note || "Giao dịch quỹ",
        })),
      },
    });
  }

  // =========================================================================
  // (2) PHẢI THU TỪNG ĐỐI TÁC (partner_receivables, partners, sales_documents)
  // =========================================================================
  const { data: receivables } = await supabase
    .from("partner_receivables")
    .select(`
      id,
      partner_id,
      amount,
      amount_paid,
      status,
      due_date,
      partners (id, name, code),
      sales_documents (id, doc_code, doc_date, amount, status)
    `)
    .limit(1000);

  const recRows = (receivables ?? []) as any[];
  const recIds = recRows.map((r) => r.id);

  // Lấy các khoản thanh toán phát sinh đến ngày toDate
  const paymentsByRec = new Map<string, any[]>();
  if (recIds.length > 0) {
    const { data: pmts } = await supabase
      .from("payments")
      .select("id, doc_code, payment_date, amount, method, receivable_id, note")
      .in("receivable_id", recIds)
      .lte("payment_date", toDate);

    for (const p of (pmts ?? []) as any[]) {
      const arr = paymentsByRec.get(p.receivable_id) ?? [];
      arr.push(p);
      paymentsByRec.set(p.receivable_id, arr);
    }
  }

  // Tổng hợp theo từng đối tác
  const partnerReceivablesMap = new Map<
    string,
    {
      partnerId: string;
      partnerName: string;
      partnerCode: string;
      totalRemaining: number;
      docs: any[];
    }
  >();

  for (const r of recRows) {
    const docDate = r.sales_documents?.doc_date;
    if (docDate && docDate > toDate) continue; // Bỏ qua chứng từ phát sinh sau toDate

    const pmtList = paymentsByRec.get(r.id) ?? [];
    const paidUpToDate = pmtList.reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const origAmount = Number(r.amount || 0);
    const remaining = Math.max(0, origAmount - paidUpToDate);

    const partnerId = r.partner_id;
    const partnerName = r.partners?.name || "Đối tác chưa đặt tên";
    const partnerCode = r.partners?.code || "DT";

    const cur = partnerReceivablesMap.get(partnerId) ?? {
      partnerId,
      partnerName,
      partnerCode,
      totalRemaining: 0,
      docs: [] as any[],
    };

    cur.totalRemaining += remaining;
    cur.docs.push({
      id: r.id,
      code: r.sales_documents?.doc_code || `PT-${r.id.slice(0, 8)}`,
      date: docDate || r.due_date || toDate,
      doc_amount: origAmount,
      paid_amount: paidUpToDate,
      remaining_amount: remaining,
      status: remaining <= 0 ? "PAID" : r.status,
      payments: pmtList.map((p) => ({
        code: p.doc_code,
        date: p.payment_date,
        amount: Number(p.amount),
        method: p.method,
      })),
    });

    partnerReceivablesMap.set(partnerId, cur);
  }

  for (const [pId, pData] of Array.from(partnerReceivablesMap.entries())) {
    if (pData.totalRemaining > 0 || pData.docs.length > 0) {
      lines.push({
        data_group: "RECEIVABLE",
        item_key: `REC_${pId}`,
        item_name: pData.partnerName,
        item_subtext: `Mã: ${pData.partnerCode} • Dư nợ phải thu đến ${toDate}`,
        tvk_amount: pData.totalRemaining,
        drilldown_data: {
          type: "RECEIVABLE",
          partner_name: pData.partnerName,
          partner_code: pData.partnerCode,
          vouchers: pData.docs,
        },
      });
    }
  }

  // =========================================================================
  // (3) PHẢI TRẢ TỪNG NHÀ CUNG CẤP (supplier_payables, suppliers)
  // =========================================================================
  const { data: payables } = await supabase
    .from("supplier_payables")
    .select(`
      id,
      supplier_id,
      amount,
      amount_paid,
      status,
      due_date,
      source_kind,
      suppliers (id, name, code),
      purchase_receipts (id, receipt_no, receipt_date, total_amount),
      sales_documents (id, doc_code, doc_date)
    `)
    .limit(1000);

  const payRows = (payables ?? []) as any[];
  const payIds = payRows.map((p) => p.id);

  const paymentsByPay = new Map<string, any[]>();
  if (payIds.length > 0) {
    const { data: pmts } = await supabase
      .from("payments")
      .select("id, doc_code, payment_date, amount, method, payable_id, note")
      .in("payable_id", payIds)
      .lte("payment_date", toDate);

    for (const p of (pmts ?? []) as any[]) {
      const arr = paymentsByPay.get(p.payable_id) ?? [];
      arr.push(p);
      paymentsByPay.set(p.payable_id, arr);
    }
  }

  const supplierPayablesMap = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      supplierCode: string;
      totalRemaining: number;
      vouchers: any[];
    }
  >();

  for (const p of payRows) {
    const refDate =
      p.source_kind === "PURCHASE"
        ? p.purchase_receipts?.receipt_date
        : p.sales_documents?.doc_date;
    if (refDate && refDate > toDate) continue;

    const pmtList = paymentsByPay.get(p.id) ?? [];
    const paidUpToDate = pmtList.reduce((acc, pm) => acc + Number(pm.amount || 0), 0);
    const origAmount = Number(p.amount || 0);
    const remaining = Math.max(0, origAmount - paidUpToDate);

    const supplierId = p.supplier_id;
    const supplierName = p.suppliers?.name || "Nhà cung cấp chưa đặt tên";
    const supplierCode = p.suppliers?.code || "NCC";

    const cur = supplierPayablesMap.get(supplierId) ?? {
      supplierId,
      supplierName,
      supplierCode,
      totalRemaining: 0,
      vouchers: [] as any[],
    };

    cur.totalRemaining += remaining;
    cur.vouchers.push({
      id: p.id,
      code:
        p.source_kind === "PURCHASE"
          ? p.purchase_receipts?.receipt_no || "PN-MUA"
          : p.sales_documents?.doc_code || "BH-KG",
      date: refDate || p.due_date || toDate,
      source_kind: p.source_kind,
      doc_amount: origAmount,
      paid_amount: paidUpToDate,
      remaining_amount: remaining,
      status: remaining <= 0 ? "PAID" : p.status,
      payments: pmtList.map((pm) => ({
        code: pm.doc_code,
        date: pm.payment_date,
        amount: Number(pm.amount),
        method: pm.method,
      })),
    });

    supplierPayablesMap.set(supplierId, cur);
  }

  for (const [sId, sData] of Array.from(supplierPayablesMap.entries())) {
    if (sData.totalRemaining > 0 || sData.vouchers.length > 0) {
      lines.push({
        data_group: "PAYABLE",
        item_key: `PAY_${sId}`,
        item_name: sData.supplierName,
        item_subtext: `Mã: ${sData.supplierCode} • Phải trả NCC đến ${toDate}`,
        tvk_amount: sData.totalRemaining,
        drilldown_data: {
          type: "PAYABLE",
          supplier_name: sData.supplierName,
          supplier_code: sData.supplierCode,
          vouchers: sData.vouchers,
        },
      });
    }
  }

  // =========================================================================
  // (4) TỒN KHO THEO GIÁ TRỊ TỔNG (batch_locations, stock_batches, locations)
  // =========================================================================
  const { data: batchLocs } = await supabase
    .from("batch_locations")
    .select(`
      batch_id,
      location_id,
      qty,
      locations (id, name, location_kind),
      stock_batches (
        id,
        batch_code,
        ownership,
        unit_cost,
        product_id,
        products (id, sku, name)
      )
    `)
    .gt("qty", 0);

  let ownWarehouseValue = 0;
  const ownWarehouseBatches: any[] = [];

  let partnerVirtualValue = 0;
  const partnerVirtualBatches: any[] = [];

  let consignedRefValue = 0;
  const consignedRefBatches: any[] = [];

  for (const bl of (batchLocs ?? []) as any[]) {
    const qty = Number(bl.qty || 0);
    const unitCost = Number(bl.stock_batches?.unit_cost || 0);
    const totalVal = qty * unitCost;
    const ownership = bl.stock_batches?.ownership;
    const locKind = bl.locations?.location_kind;

    const itemDetail = {
      sku: bl.stock_batches?.products?.sku || "SKU",
      product_name: bl.stock_batches?.products?.name || "Sản phẩm",
      batch_code: bl.stock_batches?.batch_code || "LÔ",
      location_name: bl.locations?.name || "Kho",
      qty,
      unit_cost: unitCost,
      total_value: totalVal,
    };

    if (ownership === "OWNED") {
      if (locKind === "OWN_WAREHOUSE") {
        ownWarehouseValue += totalVal;
        ownWarehouseBatches.push(itemDetail);
      } else if (locKind === "PARTNER_VIRTUAL") {
        partnerVirtualValue += totalVal;
        partnerVirtualBatches.push(itemDetail);
      }
    } else if (ownership === "CONSIGNED") {
      consignedRefValue += totalVal;
      consignedRefBatches.push(itemDetail);
    }
  }

  // Dòng 4.1: Hàng sở hữu tại kho TVK
  lines.push({
    data_group: "INVENTORY",
    item_key: "INV_OWN_WAREHOUSE",
    item_name: "Hàng sở hữu tại kho TVK",
    item_subtext: "Kho vật lý TVK (Sở hữu riêng)",
    tvk_amount: ownWarehouseValue,
    drilldown_data: {
      type: "INVENTORY",
      title: "Hàng sở hữu tại kho TVK",
      total_value: ownWarehouseValue,
      items: ownWarehouseBatches,
    },
  });

  // Dòng 4.2: Hàng sở hữu gửi tại kho đối tác (Ví dụ gửi Á Âu)
  lines.push({
    data_group: "INVENTORY",
    item_key: "INV_PARTNER_VIRTUAL",
    item_name: "Hàng sở hữu gửi tại kho đối tác",
    item_subtext: "Kho ký gửi đối tác (Ví dụ gửi Cty Á Âu)",
    tvk_amount: partnerVirtualValue,
    drilldown_data: {
      type: "INVENTORY",
      title: "Hàng sở hữu gửi tại kho đối tác",
      total_value: partnerVirtualValue,
      items: partnerVirtualBatches,
    },
  });

  // Dòng 4.3 (Tham khảo): Hàng nhận ký gửi từ NCC
  lines.push({
    data_group: "INVENTORY",
    item_key: "INV_CONSIGNED_REF",
    item_name: "Hàng nhận ký gửi từ NCC (Tham khảo)",
    item_subtext: "Dòng tham khảo - không tính vào tổng tài sản tồn kho của TVK",
    tvk_amount: consignedRefValue,
    drilldown_data: {
      type: "INVENTORY",
      title: "Hàng nhận ký gửi từ NCC (Tham khảo)",
      total_value: consignedRefValue,
      items: consignedRefBatches,
    },
  });

  // =========================================================================
  // (5) DOANH THU TỔNG & CHI PHÍ THEO NHÓM GỌN
  // =========================================================================
  // 5.1: Doanh thu (Đã xuất HĐ GTGT vs Chưa xuất HĐ GTGT)
  const { data: salesDocs } = await supabase
    .from("sales_documents")
    .select(`
      id,
      doc_code,
      doc_date,
      total_amount,
      status,
      partners (name),
      sales_document_lines (
        id,
        line_total,
        vat_invoice_lines (
          id,
          is_active,
          vat_invoices (invoice_no, invoice_date, symbol)
        )
      )
    `)
    .eq("status", "CONFIRMED")
    .gte("doc_date", fromDate)
    .lte("doc_date", toDate);

  let revVatIssued = 0;
  let revVatPending = 0;
  const vatIssuedVouchers: any[] = [];
  const vatPendingVouchers: any[] = [];

  for (const doc of (salesDocs ?? []) as any[]) {
    const docCode = doc.doc_code;
    const partnerName = doc.partners?.name || "Khách hàng";
    const docDate = doc.doc_date;

    for (const line of (doc.sales_document_lines ?? []) as any[]) {
      const lineTotal = Number(line.line_total || 0);
      const activeVat = (line.vat_invoice_lines ?? []).find((v: any) => v.is_active);

      if (activeVat && activeVat.vat_invoices) {
        revVatIssued += lineTotal;
        vatIssuedVouchers.push({
          doc_code: docCode,
          doc_date: docDate,
          partner_name: partnerName,
          amount: lineTotal,
          vat_invoice_no: activeVat.vat_invoices.invoice_no,
          vat_symbol: activeVat.vat_invoices.symbol,
          vat_date: activeVat.vat_invoices.invoice_date,
        });
      } else {
        revVatPending += lineTotal;
        vatPendingVouchers.push({
          doc_code: docCode,
          doc_date: docDate,
          partner_name: partnerName,
          amount: lineTotal,
          status: "Chưa xuất hoá đơn GTGT",
        });
      }
    }
  }

  // Dòng 5.1a: Doanh thu Đã xuất HĐ GTGT
  lines.push({
    data_group: "REVENUE_EXPENSE",
    item_key: "REV_VAT_ISSUED",
    item_name: "Doanh thu: Đã xuất HĐ GTGT",
    item_subtext: "Chứng từ bán hàng đã gắn hoá đơn GTGT hợp lệ trong kỳ",
    tvk_amount: revVatIssued,
    drilldown_data: {
      type: "REVENUE",
      title: "Doanh thu đã xuất HĐ GTGT",
      total_amount: revVatIssued,
      vouchers: vatIssuedVouchers,
    },
  });

  // Dòng 5.1b: Doanh thu Chưa xuất HĐ GTGT
  lines.push({
    data_group: "REVENUE_EXPENSE",
    item_key: "REV_VAT_PENDING",
    item_name: "Doanh thu: Chưa xuất HĐ GTGT",
    item_subtext: "Chứng từ bán hàng nội bộ TVK chưa lập hoá đơn GTGT",
    tvk_amount: revVatPending,
    drilldown_data: {
      type: "REVENUE",
      title: "Doanh thu chưa xuất HĐ GTGT",
      total_amount: revVatPending,
      vouchers: vatPendingVouchers,
    },
  });

  // Dòng 5.1c: Tổng doanh thu nội bộ TVK
  const revTotal = revVatIssued + revVatPending;
  lines.push({
    data_group: "REVENUE_EXPENSE",
    item_key: "REV_TOTAL",
    item_name: "Tổng doanh thu nội bộ TVK",
    item_subtext: "Tổng doanh thu ghi nhận trên sổ TVK (= Đã xuất HĐ + Chưa xuất HĐ)",
    tvk_amount: revTotal,
    drilldown_data: {
      type: "REVENUE",
      title: "Tổng doanh thu nội bộ TVK",
      total_amount: revTotal,
      vouchers: [...vatIssuedVouchers, ...vatPendingVouchers],
    },
  });

  // 5.2: Chi phí theo 5 nhóm gọn từ operating cash movements
  const { data: opMovements } = await supabase
    .from("cash_movements")
    .select(`
      id,
      amount,
      movement_date,
      note,
      is_cancelled,
      category_id,
      cash_categories (id, code, name, group_key),
      cash_funds (name)
    `)
    .eq("movement_kind", "OPERATING")
    .gte("movement_date", fromDate)
    .lte("movement_date", toDate);

  const expenseGroups: Record<
    string,
    { key: string; name: string; amount: number; items: any[] }
  > = {
    SALARY: {
      key: "EXP_SALARY",
      name: "Chi phí Lương & Nhân sự",
      amount: 0,
      items: [],
    },
    RENT: {
      key: "EXP_RENT",
      name: "Chi phí Mặt bằng & Kho bãi",
      amount: 0,
      items: [],
    },
    TRANSPORT: {
      key: "EXP_TRANSPORT",
      name: "Chi phí Vận chuyển & Giao nhận",
      amount: 0,
      items: [],
    },
    TAX: {
      key: "EXP_TAX",
      name: "Chi phí Thuế & Phí nhà nước",
      amount: 0,
      items: [],
    },
    OTHER: {
      key: "EXP_OTHER",
      name: "Chi phí Vận hành khác",
      amount: 0,
      items: [],
    },
  };

  for (const m of (opMovements ?? []) as any[]) {
    if (m.is_cancelled) continue;
    const gKey = m.cash_categories?.group_key || "OTHER";
    const targetGroup = expenseGroups[gKey] || expenseGroups.OTHER;
    // Chi phí là dòng tiền ra (âm), hiển thị dưới dạng số dương trên bảng chi phí
    const val = Math.abs(Number(m.amount || 0));
    targetGroup.amount += val;
    targetGroup.items.push({
      id: m.id,
      date: m.movement_date,
      category_name: m.cash_categories?.name || "Chi phí",
      fund_name: m.cash_funds?.name || "Quỹ",
      amount: val,
      note: m.note || "Phiếu chi vận hành",
    });
  }

  for (const g of Object.values(expenseGroups)) {
    lines.push({
      data_group: "REVENUE_EXPENSE",
      item_key: g.key,
      item_name: g.name,
      item_subtext: "Chi phí vận hành thực tế đã chi trong kỳ",
      tvk_amount: g.amount,
      drilldown_data: {
        type: "EXPENSE",
        title: g.name,
        total_amount: g.amount,
        vouchers: g.items,
      },
    });
  }

  return lines;
}

/**
 * Đảm bảo kỳ đối chiếu tồn tại, đồng bộ số liệu TVK mới nhất và trả về dữ liệu đầy đủ.
 */
export async function ensureOrSyncReconciliationPeriod(params: {
  periodType: ReconciliationPeriodType;
  fromDate: string;
  toDate: string;
  name?: string;
  forceRefresh?: boolean;
}): Promise<{
  period: ReconciliationPeriod | null;
  entries: ReconciliationEntry[];
  snapshots: ReconciliationSnapshot[];
  kpis: ReconciliationKPIs;
}> {
  const supabase = await createClient();
  if (!supabase) {
    return {
      period: null,
      entries: [],
      snapshots: [],
      kpis: {
        totalTvk: 0,
        totalAcc: 0,
        netDiff: 0,
        matchedCount: 0,
        pendingCount: 0,
        validTaxTimingCount: 0,
        accountingErrorCount: 0,
        tvkErrorCount: 0,
      },
    };
  }

  // 1. Tìm hoặc tạo period
  const { data: existingPeriods } = await supabase
    .from("reconciliation_periods")
    .select("*")
    .eq("period_type", params.periodType)
    .eq("from_date", params.fromDate)
    .eq("to_date", params.toDate)
    .order("created_at", { ascending: false })
    .limit(1);

  let period = (existingPeriods && existingPeriods[0]) as ReconciliationPeriod | null;

  if (!period) {
    const admin = createAdminClient() || supabase;
    const periodName =
      params.name ||
      (params.periodType === "MONTH"
        ? `Tháng ${params.fromDate.slice(5, 7)}/${params.fromDate.slice(0, 4)}`
        : `Kỳ ${params.fromDate} - ${params.toDate}`);

    const { data: created, error } = await admin
      .from("reconciliation_periods")
      .insert({
        period_type: params.periodType,
        name: periodName,
        from_date: params.fromDate,
        to_date: params.toDate,
        status: "OPEN",
      })
      .select("*")
      .single();

    if (error) {
      console.error("Error creating reconciliation period:", error);
    } else {
      period = created as ReconciliationPeriod;
    }
  }

  if (!period) {
    return {
      period: null,
      entries: [],
      snapshots: [],
      kpis: {
        totalTvk: 0,
        totalAcc: 0,
        netDiff: 0,
        matchedCount: 0,
        pendingCount: 0,
        validTaxTimingCount: 0,
        accountingErrorCount: 0,
        tvkErrorCount: 0,
      },
    };
  }

  // 2. Lấy các entries hiện tại
  const { data: existingEntries } = await supabase
    .from("reconciliation_entries")
    .select("*")
    .eq("period_id", period.id)
    .order("created_at", { ascending: true });

  const existingMap = new Map<string, any>();
  for (const e of (existingEntries ?? []) as any[]) {
    existingMap.set(`${e.data_group}__${e.item_key}`, e);
  }

  // 3. Tính toán số liệu trực tiếp TVK
  const liveLines = await computeLiveTVKMetrics(period.from_date, period.to_date);

  // 4. Đồng bộ (Upsert) vào reconciliation_entries bảo toàn dữ liệu nhập kế toán
  const adminClient = createAdminClient() || supabase;
  const entriesToUpsert: any[] = [];

  for (const line of liveLines) {
    const key = `${line.data_group}__${line.item_key}`;
    const old = existingMap.get(key);

    if (old) {
      // Giữ nguyên số kế toán, ghi chú và trạng thái đã có
      entriesToUpsert.push({
        id: old.id,
        period_id: period.id,
        data_group: line.data_group,
        item_key: line.item_key,
        item_name: line.item_name,
        item_subtext: line.item_subtext,
        tvk_amount: line.tvk_amount,
        accounting_amount: old.accounting_amount,
        discrepancy_status: old.discrepancy_status,
        explanation_note: old.explanation_note,
        drilldown_data: line.drilldown_data,
        updated_at: new Date().toISOString(),
      });
    } else {
      // Dòng mới phát sinh
      entriesToUpsert.push({
        period_id: period.id,
        data_group: line.data_group,
        item_key: line.item_key,
        item_name: line.item_name,
        item_subtext: line.item_subtext,
        tvk_amount: line.tvk_amount,
        accounting_amount: 0,
        discrepancy_status: Math.abs(line.tvk_amount) < 0.01 ? "MATCHED" : "PENDING",
        explanation_note: null,
        drilldown_data: line.drilldown_data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (entriesToUpsert.length > 0) {
    const { error: upsertErr } = await adminClient
      .from("reconciliation_entries")
      .upsert(entriesToUpsert, { onConflict: "period_id, data_group, item_key" });
    if (upsertErr) {
      console.error("Upsert reconciliation entries error:", upsertErr);
    }
  }

  // 5. Đọc lại danh sách entries hoàn chỉnh
  const { data: finalEntries } = await supabase
    .from("reconciliation_entries")
    .select("*")
    .eq("period_id", period.id)
    .order("created_at", { ascending: true });

  const entries = (finalEntries ?? []) as ReconciliationEntry[];

  // 6. Lấy snapshots của kỳ này
  const { data: snapshotsRes } = await supabase
    .from("reconciliation_snapshots")
    .select("*")
    .eq("period_id", period.id)
    .order("snapshot_no", { ascending: false });

  const snapshots = (snapshotsRes ?? []) as ReconciliationSnapshot[];

  // 7. Tính KPI tổng quan (Loại trừ dòng tham khảo INV_CONSIGNED_REF và dòng tổng REV_TOTAL để tránh cộng đúp)
  let totalTvk = 0;
  let totalAcc = 0;
  let matchedCount = 0;
  let pendingCount = 0;
  let validTaxTimingCount = 0;
  let accountingErrorCount = 0;
  let tvkErrorCount = 0;

  for (const e of entries) {
    // Không cộng đúp REV_TOTAL vì đã có REV_VAT_ISSUED + REV_VAT_PENDING
    // Không cộng INV_CONSIGNED_REF vào tài sản tổng TVK vì là hàng ký gửi tham khảo
    const isExcludedFromTotals =
      e.item_key === "REV_TOTAL" || e.item_key === "INV_CONSIGNED_REF";

    if (!isExcludedFromTotals) {
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
        validTaxTimingCount++;
        break;
      case "ACCOUNTING_ERROR":
        accountingErrorCount++;
        break;
      case "TVK_ERROR":
        tvkErrorCount++;
        break;
    }
  }

  const kpis: ReconciliationKPIs = {
    totalTvk,
    totalAcc,
    netDiff: totalTvk - totalAcc,
    matchedCount,
    pendingCount,
    validTaxTimingCount,
    accountingErrorCount,
    tvkErrorCount,
  };

  return {
    period,
    entries,
    snapshots,
    kpis,
  };
}

/**
 * Lấy danh sách toàn bộ các kỳ đối chiếu đã có
 */
export async function getAllReconciliationPeriods(): Promise<ReconciliationPeriod[]> {
  const supabase = await createClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("reconciliation_periods")
    .select("*")
    .order("from_date", { ascending: false });
  return (data ?? []) as ReconciliationPeriod[];
}

/**
 * Lấy lịch sử snapshots
 */
export async function getAllReconciliationSnapshots(
  periodId?: string
): Promise<ReconciliationSnapshot[]> {
  const supabase = await createClient();
  if (!supabase) return [];
  let q = supabase
    .from("reconciliation_snapshots")
    .select("*")
    .order("created_at", { ascending: false });
  if (periodId) {
    q = q.eq("period_id", periodId);
  }
  const { data } = await q;
  return (data ?? []) as ReconciliationSnapshot[];
}
