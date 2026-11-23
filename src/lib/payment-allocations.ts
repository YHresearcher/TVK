import { createClient } from "@/lib/supabase/server";
import type { AnyRow } from "@/lib/types";

/**
 * P3 — Phân bổ thanh toán theo ngành (payment_allocations).
 *
 * Mỗi phiếu thu/chi (PT/PC) sau 0027 có các dòng phân bổ: mỗi dòng trỏ
 * đúng một khoản công nợ (phải thu / phải trả / dòng đợt chốt sổ) + ngành
 * hàng của khoản đó. Phiếu đảo có các dòng gương âm trỏ lại dòng gốc.
 * RLS: payment_allocations chỉ cho OWNER/ACCOUNTING/CEO xem, không ai
 * ghi trực tiếp — chỉ trigger apply_payment_to_balance (SECURITY DEFINER)
 * mới ghi.
 */

/** Một dòng phân bổ thanh toán. */
export interface PaymentAllocationRow {
  id: string;
  payment_id: string;
  receivable_id: string | null;
  payable_id: string | null;
  settlement_id: string | null;
  settlement_line_id: string | null;
  business_line_id: string;
  business_line_code: string | null;
  amount: number;
  reversal_of_id: string | null;
}

/** Một phiếu thu/chi kèm phân bổ + trạng thái đảo. */
export interface PaymentWithAllocations {
  id: string;
  doc_code: string;
  payment_kind: "IN" | "OUT";
  payment_date: string;
  amount: number;
  method: string | null;
  fund_id: string | null;
  note: string | null;
  settlement_id: string | null;
  payable_id: string | null;
  receivable_id: string | null;
  reversal_of_id: string | null;
  created_at: string;
  /** Người tạo phiếu (auth uid). */
  created_by: string | null;
  /** Tên hiển thị của người tạo (tra từ profiles). */
  createdByName: string | null;
  /** Mô tả khoản công nợ được thanh toán (đối tác/NCC + chứng từ gốc). */
  obligationLabel: string;
  allocations: PaymentAllocationRow[];
  allocationSummary: AllocationSummaryRow[];
  /** Mã phiếu đảo đã đảo phiếu này (null nếu chưa bị đảo). */
  reversedByDocCode: string | null;
}

export interface AllocationSummaryRow {
  lineCode: string | null;
  lineLabel: string;
  amount: number;
}

/** Nhãn ngành hiển thị cho mã ngành (OIL / AUTO_PARTS / null). */
export function allocationLineLabel(code: string | null | undefined): string {
  if (code === "OIL") return "Dầu nhớt";
  if (code === "AUTO_PARTS") return "Phụ tùng";
  return "Chưa phân loại";
}

/** Gom các dòng phân bổ theo ngành, cộng tiền từng ngành (hàm thuần). */
export function buildAllocationSummary(
  allocations: { business_line_code: string | null; amount: number }[],
): AllocationSummaryRow[] {
  const byLine = new Map<string | null, number>();
  for (const a of allocations) {
    byLine.set(a.business_line_code, (byLine.get(a.business_line_code) ?? 0) + Number(a.amount));
  }
  return Array.from(byLine.entries())
    .map(([lineCode, amount]) => ({ lineCode, lineLabel: allocationLineLabel(lineCode), amount }))
    .sort((a, b) => String(a.lineCode ?? "").localeCompare(String(b.lineCode ?? "")));
}

/**
 * Một phiếu có đảo được không (hàm thuần, BL-021):
 * - chưa phải là phiếu đảo (reversal_of_id null), và
 * - chưa bị đảo bởi phiếu khác.
 */
export function isReversiblePayment(
  payment: { id: string; reversal_of_id: string | null },
  allPayments: { id: string; reversal_of_id: string | null }[],
): boolean {
  if (payment.reversal_of_id) return false;
  return !allPayments.some((p) => p.reversal_of_id === payment.id);
}

/** Nhãn trạng thái đảo của một phiếu: "Bút toán đảo" / "Đã đảo" / "". */
export function paymentReversalLabel(
  payment: { reversal_of_id: string | null },
  reversedByDocCode: string | null,
): string {
  if (payment.reversal_of_id) return "Bút toán đảo";
  if (reversedByDocCode) return `Đã đảo (${reversedByDocCode})`;
  return "";
}

/**
 * Tách lý do đảo ra khỏi ghi chú phiếu đảo (hàm thuần).
 * - Định dạng 0029 (hiện hành): "Đảo của <mã phiếu gốc>: <lý do>".
 * - Định dạng 0027 (cũ, P3): "Đảo bút toán <mã phiếu gốc> (Lý do: <lý do>)".
 * Trả "" khi ghi chú không theo mẫu nào (phiếu thường, phiếu đảo ghi tay).
 */
export function reversalReasonFromNote(note: string | null | undefined): string {
  if (!note) return "";
  const m29 = note.match(/^Đảo của \S+: (.*)$/);
  if (m29) return m29[1].trim();
  const m27 = note.match(/^Đảo bút toán \S+ \(Lý do: (.*)\)$/);
  if (m27) return m27[1].trim();
  return "";
}

/** Một dòng trong nhật ký đảo bút toán (OWNER + Kế toán xem được). */
export interface ReversalLogRow {
  reversalId: string;
  reversalCode: string;
  originalId: string;
  originalCode: string;
  amount: number;
  reason: string;
  createdByName: string | null;
  createdAt: string;
  paymentDate: string;
}

/**
 * Nhật ký đảo bút toán từ danh sách phiếu (hàm thuần): chỉ các phiếu
 * đảo (reversal_of_id khác null), kèm phiếu gốc, số tiền, lý do, người
 * đảo, thời gian — mới nhất trước.
 */
export function getReversalLog(payments: PaymentWithAllocations[]): ReversalLogRow[] {
  const codeById = new Map(payments.map((p) => [p.id, p.doc_code]));
  return payments
    .filter((p) => p.reversal_of_id)
    .map((p) => ({
      reversalId: p.id,
      reversalCode: p.doc_code,
      originalId: p.reversal_of_id as string,
      originalCode: codeById.get(p.reversal_of_id as string) ?? "",
      amount: p.amount,
      reason: reversalReasonFromNote(p.note),
      createdByName: p.createdByName,
      createdAt: p.created_at,
      paymentDate: p.payment_date,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Liệt kê phiếu thu (IN) hoặc chi (OUT) kèm phân bổ theo ngành.
 * lineId: undefined = không lọc (ALL); null (chưa gán ngành) = rỗng
 * (fail-closed, như list()). Phiếu không có phân bổ (phiếu cũ chưa có
 * tham chiếu công nợ) vẫn hiện — không giấu tiền.
 */
export async function listPaymentsWithAllocations(
  kind: "IN" | "OUT",
  lineId?: string | null,
): Promise<{ configured: boolean; data: PaymentWithAllocations[] }> {
  const supabase = await createClient();
  if (!supabase) return { configured: false, data: [] };
  if (lineId === null) return { configured: true, data: [] };

  const { data: payments, error } = await supabase
    .from("payments")
    .select("*")
    .eq("payment_kind", kind)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error || !payments?.length) return { configured: true, data: [] };

  const rows = payments as AnyRow[];
  // Phiếu đảo có payment_kind ngược lại (đảo thu IN = chi OUT) nhưng vẫn
  // thuộc về phía công nợ này — lấy thêm các phiếu đảo của các phiếu trên.
  const { data: reversals } = await supabase
    .from("payments")
    .select("*")
    .in("reversal_of_id", rows.map((p) => String(p.id)))
    .limit(500);
  const allRows = [...rows, ...((reversals ?? []) as AnyRow[])].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );
  const paymentIds = allRows.map((p) => String(p.id));
  // Tên người tạo phiếu (cho nhật ký đảo: ai đảo, lúc nào) — mẫu
  // tra profiles như trang lịch sử kho (queries.ts listLedgerMovements).
  const creatorIds = Array.from(new Set(allRows.map((p) => String(p.created_by ?? "")).filter(Boolean)));
  const creatorName = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .in("id", creatorIds);
    for (const pr of ((profs ?? []) as AnyRow[])) {
      creatorName.set(String(pr.id), String(pr.full_name || pr.username || ""));
    }
  }
  const [allocRes, recvRes, payRes, dsRes, docsRes, rcptRes, partnersRes, suppliersRes] = await Promise.all([
    supabase.from("payment_allocations").select("*, business_lines(code)").in("payment_id", paymentIds).limit(5000),
    supabase.from("partner_receivables").select("id, partner_id, source_document_id").limit(5000),
    supabase.from("supplier_payables").select("id, supplier_id, source_document_id, purchase_receipt_id, source_kind").limit(5000),
    supabase.from("settlements").select("id, doc_code, party_kind, partner_id, supplier_id").limit(500),
    supabase.from("sales_documents").select("id, doc_code").limit(5000),
    supabase.from("purchase_receipts").select("id, doc_code").limit(5000),
    supabase.from("partners").select("id, name").limit(500),
    supabase.from("suppliers").select("id, name").limit(500),
  ]);

  const allocByPayment = new Map<string, PaymentAllocationRow[]>();
  for (const a of ((allocRes.data ?? []) as AnyRow[])) {
    const row: PaymentAllocationRow = {
      id: String(a.id),
      payment_id: String(a.payment_id),
      receivable_id: a.receivable_id ? String(a.receivable_id) : null,
      payable_id: a.payable_id ? String(a.payable_id) : null,
      settlement_id: a.settlement_id ? String(a.settlement_id) : null,
      settlement_line_id: a.settlement_line_id ? String(a.settlement_line_id) : null,
      business_line_id: String(a.business_line_id),
      business_line_code: (a.business_lines as AnyRow | null)?.code ? String((a.business_lines as AnyRow).code) : null,
      amount: Number(a.amount),
      reversal_of_id: a.reversal_of_id ? String(a.reversal_of_id) : null,
    };
    const list = allocByPayment.get(row.payment_id) ?? [];
    list.push(row);
    allocByPayment.set(row.payment_id, list);
  }

  const recvById = new Map(((recvRes.data ?? []) as AnyRow[]).map((r) => [String(r.id), r]));
  const payById = new Map(((payRes.data ?? []) as AnyRow[]).map((r) => [String(r.id), r]));
  const dsById = new Map(((dsRes.data ?? []) as AnyRow[]).map((r) => [String(r.id), r]));
  const docCode = new Map(((docsRes.data ?? []) as AnyRow[]).map((r) => [String(r.id), String(r.doc_code)]));
  const rcptCode = new Map(((rcptRes.data ?? []) as AnyRow[]).map((r) => [String(r.id), String(r.doc_code)]));
  const partnerName = new Map(((partnersRes.data ?? []) as AnyRow[]).map((r) => [String(r.id), String(r.name)]));
  const supplierName = new Map(((suppliersRes.data ?? []) as AnyRow[]).map((r) => [String(r.id), String(r.name)]));

  const reversedBy = new Map<string, string>();
  for (const p of allRows) {
    if (p.reversal_of_id) reversedBy.set(String(p.reversal_of_id), String(p.doc_code ?? ""));
  }

  const obligationLabel = (p: AnyRow): string => {
    if (p.settlement_id) {
      const ds = dsById.get(String(p.settlement_id));
      const party = ds
        ? ds.party_kind === "SUPPLIER"
          ? supplierName.get(String(ds.supplier_id)) ?? "Nhà cung cấp"
          : partnerName.get(String(ds.partner_id)) ?? "Đối tác"
        : "—";
      return `Đợt chốt sổ ${ds ? String(ds.doc_code) : ""} — ${party}`;
    }
    if (p.receivable_id) {
      const r = recvById.get(String(p.receivable_id));
      const name = r ? partnerName.get(String(r.partner_id)) ?? "Đối tác" : "Đối tác";
      const doc = r?.source_document_id ? docCode.get(String(r.source_document_id)) ?? "" : "";
      return `Phải thu ${name}${doc ? ` — ${doc}` : ""}`;
    }
    if (p.payable_id) {
      const r = payById.get(String(p.payable_id));
      const name = r ? supplierName.get(String(r.supplier_id)) ?? "Nhà cung cấp" : "Nhà cung cấp";
      const doc = r
        ? r.source_kind === "PURCHASE"
          ? rcptCode.get(String(r.purchase_receipt_id)) ?? ""
          : docCode.get(String(r.source_document_id)) ?? ""
        : "";
      return `Phải trả ${name}${doc ? ` — ${doc}` : ""}`;
    }
    return "—";
  };

  const out: PaymentWithAllocations[] = allRows.map((p) => {
    const allocations = allocByPayment.get(String(p.id)) ?? [];
    return {
      id: String(p.id),
      doc_code: String(p.doc_code ?? ""),
      payment_kind: (p.payment_kind === "OUT" ? "OUT" : "IN") as "IN" | "OUT",
      payment_date: String(p.payment_date ?? ""),
      amount: Number(p.amount),
      method: p.method ? String(p.method) : null,
      fund_id: p.fund_id ? String(p.fund_id) : null,
      note: p.note ? String(p.note) : null,
      settlement_id: p.settlement_id ? String(p.settlement_id) : null,
      payable_id: p.payable_id ? String(p.payable_id) : null,
      receivable_id: p.receivable_id ? String(p.receivable_id) : null,
      reversal_of_id: p.reversal_of_id ? String(p.reversal_of_id) : null,
      created_at: String(p.created_at ?? ""),
      created_by: p.created_by ? String(p.created_by) : null,
      createdByName: p.created_by ? (creatorName.get(String(p.created_by)) ?? null) : null,
      obligationLabel: obligationLabel(p),
      allocations,
      allocationSummary: buildAllocationSummary(allocations),
      reversedByDocCode: reversedBy.get(String(p.id)) ?? null,
    };
  });

  if (lineId === undefined) return { configured: true, data: out };
  // Lọc theo ngành qua phân bổ; phiếu không có phân bổ vẫn hiện.
  return {
    configured: true,
    data: out.filter(
      (p) =>
        p.allocations.length === 0 ||
        p.allocations.some((a) => a.business_line_id === lineId),
    ),
  };
}
