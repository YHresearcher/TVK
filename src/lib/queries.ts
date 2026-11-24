import { createClient } from "@/lib/supabase/server";
import { buildAging } from "@/lib/aging";
import { todayISO } from "@/lib/format";
import type { AnyRow, Profile, RingSegment, StockRings } from "@/lib/types";
import { listBusinessLines } from "@/lib/business-lines";
import {
  buildLineComparison,
  mergeGroupPerformance,
  type DebtByLineInput,
  type DebtKind,
  type InventoryByLineInput,
  type LineComparisonRow,
  type SalesByLineInput,
} from "@/lib/reporting";

export interface QueryResult<T> {
  configured: boolean;
  data: T;
}

const empty = <T,>(data: T): QueryResult<T> => ({ configured: false, data });

async function client() {
  return createClient();
}

export async function getCurrentProfile(): Promise<QueryResult<Profile | null>> {
  const supabase = await client();
  if (!supabase) return empty(null);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { configured: true, data: null };
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return { configured: true, data: (data as Profile) ?? null };
}

/**
 * P2: lineId lọc theo business_line_id (chỉ bảng nào có cột này mới
 * truyền). lineId === undefined -> không lọc (ngữ cảnh ALL);
 * lineId === null (tài khoản chưa gán ngành) -> trả rỗng ngay, không
 * truy vấn — fail-closed.
 */
async function list<T = AnyRow>(
  table: string,
  order?: { column: string; ascending?: boolean },
  limit = 500,
  lineId?: string | null
): Promise<QueryResult<T[]>> {
  const supabase = await client();
  if (!supabase) return empty([]);
  if (lineId === null) return { configured: true, data: [] };
  let q = supabase.from(table).select("*").limit(limit);
  if (lineId !== undefined) q = q.eq("business_line_id", lineId);
  if (order) q = q.order(order.column, { ascending: order.ascending ?? false });
  const { data, error } = await q;
  if (error) return { configured: true, data: [] };
  return { configured: true, data: (data ?? []) as T[] };
}

export const listProducts = (lineId?: string | null) =>
  list("products", { column: "name", ascending: true }, 500, lineId);

/**
 * P5 (E8) — "validated pagination": kéo toàn bộ dòng của một truy vấn
 * theo từng trang range() với thứ tự ổn định (bên gọi phải .order() một
 * cột duy nhất hoặc tổ hợp duy nhất trước khi .range()). NÉM LỖI khi
 * DB báo lỗi — không lặng lẽ thiếu số như .limit() cố định trước đây.
 * Bên gọi tự quyết: getDashboard / getPerformanceSeries để lỗi lan ra
 * (số tiền sai còn tệ hơn trang lỗi), các widget phụ bắt lỗi và trả rỗng.
 */
async function fetchAllPages(
  buildPage: (from: number, to: number) => Promise<{ data: AnyRow[]; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<AnyRow[]> {
  const out: AnyRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/** Chia danh sách id thành từng chunk tối đa 200 (giới hạn .in() — E8). */
function chunkIds(ids: string[], size = 200): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Map id ngành -> mã ngành (view báo cáo chỉ trả business_line_id). */
async function getLineCodeById(): Promise<Map<string, string>> {
  const supabase = await client();
  if (!supabase) return new Map();
  const { data } = await supabase.from("business_lines").select("id, code");
  return new Map(((data ?? []) as AnyRow[]).map((r) => [String(r.id), String(r.code)]));
}

/** Các nhóm hàng đã dùng (để lọc + gợi ý khi gán nhóm). */
export async function listProductGroups(): Promise<string[]> {
  const supabase = await client();
  if (!supabase) return [];
  const { data, error } = await supabase.from("products").select("product_group").limit(5000);
  if (error || !data) return [];
  const groups = new Set<string>();
  for (const r of data as AnyRow[]) {
    const g = String(r.product_group ?? "").trim();
    if (g) groups.add(g);
  }
  return Array.from(groups).sort((a, b) => a.localeCompare(b, "vi"));
}
export const listProductCodes = () =>
  list("product_codes", { column: "code", ascending: true });

/** Dòng xe (vehicles.model) của từng sản phẩm, để tìm hàng theo mã xe ở quầy bán. */
export async function listProductFitments(): Promise<QueryResult<AnyRow[]>> {
  const supabase = await client();
  if (!supabase) return empty([]);
  const { data, error } = await supabase
    .from("product_fitments")
    .select("product_id, vehicles(model)")
    .limit(5000);
  if (error) return { configured: true, data: [] };
  return { configured: true, data: (data ?? []) as AnyRow[] };
}

import { normCode } from "@/lib/product-match";

/** Normalized (hoa + bỏ mọi khoảng trắng) map: any known product code or SKU → product_id. Used by the barcode scan box. */
export function buildProductCodeMap(
  products: AnyRow[],
  codes: AnyRow[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of products) {
    if (p.sku) map[normCode(p.sku)] = p.id;
  }
  for (const c of codes) {
    if (c.code) map[normCode(c.code)] = c.product_id;
  }
  return map;
}
export const listProductStock = () => list("v_product_stock", { column: "name", ascending: true });
export const listBatchStock = () =>
  list("v_batch_stock", { column: "received_date", ascending: false });
/** View an toàn cho SALES: tồn theo lô, không có giá vốn. Dùng cho mọi
 *  luồng bán hàng / ký gửi / phân bổ mà SALES được phép thao tác. */
export const listBatchesForSales = () =>
  list("v_batches_for_sales", { column: "received_date", ascending: false });
export const listSuppliers = () =>
  list("suppliers", { column: "name", ascending: true });
export const listPartners = () =>
  list("partners", { column: "name", ascending: true });
export const listLocations = () =>
  list("locations", { column: "name", ascending: true });
export const listPurchaseReceipts = (lineId?: string | null) =>
  list("purchase_receipts", { column: "created_at" }, 500, lineId);
export const listConsignmentReceipts = (lineId?: string | null) =>
  list("consignment_receipts", { column: "created_at" }, 500, lineId);
export const listConsignmentOutSlips = (lineId?: string | null) =>
  list("consignment_out_slips", { column: "created_at" }, 500, lineId);
export const listConsumptionReports = (lineId?: string | null) =>
  list("consumption_reports", { column: "created_at" }, 500, lineId);
export const listAllocations = (lineId?: string | null) =>
  list("allocation_slips", { column: "created_at" }, 500, lineId);
export const listSalesOrders = () =>
  list("sales_orders", { column: "created_at" });
export const listSalesDocuments = (lineId?: string | null) =>
  list("sales_documents", { column: "created_at" }, 500, lineId);
/**
 * P4b — Hoá đơn GTGT lọc theo ngành (cột business_line_id trên
 * vat_invoices). Hoá đơn cũ chưa có ngành (NULL) vẫn hiện ở mọi ngữ
 * cảnh — không giấu tiền; chỉ ẩn hoá đơn đã xác định thuộc ngành khác.
 */
export async function listVatInvoices(lineId?: string | null): Promise<QueryResult<AnyRow[]>> {
  const res = await list<AnyRow>("vat_invoices", { column: "invoice_date" });
  if (lineId === undefined || lineId === null || !res.data.length) {
    return lineId === null ? { configured: true, data: [] } : res;
  }
  return {
    configured: true,
    data: (res.data as AnyRow[]).filter(
      (r) => r.business_line_id === null || r.business_line_id === undefined || r.business_line_id === lineId,
    ),
  };
}
/**
 * P4b — Phải trả lọc theo ngành (cột business_line_id trên
 * supplier_payables, backfill từ chứng từ gốc ở 0029; trigger tự điền
 * cho khoản mới). Hàng chưa quy chiếu được (NULL) vẫn hiện — không
 * giấu tiền; chỉ ẩn hàng đã xác định thuộc ngành khác.
 */
export async function listPayables(lineId?: string | null): Promise<QueryResult<AnyRow[]>> {
  const res = await list<AnyRow>("supplier_payables", { column: "created_at" });
  if (lineId === undefined || lineId === null || !res.data.length) {
    return lineId === null ? { configured: true, data: [] } : res;
  }
  return {
    configured: true,
    data: (res.data as AnyRow[]).filter(
      (r) => r.business_line_id === null || r.business_line_id === undefined || r.business_line_id === lineId,
    ),
  };
}
export const listCashFunds = () =>
  list("cash_funds", { column: "name", ascending: true });
/** Số dư từng quỹ (số dư đầu kỳ + biến động thu/chi đã ghi). */
export const getCashFundBalances = () =>
  list("v_cash_fund_balances", { column: "fund_name", ascending: true });
export async function listReceivables(lineId?: string | null): Promise<QueryResult<AnyRow[]>> {
  const res = await list<AnyRow>("partner_receivables", { column: "created_at" });
  if (lineId === undefined || lineId === null || !res.data.length) {
    return lineId === null ? { configured: true, data: [] } : res;
  }
  return {
    configured: true,
    data: (res.data as AnyRow[]).filter(
      (r) => r.business_line_id === null || r.business_line_id === undefined || r.business_line_id === lineId,
    ),
  };
}
export const listReturnDocuments = (lineId?: string | null) =>
  list("return_documents", { column: "created_at" }, 500, lineId);
export const listSettlements = () =>
  list("settlements", { column: "created_at" });
export const listPayments = () =>
  list("payments", { column: "created_at" });
export const listSupplierConsignment = () => list("v_supplier_consignment");
export const listPartnerConsignment = () => list("v_partner_consignment");
export const listConsumptionProgress = () => list("v_consumption_progress");
export const listPartnerTermBalance = () => list("v_partner_term_balance");

/** Giá trị ước tính của hàng còn giữ ở từng đối tác: số lượng × giá chuyển
 *  giao mới nhất của lô (phiếu GK đã xác nhận), không có thì giá bán của
 *  sản phẩm. Chỉ để ước lượng số tiền sẽ thu khi đối tác bán hết hàng —
 *  chưa phải khoản phải thu (phải thu chỉ phát sinh khi tiêu thụ). */
/**
 * P5: lineId lọc ước tính theo ngành (hàng ở kho đối tác của ngành đó);
 * undefined = toàn doanh nghiệp (hành vi cũ).
 */
export async function getPartnerRemainingEstimates(lineId?: string | null): Promise<Map<string, number>> {
  const supabase = await client();
  const out = new Map<string, number>();
  if (!supabase) return out;
  if (lineId === null) return out;
  // P6 — không .limit() cố định (2000 phiếu GK / 500 phiếu / 5000
  // dòng GK) và không để truy vấn sản phẩm không giới hạn (PostgREST
  // mặc định chỉ trả 1000 dòng): kéo toàn bộ bằng fetchAllPages
  // (thứ tự ổn định), dòng GK theo từng chunk 200 phiếu. Lỗi DB ném
  // ra theo quy ước P5/E8.
  const [stockRows, slipRows, productRows] = await Promise.all([
    fetchAllPages(async (from, to) => {
      let q = supabase
        .from("v_batch_stock")
        .select("batch_id, product_id, partner_id, qty")
        .eq("location_kind", "PARTNER_VIRTUAL");
      if (lineId !== undefined) q = q.eq("business_line_id", lineId);
      const { data, error } = await q.order("batch_id", { ascending: true }).range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await supabase
        .from("consignment_out_slips")
        .select("id, created_at")
        .eq("status", "CONFIRMED")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await supabase
        .from("products")
        .select("id, retail_price, wholesale_price")
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
  ]);
  const slipCreated = new Map(
    slipRows.map((s) => [String(s.id), String(s.created_at)])
  );
  const latestTransfer = new Map<string, number>();
  if (slipRows.length) {
    const gkItems: AnyRow[] = [];
    for (const chunk of chunkIds(slipRows.map((s) => String(s.id)))) {
      const rows = await fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("consignment_out_items")
          .select("slip_id, batch_id, transfer_price")
          .in("slip_id", chunk)
          .order("slip_id", { ascending: true })
          .order("batch_id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      });
      gkItems.push(...rows);
    }
    const sorted = gkItems.sort((a, b) =>
      String(slipCreated.get(String(b.slip_id)) ?? "").localeCompare(
        String(slipCreated.get(String(a.slip_id)) ?? "")
      )
    );
    for (const it of sorted) {
      const key = String(it.batch_id);
      if (!latestTransfer.has(key)) latestTransfer.set(key, Number(it.transfer_price ?? 0));
    }
  }
  const sellPrice = new Map(
    productRows.map((p) => [
      String(p.id),
      Number(p.retail_price ?? 0) > 0 ? Number(p.retail_price) : Number(p.wholesale_price ?? 0),
    ])
  );
  for (const r of stockRows) {
    const qty = Number(r.qty ?? 0);
    if (!qty || !r.partner_id) continue;
    const tp = latestTransfer.get(String(r.batch_id));
    const unit = tp !== undefined ? tp : sellPrice.get(String(r.product_id)) ?? 0;
    const pid = String(r.partner_id);
    out.set(pid, (out.get(pid) ?? 0) + qty * unit);
  }
  return out;
}

/** Thống kê nhanh của từng đối tác cho cửa sổ bật lên ở dashboard: cùng
 *  công thức với getPartnerDetail nhưng gộp một lần cho mọi đối tác. */
export interface PartnerStat {
  id: string;
  name: string;
  outstanding: number;
  totalPaid: number;
  invoiceCount: number;
  invoiceTotal: number;
  stillAtPartner: number;
}

export async function listPartnerStats(): Promise<PartnerStat[]> {
  const supabase = await client();
  if (!supabase) return [];
  const [partners, receivables, invoices, consignment] = await Promise.all([
    supabase.from("partners").select("id, name").order("name").limit(500),
    supabase.from("partner_receivables").select("partner_id, amount, amount_paid, status").limit(2000),
    supabase.from("vat_invoices").select("partner_id, total_amount, status").limit(2000),
    supabase.from("v_partner_consignment").select("partner_id, qty_still_at_partner").limit(500),
  ]);
  const byId = new Map<string, PartnerStat>();
  for (const p of (partners.data ?? []) as AnyRow[]) {
    byId.set(String(p.id), {
      id: String(p.id),
      name: String(p.name),
      outstanding: 0,
      totalPaid: 0,
      invoiceCount: 0,
      invoiceTotal: 0,
      stillAtPartner: 0,
    });
  }
  for (const r of (receivables.data ?? []) as AnyRow[]) {
    const s = byId.get(String(r.partner_id));
    if (!s) continue;
    if (r.status === "UNPAID" || r.status === "PARTIAL") {
      s.outstanding += Number(r.amount) - Number(r.amount_paid);
    }
    s.totalPaid += Number(r.amount_paid);
  }
  for (const i of (invoices.data ?? []) as AnyRow[]) {
    const s = byId.get(String(i.partner_id));
    if (!s || i.status !== "ISSUED") continue;
    s.invoiceCount += 1;
    s.invoiceTotal += Number(i.total_amount);
  }
  for (const c of (consignment.data ?? []) as AnyRow[]) {
    const s = byId.get(String(c.partner_id));
    if (s) s.stillAtPartner = Number(c.qty_still_at_partner ?? 0);
  }
  return Array.from(byId.values());
}

export async function getProductDetail(id: string) {
  const supabase = await client();
  if (!supabase)
    return { configured: false, product: null, codes: [], fitments: [], batches: [] };
  const [product, codes, fitments, batches] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase.from("product_codes").select("*").eq("product_id", id),
    supabase
      .from("product_fitments")
      .select("*, vehicles(*)")
      .eq("product_id", id),
    supabase
      .from("v_batches_for_sales")
      .select("batch_id, batch_code, product_id, sku, product_name, ownership, supplier_id, supplier_name, location_id, location_name, location_kind, partner_id, qty, received_date, status, return_by_date, expiry_date")
      .eq("product_id", id),
  ]);
  return {
    configured: true,
    product: product.data,
    codes: codes.data ?? [],
    fitments: fitments.data ?? [],
    batches: batches.data ?? [],
  };
}

export async function getAllocationDetail(id: string) {
  const supabase = await client();
  if (!supabase) return { configured: false, slip: null, lines: [], documentedLineIds: [] as string[] };
  const [slip, lines] = await Promise.all([
    supabase.from("allocation_slips").select("*").eq("id", id).maybeSingle(),
    supabase.from("allocation_lines").select("*").eq("allocation_id", id),
  ]);
  const lineIds = (lines.data ?? []).map((l: AnyRow) => l.id);
  let documentedLineIds: string[] = [];
  if (lineIds.length) {
    const { data } = await supabase
      .from("sales_document_lines")
      .select("allocation_line_id")
      .in("allocation_line_id", lineIds);
    documentedLineIds = (data ?? []).map((r: AnyRow) => r.allocation_line_id);
  }
  return {
    configured: true,
    slip: slip.data,
    lines: lines.data ?? [],
    documentedLineIds,
  };
}

/**
 * Sales-document lines of CONFIRMED documents that are not on any active VAT invoice yet.
 * P4b — lọc theo ngành qua sản phẩm của dòng (một hoá đơn GTGT chỉ
 * ghi cho một ngành). Dòng thuộc sản phẩm chưa phân loại vẫn hiện ở
 * mọi ngữ cảnh (để thấy mà phân loại) — RPC sẽ chặn nếu chọn ghi.
 */
export async function listUninvoicedLines(lineId?: string | null): Promise<QueryResult<AnyRow[]>> {
  const supabase = await client();
  if (!supabase) return empty<AnyRow[]>([]);
  const { data: docs } = await supabase
    .from("sales_documents")
    .select("id, doc_code, doc_kind, partner_id")
    .eq("status", "CONFIRMED");
  const docMap = new Map((docs ?? []).map((d: AnyRow) => [d.id, d]));
  if (!docMap.size) return { configured: true, data: [] };
  const { data: lines } = await supabase
    .from("sales_document_lines")
    .select("*, products(name, sku, business_line_id)")
    .in("document_id", Array.from(docMap.keys()));
  const { data: activeVat } = await supabase
    .from("vat_invoice_lines")
    .select("sales_document_line_id")
    .eq("is_active", true);
  const invoiced = new Set((activeVat ?? []).map((r: AnyRow) => r.sales_document_line_id));
  const data: AnyRow[] = (lines ?? [])
    .filter((l: AnyRow) => !invoiced.has(l.id))
    .filter((l: AnyRow) => {
      if (lineId === undefined || lineId === null) return true;
      const pl = (l.products as AnyRow | null)?.business_line_id as string | null | undefined;
      return pl === null || pl === undefined || pl === lineId;
    })
    .map((l: AnyRow) => ({ ...l, document: docMap.get(l.document_id) }));
  return { configured: true, data };
}

/** Chế độ hoá đơn GTGT mặc định (Cài đặt): "COMBINED" | "SEPARATE". */
export async function getVatInvoiceMode(): Promise<string> {
  const supabase = await client();
  if (!supabase) return "COMBINED";
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "vat_invoice_mode")
    .maybeSingle();
  return data?.value ? String(data.value) : "COMBINED";
}

// Giá vốn từng chứng từ bán hàng đã xác nhận, tính từ lô thực tế của mỗi
// dòng (luồng đối tác thì lô nằm ở dòng phân bổ gốc) — cùng cách tính với
// phân tích đơn hàng trên dashboard. Chứng từ nháp không có kết quả vì
// hàng chưa xuất kho. Chỉ gọi khi người xem được phép coi giá vốn.
export async function getSalesDocumentCosts(
  docIds: string[]
): Promise<Map<string, { qty: number; total: number; cost: number }>> {
  const empty = new Map<string, { qty: number; total: number; cost: number }>();
  const supabase = await client();
  if (!supabase || docIds.length === 0) return empty;
  const { data: docs } = await supabase
    .from("sales_documents")
    .select("id, status")
    .in("id", docIds);
  const confirmed = new Set(
    ((docs ?? []) as AnyRow[]).filter((d) => d.status === "CONFIRMED").map((d) => String(d.id))
  );
  if (confirmed.size === 0) return empty;
  // P6 — không .limit(20000) cố định trên sales_document_lines: kéo
  // toàn bộ dòng theo từng chunk chứng từ (tối đa 200 id/chunk) +
  // phân trang range, thứ tự ổn định. Lỗi DB ném ra (số tiền sai còn
  // tệ hơn trang lỗi — quy ước P5/E8).
  const allLines: AnyRow[] = [];
  for (const chunk of chunkIds(Array.from(confirmed))) {
    const rows = await fetchAllPages(async (from, to) => {
      const { data, error } = await supabase
        .from("sales_document_lines")
        .select("document_id, qty, line_total, batch_id, allocation_line_id")
        .in("document_id", chunk)
        .order("document_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    });
    allLines.push(...rows);
  }
  const lines = allLines;
  const allocIds = Array.from(new Set(lines.map((l) => l.allocation_line_id).filter(Boolean)));
  const allocBatch = new Map<string, string>();
  if (allocIds.length) {
    // P6 — chunk .in() tối đa 200 id (không .limit(): PostgREST mặc
    // định chỉ trả tối đa 1000 dòng, chunk 200 id -> tối đa 200 dòng).
    for (const chunk of chunkIds(allocIds)) {
      const { data: allocs } = await supabase
        .from("allocation_lines")
        .select("id, batch_id")
        .in("id", chunk);
      for (const a of ((allocs ?? []) as AnyRow[])) {
        allocBatch.set(String(a.id), String(a.batch_id));
      }
    }
  }
  const batchIds = Array.from(
    new Set(
      lines
        .map((l) => (l.batch_id ? String(l.batch_id) : allocBatch.get(String(l.allocation_line_id))))
        .filter((v): v is string => Boolean(v))
    )
  );
  const batchCost = new Map<string, number>();
  if (batchIds.length) {
    for (const chunk of chunkIds(batchIds)) {
      const { data: batches } = await supabase
        .from("stock_batches")
        .select("id, unit_cost")
        .in("id", chunk);
      for (const b of ((batches ?? []) as AnyRow[])) {
        batchCost.set(String(b.id), Number(b.unit_cost ?? 0));
      }
    }
  }
  const map = new Map<string, { qty: number; total: number; cost: number }>();
  for (const l of allLines) {
    const batchId = l.batch_id ? String(l.batch_id) : allocBatch.get(String(l.allocation_line_id));
    const cost = batchId ? batchCost.get(batchId) ?? 0 : 0;
    const entry = map.get(l.document_id) ?? { qty: 0, total: 0, cost: 0 };
    entry.qty += Number(l.qty ?? 0);
    entry.total += Number(l.line_total ?? 0);
    entry.cost += Number(l.qty ?? 0) * cost;
    map.set(l.document_id, entry);
  }
  return map;
}

/**
 * P2 — dashboard theo ngành: lineId === undefined -> toàn doanh nghiệp
 * (ngữ cảnh ALL); lineId = uuid -> chỉ ngành đó. Tồn kho theo lô đã
 * lọc qua view (v_batch_stock / v_batches_for_sales); doanh thu +
 * "đã gửi ký gửi" lọc theo business_line_id của chứng từ/phiếu.
 * Phải thu/phải trả + đối soát ký gửi vẫn hợp nhất — quy chiếu tài
 * chính theo ngành là việc của P4 (ghi rõ trong báo cáo P2).
 */
/**
 * P5 (E8) — VIẾT LẠI: các số tiền tổng lấy từ view tổng hợp của
 * migration 0030 (không giới hạn số dòng), các phần tử theo dòng
 * (vòng donut, cơ cấu, top sản phẩm, doanh thu 14 ngày, phân tích
 * đơn, tồn thấp, sắp hết hạn, giữ cho chứng từ nháp) lấy bằng
 * fetchAllPages (phân trang range, thứ tự ổn định, throw khi lỗi)
 * và chunk danh sách IN tối đa 200 id. HÌNH DẠNG OBJECT TRẢ VỀ GIỮ
 * NGUYÊN — các trang đang dùng không được vỡ.
 *
 * Số tiền tổng theo view (định nghĩa chuẩn duy nhất §17.6):
 *  - Doanh thu / giá vốn / lãi / số đơn: v_sales_by_line (doanh thu
 *    thuần = SUM(line_total) − giảm giá đầu chứng từ, chặn dưới 0;
 *    giá vốn theo lô thực tế đã xuất).
 *  - Dư nợ phải thu / phải trả + chưa đến hạn / quá hạn + chưa trả /
 *    một phần: v_debt_by_line. (P4 dời từ dashboard sang P5 — trước
 *    đây getDashboard cộng tay từ partner_receivables /
 *    supplier_payables KHÔNG lọc theo ngành.)
 *  - Giá trị tồn kho theo giá vốn: v_inventory_value_by_line.
 *  - Luồng đã bán / đã gửi / đã tiêu thụ / còn giữ:
 *    v_sales_by_line (sold_qty/sold_revenue) +
 *    v_consignment_flow_by_line (phiếu GK đã xác nhận) +
 *    v_partner_consignment_by_line (đã tiêu thụ / còn giữ).
 *
 * LƯU Ý NGÀNH (khác hành vi cũ, ghi rõ để khỏi tưởng là regression):
 *  - lineId = uuid: mọi số trên CHỈ tính ngành đó; chứng từ / khoản
 *    nợ / lô chưa phân loại (NULL) KHÔNG nằm trong số của ngành.
 *  - lineId = undefined (ALL): cộng MỌI hàng của view, GỒM hàng NULL
 *    — tổng đúng số toàn doanh nghiệp (BL-020).
 *  - lineId = null: giữ hành vi cũ (không lọc = ALL); trang dashboard
 *    dừng sớm ở chế độ NONE nên null không tới được đây.
 *  - Tồn kho theo dòng (v_batch_stock / v_batches_for_sales) nay lọc
 *    bằng .eq("business_line_id") ở DB — trước đây getDashboard KHÔNG
 *    lọc tồn kho theo ngành đang chọn (chỉ RLS theo ngành được gán),
 *    nên OWNER xem một ngành vẫn thấy tồn kho toàn doanh nghiệp.
 *  - Hàng chưa phân loại ở cảnh báo "tồn thấp" vẫn hiện như quy tắc
 *    P2 (không mất cảnh báo), vì lowStock là danh sách cảnh báo chứ
 *    không phải số tiền.
 */
/**
 * P5 (E8) — VIẾT LẠI: các số tiền tổng lấy từ view tổng hợp của
 * migration 0030 (không giới hạn số dòng), các phần tử theo dòng
 * (vòng donut, cơ cấu, top sản phẩm, doanh thu 14 ngày, phân tích
 * đơn, tồn thấp, sắp hết hạn, giữ cho chứng từ nháp) lấy bằng
 * fetchAllPages (phân trang range, thứ tự ổn định, throw khi lỗi)
 * và chunk danh sách IN tối đa 200 id. HÌNH DẠNG OBJECT TRẢ VỀ GIỮ
 * NGUYÊN — các trang đang dùng không được vỡ.
 *
 * Số tiền tổng theo view (định nghĩa chuẩn duy nhất §17.6):
 *  - Doanh thu / giá vốn / lãi / số đơn: v_sales_by_line (doanh thu
 *    thuần = SUM(line_total) − giảm giá đầu chứng từ, chặn dưới 0;
 *    giá vốn theo lô thực tế đã xuất).
 *  - Dư nợ phải thu / phải trả + chưa đến hạn / quá hạn + chưa trả /
 *    một phần: v_debt_by_line. (P4 dời từ dashboard sang P5 — trước
 *    đây getDashboard cộng tay từ partner_receivables /
 *    supplier_payables KHÔNG lọc theo ngành.)
 *  - Giá trị tồn kho theo giá vốn: v_inventory_value_by_line.
 *  - Luồng đã bán / đã gửi / đã tiêu thụ / còn giữ:
 *    v_sales_by_line (sold_qty/sold_revenue) +
 *    v_consignment_flow_by_line (phiếu GK đã xác nhận) +
 *    v_partner_consignment_by_line (đã tiêu thụ / còn giữ).
 *
 * LƯU Ý NGÀNH (khác hành vi cũ, ghi rõ để khỏi tưởng là regression):
 *  - lineId = uuid: mọi số trên CHỈ tính ngành đó; chứng từ / khoản
 *    nợ / lô chưa phân loại (NULL) KHÔNG nằm trong số của ngành.
 *  - lineId = undefined (ALL): cộng MỌI hàng của view, GỒM hàng NULL
 *    — tổng đúng số toàn doanh nghiệp (BL-020).
 *  - lineId = null: giữ hành vi cũ (không lọc = ALL); trang dashboard
 *    dừng sớm ở chế độ NONE nên null không tới được đây.
 *  - Tồn kho theo dòng (v_batch_stock / v_batches_for_sales) nay lọc
 *    bằng .eq("business_line_id") ở DB — trước đây getDashboard KHÔNG
 *    lọc tồn kho theo ngành đang chọn (chỉ RLS theo ngành được gán),
 *    nên OWNER xem một ngành vẫn thấy tồn kho toàn doanh nghiệp.
 *  - Hàng chưa phân loại ở cảnh báo "tồn thấp" vẫn hiện như quy tắc
 *    P2 (không mất cảnh báo), vì lowStock là danh sách cảnh báo chứ
 *    không phải số tiền.
 */
export async function getDashboard(lineId?: string | null) {
  const supabase = await client();
  if (!supabase) {
    return {
      configured: false,
      ownedQty: 0, ownedValue: 0, consignedQty: 0, consignedValue: 0,
      atPartnersQty: 0, atPartnersValue: 0, payablesOutstanding: 0, receivablesOutstanding: 0,
      flows: { soldQty: 0, soldRevenue: 0, sentQty: 0, sentValue: 0, consumedQty: 0, stillQty: 0, stillValue: 0 },
      revenueAll: 0, grossProfitAll: 0, orderCountAll: 0,
      revenue30: 0, grossProfit30: 0, orderCount30: 0, orderAnalysis: [] as AnyRow[],
      bookOwnedOwnValue: 0, bookAtPartnersOwnedValue: 0, bookInventoryValue: 0,
      bookConsignedCustodyValue: 0, warehouseTierValues: { cost: 0, wholesale: 0, retail: 0 },
      ownedLotCount: 0, consignedLotCount: 0, atPartnersLotCount: 0,
      overduePayables: 0, overdueReceivables: 0,
      lowStock: [] as AnyRow[], expiring: [] as AnyRow[], discrepancies: [] as AnyRow[],
      revenue14: [] as { label: string; value: number }[],
      topProducts: [] as AnyRow[],
      stockComposition: {
        ownedOwn: { qty: 0, real: 0, cost: 0, wholesale: 0, retail: 0 },
        ownedAtPartners: { qty: 0, real: 0, cost: 0, wholesale: 0, retail: 0 },
        consignedAll: { qty: 0, real: 0, cost: 0, wholesale: 0, retail: 0 },
      },
      rings: { ownership: [], location: [], status: [] },
      balances: { payablesUnpaid: 0, payablesPartial: 0, receivablesUnpaid: 0, receivablesPartial: 0 },
    };
  }
  const line = lineId ?? undefined;
  const { data: me } = await getCurrentProfile();
  const isSales = me?.role === "SALES";
  const dayMs = 864e5;
  const isoDay = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * dayMs).toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

  // ---- 1. Số tiền tổng từ view 0030 (không giới hạn dòng) ----
  const [salesByLine, debtByLine, invByLine, flowByLine, consByLine] = await Promise.all([
    (async () => {
      let q = supabase.from("v_sales_by_line").select("*");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AnyRow[];
    })(),
    (async () => {
      let q = supabase.from("v_debt_by_line").select("*");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AnyRow[];
    })(),
    (async () => {
      let q = supabase.from("v_inventory_value_by_line").select("*");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AnyRow[];
    })(),
    (async () => {
      let q = supabase.from("v_consignment_flow_by_line").select("*");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AnyRow[];
    })(),
    fetchAllPages(async (from, to) => {
      let q = supabase
        .from("v_partner_consignment_by_line")
        .select("partner_id, qty_sent, qty_consumed, qty_returned, qty_still_at_partner");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q
        .order("partner_id", { ascending: true })
        .order("business_line_id", { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
  ]);
  const sumField = (rows: AnyRow[], field: string) =>
    rows.reduce((a, r) => a + Number(r[field] ?? 0), 0);
  // Doanh thu / lợi nhuận gộp / số đơn — mọi chứng từ đã xác nhận (view
  // đã gộp; ngày chứng từ có thể ghi lùi so với ngày nhập máy).
  const revenueAll = sumField(salesByLine, "revenue");
  const cogsAll = sumField(salesByLine, "cogs");
  const orderCountAll = sumField(salesByLine, "orders");
  const revenue30 = sumField(salesByLine, "revenue_30d");
  const cogs30 = sumField(salesByLine, "cogs_30d");
  const orderCount30 = sumField(salesByLine, "orders_30d");
  const soldQty = sumField(salesByLine, "sold_qty");
  const soldRevenue = sumField(salesByLine, "sold_revenue");
  // Dư nợ theo ngành (P4 dời sang P5 — trước đây cộng tay không lọc ngành).
  const recvRows = debtByLine.filter((r) => r.kind === "RECEIVABLE");
  const payRows = debtByLine.filter((r) => r.kind === "PAYABLE");
  const receivablesOutstanding = sumField(recvRows, "outstanding");
  const payablesOutstanding = sumField(payRows, "outstanding");
  const overdueReceivables = sumField(recvRows, "overdue");
  const overduePayables = sumField(payRows, "overdue");
  const balances = {
    payablesUnpaid: sumField(payRows, "unpaid"),
    payablesPartial: sumField(payRows, "partial"),
    receivablesUnpaid: sumField(recvRows, "unpaid"),
    receivablesPartial: sumField(recvRows, "partial"),
  };
  // Sổ kế toán: tồn kho ghi theo GIÁ VỐN, không theo giá bán. Hàng được
  // ký gửi không phải tài sản — chỉ theo dõi riêng, không gộp vào tồn
  // kho thuộc sở hữu.
  const bookOwnedOwnValue = sumField(invByLine, "owned_cost_own_wh");
  const bookAtPartnersOwnedValue = sumField(invByLine, "owned_cost_partners");
  const bookInventoryValue = sumField(invByLine, "owned_cost_total");
  const bookConsignedCustodyValue = sumField(invByLine, "consigned_cost");
  // Luồng hàng đã bán / đã gửi ký gửi (chỉ chứng từ/phiếu đã xác nhận).
  const sentQty = sumField(flowByLine, "sent_qty");
  const sentValue = sumField(flowByLine, "sent_value");
  const consumedQty = sumField(consByLine, "qty_consumed");
  const stillQty = sumField(consByLine, "qty_still_at_partner");

  // ---- 2. Dữ liệu theo dòng qua fetchAllPages (không .limit() cố định) ----
  const [
    batchRows,
    productRows,
    partnerRows,
    productStockRows,
    confirmedSlips,
    draftSaleDocs,
    draftGkSlips,
    draftAllocSlips,
    dailyRows,
    topProductRows,
    orderRows,
  ] = await Promise.all([
    fetchAllPages(async (from, to) => {
      let q = supabase
        .from(isSales ? "v_batches_for_sales" : "v_batch_stock")
        .select("*");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q
        .order("batch_id", { ascending: true })
        .order("location_id", { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await supabase
        .from("products")
        .select("id, min_stock, retail_price, wholesale_price, business_line_id")
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await supabase
        .from("partners")
        .select("id, name")
        .order("id", { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await supabase
        .from("v_product_stock")
        .select("*")
        .order("product_id", { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
    fetchAllPages(async (from, to) => {
      let q = supabase
        .from("consignment_out_slips")
        .select("id, created_at, business_line_id")
        .eq("status", "CONFIRMED");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
    fetchAllPages(async (from, to) => {
      let q = supabase
        .from("sales_documents")
        .select("id")
        .eq("status", "DRAFT");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q.order("id", { ascending: true }).range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
    fetchAllPages(async (from, to) => {
      let q = supabase
        .from("consignment_out_slips")
        .select("id")
        .eq("status", "DRAFT");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q.order("id", { ascending: true }).range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
    fetchAllPages(async (from, to) => {
      let q = supabase
        .from("allocation_slips")
        .select("id")
        .eq("status", "DRAFT");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q.order("id", { ascending: true }).range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
    // Doanh thu 14 ngày cho biểu đồ tầng 3 (view đã gộp theo ngày × ngành).
    fetchAllPages(async (from, to) => {
      let q = supabase
        .from("v_daily_revenue_by_line")
        .select("doc_date, business_line_id, revenue, cogs")
        .gte("doc_date", isoDay(13));
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q
        .order("doc_date", { ascending: true })
        .order("business_line_id", { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as AnyRow[], error };
    }),
    // Top 5 bán chạy 30 ngày (view đã gộp theo sản phẩm).
    (async () => {
      let q = supabase
        .from("v_product_sales_30d")
        .select("product_id, sku, product_name, qty_30d");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q
        .order("qty_30d", { ascending: false })
        .order("product_id", { ascending: true })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as AnyRow[];
    })(),
    // Phân tích đơn hàng: 10 chứng từ mới nhất (doanh thu thuần + giá vốn).
    (async () => {
      let q = supabase
        .from("v_sales_doc_totals")
        .select("doc_code, doc_date, customer_name, revenue_net, cogs");
      if (line) q = q.eq("business_line_id", line);
      const { data, error } = await q
        .order("doc_date", { ascending: false })
        .order("doc_code", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as AnyRow[];
    })(),
  ]);

  const dailyRevenue = new Map<string, number>();
  for (const r of dailyRows) {
    const date = String(r.doc_date).slice(0, 10);
    dailyRevenue.set(date, (dailyRevenue.get(date) ?? 0) + Number(r.revenue ?? 0));
  }
  const revenue14 = Array.from({ length: 14 }, (_, i) => {
    const iso = isoDay(13 - i);
    return { label: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, value: dailyRevenue.get(iso) ?? 0 };
  });
  const topProducts: AnyRow[] = topProductRows.map((p) => ({
    id: String(p.product_id),
    sku: String(p.sku),
    name: String(p.product_name),
    qty_sold: Number(p.qty_30d ?? 0),
  }));
  const orderAnalysis = orderRows.map((d) => {
    const net = Number(d.revenue_net ?? 0);
    const cost = Number(d.cogs ?? 0);
    return {
      code: String(d.doc_code),
      date: String(d.doc_date).slice(0, 10),
      customer: String(d.customer_name ?? "—"),
      revenue: net,
      cogs: cost,
      profit: net - cost,
    };
  });

  const minMap = new Map(productRows.map((p) => [p.id, Number(p.min_stock ?? 0)]));
  // Giá bán của sản phẩm: giá lẻ trước, không có thì giá đại lý, không có
  // nữa thì giá vốn. Dùng để tính "giá trị thật" của hàng tồn cho CEO.
  const sellPrice = new Map(
    productRows.map((p) => [
      p.id,
      Number(p.retail_price ?? 0) > 0 ? Number(p.retail_price) : Number(p.wholesale_price ?? 0),
    ])
  );
  // Giá đại lý của sản phẩm, dùng cho dòng so sánh 3 mức giá của hàng trong kho.
  const wholesalePrice = new Map(
    productRows.map((p) => [p.id, Number(p.wholesale_price ?? 0)])
  );
  // Giá chuyển giao mới nhất của từng lô đã gửi ký gửi (phiếu đã xác nhận):
  // hàng ở kho đối tác tính theo giá này, vì đó là giá đối tác sẽ trả khi
  // tiêu thụ — không phải giá vốn, không phải giá lẻ hiện tại.
  const slipCreated = new Map(
    confirmedSlips.map((s) => [String(s.id), String(s.created_at)])
  );
  const latestTransfer = new Map<string, number>();
  if (confirmedSlips.length) {
    const slipIds = confirmedSlips.map((s) => String(s.id));
    const gkItems: AnyRow[] = [];
    for (const chunk of chunkIds(slipIds)) {
      const { data, error } = await supabase
        .from("consignment_out_items")
        .select("slip_id, batch_id, transfer_price")
        .in("slip_id", chunk);
      if (error) throw error;
      gkItems.push(...((data ?? []) as AnyRow[]));
    }
    const sorted = gkItems.sort((a, b) =>
      String(slipCreated.get(String(b.slip_id)) ?? "").localeCompare(
        String(slipCreated.get(String(a.slip_id)) ?? "")
      )
    );
    for (const it of sorted) {
      const key = String(it.batch_id);
      if (!latestTransfer.has(key)) latestTransfer.set(key, Number(it.transfer_price ?? 0));
    }
  }
  const rows = batchRows;
  const sum = (filter: (r: AnyRow) => boolean, field: (r: AnyRow) => number) =>
    rows.filter(filter).reduce((acc, r) => acc + field(r), 0);
  const owned = (r: AnyRow) => r.ownership === "OWNED";
  const consigned = (r: AnyRow) => r.ownership === "CONSIGNED";
  const realValueOf = (r: AnyRow) => {
    const qty = Number(r.qty);
    if (r.location_kind === "PARTNER_VIRTUAL") {
      const tp = latestTransfer.get(String(r.batch_id));
      if (tp !== undefined) return qty * tp;
    }
    const sp = sellPrice.get(r.product_id) ?? 0;
    return qty * (sp > 0 ? sp : Number(r.unit_cost ?? 0));
  };
  // Giá trị một dòng tồn theo từng cơ sở định giá. Hàng ở kho đối tác tính
  // theo giá chuyển giao mới nhất, trừ cơ sở giá vốn thì tính theo giá vốn
  // lô — vì hàng đó không có giá sỉ/giá lẻ.
  const transferValueOf = (r: AnyRow) => {
    const tp = latestTransfer.get(String(r.batch_id));
    return tp !== undefined ? Number(r.qty) * tp : null;
  };
  const costValueOf = (r: AnyRow) => Number(r.qty) * Number(r.unit_cost ?? 0);
  const wholesaleValueOf = (r: AnyRow) => {
    if (r.location_kind === "PARTNER_VIRTUAL") {
      const tv = transferValueOf(r);
      if (tv !== null) return tv;
    }
    const wp = wholesalePrice.get(r.product_id) ?? 0;
    return Number(r.qty) * (wp > 0 ? wp : Number(r.unit_cost ?? 0));
  };
  const retailValueOf = (r: AnyRow) => {
    if (r.location_kind === "PARTNER_VIRTUAL") {
      const tv = transferValueOf(r);
      if (tv !== null) return tv;
    }
    const rp = sellPrice.get(r.product_id) ?? 0; // lẻ trước, sỉ sau
    return Number(r.qty) * (rp > 0 ? rp : Number(r.unit_cost ?? 0));
  };
  const compOf = (filter: (r: AnyRow) => boolean) => {
    const rs = rows.filter(filter);
    return {
      qty: rs.reduce((a, r) => a + Number(r.qty), 0),
      real: rs.reduce((a, r) => a + realValueOf(r), 0),
      cost: rs.reduce((a, r) => a + costValueOf(r), 0),
      wholesale: rs.reduce((a, r) => a + wholesaleValueOf(r), 0),
      retail: rs.reduce((a, r) => a + retailValueOf(r), 0),
    };
  };
  // Ba nhóm không trùng nhau, phủ hết hàng đang quản lý: hàng TVK tại kho,
  // hàng TVK tại đối tác, và hàng nhận ký gửi (mọi vị trí, của nhà cung cấp).
  const ownedOwn = compOf((r) => owned(r) && r.location_kind === "OWN_WAREHOUSE");
  const ownedAtPartners = compOf((r) => owned(r) && r.location_kind === "PARTNER_VIRTUAL");
  const consignedAll = compOf(consigned);
  // Hàng trong kho TVK theo 3 mức giá (chỉ lô thuộc sở hữu, chỉ kho TVK):
  // vốn = giá vốn lô (lấy từ view để khớp sổ kế toán); sỉ = giá đại lý
  // (chưa có thì giá vốn); lẻ = giá bán (giá lẻ trước, không có thì giá
  // đại lý, không có nữa thì giá vốn).
  const warehouseTierValues = {
    cost: bookOwnedOwnValue,
    wholesale: sum(
      (r) => owned(r) && r.location_kind === "OWN_WAREHOUSE",
      (r) => {
        const wp = wholesalePrice.get(r.product_id) ?? 0;
        return Number(r.qty) * (wp > 0 ? wp : Number(r.unit_cost ?? 0));
      }
    ),
    retail: ownedOwn.real,
  };
  // Ba vòng đồng tâm của biểu đồ cơ cấu tồn kho: sở hữu × vị trí × trạng
  // thái. Ba vòng độc lập, cùng phạm vi (toàn bộ hàng đang quản lý) và cùng
  // chuẩn định giá (giá vốn lô) để tỷ lệ so sánh được với nhau. Vòng trạng
  // thái: "giữ cho chứng từ nháp" = số lượng các dòng chứng từ NHÁP (bán
  // hàng, gửi ký gửi, phân bổ) đang trỏ vào lô, chặn trên bằng tồn thực tế
  // của lô; phần còn lại là "bán được". Phiếu trả nháp và phiếu nhập nháp
  // không giữ hàng (trả nháp chưa trừ kho, nhập nháp chưa tạo lô) nên không
  // tính. Bán hàng không đọc được phiếu GK nên phần giữ cho GK nháp sẽ
  // thiếu ở góc Bán hàng; góc đó vẫn đủ số của phiếu bán và phân bổ nháp.
  const segOf = (
    key: string,
    label: string,
    color: string,
    rs: AnyRow[],
    href: string | null
  ): RingSegment => {
    const lots = new Set<string>();
    const skus = new Set<string>();
    let qty = 0;
    let value = 0;
    for (const r of rs) {
      const q = Number(r.qty);
      if (q <= 0) continue;
      qty += q;
      value += q * Number(r.unit_cost ?? 0);
      lots.add(String(r.batch_id));
      skus.add(String(r.product_id));
    }
    return { key, label, color, qty, value, lots: lots.size, skus: skus.size, href };
  };
  const heldByBatch = new Map<string, number>();
  const addHeld = (batchId: unknown, q: unknown) => {
    const id = String(batchId ?? "");
    if (!id) return;
    heldByBatch.set(id, (heldByBatch.get(id) ?? 0) + Math.max(Number(q ?? 0), 0));
  };
  const saleIds = draftSaleDocs.map((d) => String(d.id));
  const gkIds = draftGkSlips.map((d) => String(d.id));
  const draftAllocIds = draftAllocSlips.map((d) => String(d.id));
  const fetchDraftLines = async (
    table: string,
    column: string,
    ids: string[],
  ): Promise<AnyRow[]> => {
    const out: AnyRow[] = [];
    for (const chunk of chunkIds(ids)) {
      const { data, error } = await supabase
        .from(table)
        .select("batch_id, qty")
        .in(column, chunk);
      if (error) throw error;
      out.push(...((data ?? []) as AnyRow[]));
    }
    return out;
  };
  const [saleLines, gkItems, allocLines] = await Promise.all([
    saleIds.length ? fetchDraftLines("sales_document_lines", "document_id", saleIds) : [],
    gkIds.length ? fetchDraftLines("consignment_out_items", "slip_id", gkIds) : [],
    draftAllocIds.length ? fetchDraftLines("allocation_lines", "allocation_id", draftAllocIds) : [],
  ]);
  for (const l of saleLines) addHeld(l.batch_id, l.qty);
  for (const l of gkItems) addHeld(l.batch_id, l.qty);
  for (const l of allocLines) addHeld(l.batch_id, l.qty);
  let heldQty = 0;
  let heldValue = 0;
  let sellQty = 0;
  let sellValue = 0;
  const heldLots = new Set<string>();
  const heldSkus = new Set<string>();
  const sellLots = new Set<string>();
  const sellSkus = new Set<string>();
  const batchOnHand = new Map<string, { product_id: string; unit_cost: number; onHand: number }>();
  for (const r of rows) {
    const id = String(r.batch_id);
    const a = batchOnHand.get(id) ?? { product_id: String(r.product_id), unit_cost: Number(r.unit_cost ?? 0), onHand: 0 };
    a.onHand += Number(r.qty);
    batchOnHand.set(id, a);
  }
  for (const [id, a] of Array.from(batchOnHand.entries())) {
    const h = Math.min(heldByBatch.get(id) ?? 0, Math.max(a.onHand, 0));
    const s = Math.max(a.onHand, 0) - h;
    if (h > 0) {
      heldQty += h;
      heldValue += h * a.unit_cost;
      heldLots.add(id);
      heldSkus.add(a.product_id);
    }
    if (s > 0) {
      sellQty += s;
      sellValue += s * a.unit_cost;
      sellLots.add(id);
      sellSkus.add(a.product_id);
    }
  }
  const rings: StockRings = {
    ownership: [
      segOf("owned", "Hàng hoá của TVK", "#f43f5e", rows.filter(owned), "/inventory?ownership=OWNED"),
      segOf("consigned", "Hàng được ký gửi", "#d97706", rows.filter(consigned), "/inventory?ownership=CONSIGNED"),
    ],
    location: [
      segOf("own", "Hàng tại kho TVK", "#059669", rows.filter((r) => r.location_kind === "OWN_WAREHOUSE"), "/inventory?location_kind=OWN_WAREHOUSE"),
      segOf("partner", "Hàng tại kho đối tác", "#7c3aed", rows.filter((r) => r.location_kind === "PARTNER_VIRTUAL"), "/inventory?location_kind=PARTNER_VIRTUAL"),
    ],
    status: [
      { key: "sellable", label: "Bán được", color: "#64748b", qty: sellQty, value: sellValue, lots: sellLots.size, skus: sellSkus.size, href: null },
      { key: "held", label: "Giữ cho chứng từ nháp", color: "#dc2626", qty: heldQty, value: heldValue, lots: heldLots.size, skus: heldSkus.size, href: null },
    ],
  };
  // Số lô đang có hàng theo từng nhóm (một lô có thể nằm ở 2 vị trí thì
  // tính vào cả hai nhóm vị trí; lô hết hàng không tính).
  const lotCountOf = (filter: (r: AnyRow) => boolean) =>
    new Set(
      rows.filter((r) => filter(r) && Number(r.qty) > 0).map((r) => String(r.batch_id))
    ).size;
  const ownedLotCount = lotCountOf((r) => owned(r) && r.location_kind === "OWN_WAREHOUSE");
  const consignedLotCount = lotCountOf(consigned);
  const atPartnersLotCount = lotCountOf((r) => owned(r) && r.location_kind === "PARTNER_VIRTUAL");
  // Đối chiếu gửi đối tác bị lệch: gộp các hàng theo ngành về từng đối tác
  // rồi so đã gửi với đã bán + đã trả + còn giữ (như view cũ, nay qua
  // v_partner_consignment_by_line).
  const partnerName = new Map(partnerRows.map((p) => [String(p.id), String(p.name)]));
  const consByPartner = new Map<
    string,
    { partner_id: string; partner_name: string; qty_sent: number; qty_consumed: number; qty_returned: number; qty_still_at_partner: number }
  >();
  for (const r of consByLine) {
    const pid = String(r.partner_id);
    const cur = consByPartner.get(pid) ?? {
      partner_id: pid,
      partner_name: partnerName.get(pid) ?? "—",
      qty_sent: 0,
      qty_consumed: 0,
      qty_returned: 0,
      qty_still_at_partner: 0,
    };
    cur.qty_sent += Number(r.qty_sent ?? 0);
    cur.qty_consumed += Number(r.qty_consumed ?? 0);
    cur.qty_returned += Number(r.qty_returned ?? 0);
    cur.qty_still_at_partner += Number(r.qty_still_at_partner ?? 0);
    consByPartner.set(pid, cur);
  }
  const discrepancies = Array.from(consByPartner.values()).filter(
    (r) => r.qty_sent !== r.qty_consumed + r.qty_returned + r.qty_still_at_partner,
  );
  return {
    configured: true,
    // Ô "Tồn kho" chỉ tính hàng đang nằm trong kho của mình — hàng đã
    // gửi tới đối tác nằm ở ô riêng, không gộp chung (trước đây gộp
    // chung nên nhìn lệch với biểu đồ cơ cấu).
    ownedQty: ownedOwn.qty,
    ownedValue: ownedOwn.real,
    consignedQty: consignedAll.qty,
    consignedValue: consignedAll.real,
    atPartnersQty: ownedAtPartners.qty,
    atPartnersValue: ownedAtPartners.real,
    flows: { soldQty, soldRevenue, sentQty, sentValue, consumedQty, stillQty, stillValue: ownedAtPartners.real },
    payablesOutstanding,
    receivablesOutstanding,
    revenueAll,
    grossProfitAll: revenueAll - cogsAll,
    orderCountAll,
    revenue30,
    grossProfit30: revenue30 - cogs30,
    orderCount30,
    orderAnalysis,
    bookOwnedOwnValue,
    bookAtPartnersOwnedValue,
    bookInventoryValue,
    bookConsignedCustodyValue,
    ownedLotCount,
    consignedLotCount,
    atPartnersLotCount,
    warehouseTierValues,
    overduePayables,
    overdueReceivables,
    revenue14,
    topProducts,
    stockComposition: {
      ownedOwn,
      ownedAtPartners,
      consignedAll,
    },
    rings,
    balances,
    // P2: cảnh báo sắp hết hàng chỉ tính sản phẩm thuộc ngành đang xem;
    // sản phẩm chưa phân loại (ngành NULL) vẫn hiện để không mất cảnh báo.
    lowStock: productStockRows.filter(
      (r) =>
        Number(r.total_qty) <= (minMap.get(r.product_id) ?? 0) &&
        (!line || productRows.some((p: AnyRow) => p.id === r.product_id && (!p.business_line_id || p.business_line_id === line))),
    ),
    expiring: rows.filter(
      (r) => r.ownership === "CONSIGNED" && r.return_by_date && r.return_by_date <= soon && r.location_kind === "OWN_WAREHOUSE"
    ),
    discrepancies,
  };
}

// ---------------------------------------------------------------------
// P5 — Đọc từ view tổng hợp theo ngành (migration 0030). Các view đều
// security_invoker = true nên RLS trên bảng gốc vẫn áp dụng; vai trò
// không được đọc giá vốn thì view trả 0 dòng, không rò số.
// lineId === undefined -> không lọc (ALL, gồm cả hàng NULL chưa phân
// loại); lineId = uuid -> chỉ ngành đó; lineId === null -> rỗng
// (fail-closed, như list()).
// ---------------------------------------------------------------------

/** Một dòng doanh thu / giá vốn / lãi theo ngành (v_sales_by_line). */
export type SalesByLineRow = SalesByLineInput;

/** Doanh thu / giá vốn / lãi / đơn theo ngành (lũy kế + 30 ngày gần nhất). */
export async function getSalesByLine(lineId?: string | null): Promise<SalesByLineRow[]> {
  const supabase = await client();
  if (!supabase) return [];
  if (lineId === null) return [];
  let q = supabase.from("v_sales_by_line").select("*");
  if (lineId !== undefined) q = q.eq("business_line_id", lineId);
  const { data, error } = await q;
  if (error || !data) return [];
  const codeById = await getLineCodeById();
  return (data as AnyRow[]).map((r) => ({
    lineId: r.business_line_id ? String(r.business_line_id) : null,
    lineCode: r.business_line_id ? (codeById.get(String(r.business_line_id)) ?? null) : null,
    orders: Number(r.orders ?? 0),
    qty: Number(r.qty ?? 0),
    revenue: Number(r.revenue ?? 0),
    cogs: Number(r.cogs ?? 0),
    profit: Number(r.profit ?? 0),
    soldQty: Number(r.sold_qty ?? 0),
    soldRevenue: Number(r.sold_revenue ?? 0),
    revenue30d: Number(r.revenue_30d ?? 0),
    cogs30d: Number(r.cogs_30d ?? 0),
    profit30d: Number(r.profit_30d ?? 0),
    orders30d: Number(r.orders_30d ?? 0),
  }));
}

/** Một dòng dư nợ theo ngành (v_debt_by_line). */
export type DebtByLineRow = DebtByLineInput;

/** Dư nợ phải thu / phải trả theo ngành (kèm quá hạn, chưa trả / một phần). */
export async function getDebtByLine(lineId?: string | null): Promise<DebtByLineRow[]> {
  const supabase = await client();
  if (!supabase) return [];
  if (lineId === null) return [];
  let q = supabase.from("v_debt_by_line").select("*");
  if (lineId !== undefined) q = q.eq("business_line_id", lineId);
  const { data, error } = await q;
  if (error || !data) return [];
  const codeById = await getLineCodeById();
  return (data as AnyRow[]).map((r) => ({
    kind: (r.kind === "PAYABLE" ? "PAYABLE" : "RECEIVABLE") as DebtKind,
    lineId: r.business_line_id ? String(r.business_line_id) : null,
    lineCode: r.business_line_id ? (codeById.get(String(r.business_line_id)) ?? null) : null,
    outstanding: Number(r.outstanding ?? 0),
    unpaid: Number(r.unpaid ?? 0),
    partial: Number(r.partial ?? 0),
    overdue: Number(r.overdue ?? 0),
    count: Number(r.cnt ?? 0),
  }));
}

/** Một dòng giá trị tồn kho theo ngành (v_inventory_value_by_line). */
export interface InventoryValueByLineRow extends InventoryByLineInput {
  ownedQtyOwnWh: number;
  ownedCostOwnWh: number;
  ownedQtyPartners: number;
  ownedCostPartners: number;
  consignedQty: number;
  ownedLots: number;
  consignedLots: number;
}

/** Giá trị tồn kho theo giá vốn lô, tách kho mình / kho đối tác / ký gửi giữ hộ. */
export async function getInventoryValueByLine(lineId?: string | null): Promise<InventoryValueByLineRow[]> {
  const supabase = await client();
  if (!supabase) return [];
  if (lineId === null) return [];
  let q = supabase.from("v_inventory_value_by_line").select("*");
  if (lineId !== undefined) q = q.eq("business_line_id", lineId);
  const { data, error } = await q;
  if (error || !data) return [];
  const codeById = await getLineCodeById();
  return (data as AnyRow[]).map((r) => ({
    lineId: r.business_line_id ? String(r.business_line_id) : null,
    lineCode: r.business_line_id ? (codeById.get(String(r.business_line_id)) ?? null) : null,
    ownedQtyOwnWh: Number(r.owned_qty_own_wh ?? 0),
    ownedCostOwnWh: Number(r.owned_cost_own_wh ?? 0),
    ownedQtyPartners: Number(r.owned_qty_partners ?? 0),
    ownedCostPartners: Number(r.owned_cost_partners ?? 0),
    ownedCostTotal: Number(r.owned_cost_total ?? 0),
    consignedQty: Number(r.consigned_qty ?? 0),
    consignedCost: Number(r.consigned_cost ?? 0),
    ownedLots: Number(r.owned_lots ?? 0),
    consignedLots: Number(r.consigned_lots ?? 0),
  }));
}

/** Một dòng luồng gửi ký gửi theo ngành (v_consignment_flow_by_line). */
export interface ConsignmentFlowByLineRow {
  lineId: string | null;
  lineCode: string | null;
  sentQty: number;
  sentValue: number;
}

/** Luồng gửi ký gửi theo ngành: đã gửi (phiếu GK đã xác nhận). */
export async function getConsignmentFlowByLine(lineId?: string | null): Promise<ConsignmentFlowByLineRow[]> {
  const supabase = await client();
  if (!supabase) return [];
  if (lineId === null) return [];
  let q = supabase.from("v_consignment_flow_by_line").select("*");
  if (lineId !== undefined) q = q.eq("business_line_id", lineId);
  const { data, error } = await q;
  if (error || !data) return [];
  const codeById = await getLineCodeById();
  return (data as AnyRow[]).map((r) => ({
    lineId: r.business_line_id ? String(r.business_line_id) : null,
    lineCode: r.business_line_id ? (codeById.get(String(r.business_line_id)) ?? null) : null,
    sentQty: Number(r.sent_qty ?? 0),
    sentValue: Number(r.sent_value ?? 0),
  }));
}

/** So sánh OIL vs AUTO_PARTS vs ALL: doanh thu / lãi / tồn kho / dư nợ. */
export async function getLineComparison(): Promise<LineComparisonRow[]> {
  const supabase = await client();
  if (!supabase) return [];
  const [sales, debts, inventory, lines] = await Promise.all([
    getSalesByLine(),
    getDebtByLine(),
    getInventoryValueByLine(),
    listBusinessLines(),
  ]);
  return buildLineComparison({ sales, debts, inventory, lines });
}
export interface PartnerDetail {
  partner: AnyRow | null;
  consignment: AnyRow | null;
  receivables: AnyRow[];
  invoices: AnyRow[];
  stats: {
    outstanding: number;
    totalPaid: number;
    invoiceCount: number;
    invoiceTotal: number;
    stillAtPartner: number;
  };
}

/** Hồ sơ + thống kê của một đối tác cho trang chi tiết: gom từ đối soát ký gửi, phải thu và hoá đơn GTGT. Chỉ hoá đơn đang hiệu lực (ISSUED) mới tính vào số lượng/giá trị. */
/** Hồ sơ + thống kê của một đối tác cho trang chi tiết: gom từ đối soát ký gửi, phải thu và hoá đơn GTGT. Chỉ hoá đơn đang hiệu lực (ISSUED) mới tính vào số lượng/giá trị. P5: lineId lọc các bảng đối soát / phải thu / hoá đơn theo ngành (đối soát đọc từ v_partner_consignment_by_line, gộp các hàng theo ngành khi xem toàn doanh nghiệp); lineId === null -> rỗng (fail-closed). */
export async function getPartnerDetail(id: string, lineId?: string | null): Promise<QueryResult<PartnerDetail>> {
  const supabase = await client();
  const blank: PartnerDetail = {
    partner: null,
    consignment: null,
    receivables: [],
    invoices: [],
    stats: { outstanding: 0, totalPaid: 0, invoiceCount: 0, invoiceTotal: 0, stillAtPartner: 0 },
  };
  if (!supabase) return empty(blank);
  if (lineId === null) return { configured: true, data: blank };
  const [partner, consignment, receivables, invoices] = await Promise.all([
    supabase.from("partners").select("*").eq("id", id).maybeSingle(),
    (async () => {
      let q = supabase.from("v_partner_consignment_by_line").select("*").eq("partner_id", id);
      if (lineId !== undefined) q = q.eq("business_line_id", lineId);
      return q;
    })(),
    (async () => {
      let q = supabase
        .from("partner_receivables")
        .select("*")
        .eq("partner_id", id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (lineId !== undefined) q = q.eq("business_line_id", lineId);
      return q;
    })(),
    (async () => {
      let q = supabase
        .from("vat_invoices")
        .select("*")
        .eq("partner_id", id)
        .order("invoice_date", { ascending: false })
        .limit(500);
      if (lineId !== undefined) q = q.eq("business_line_id", lineId);
      return q;
    })(),
  ]);
  const receivableRows = (receivables.data ?? []) as AnyRow[];
  const invoiceRows = (invoices.data ?? []) as AnyRow[];
  const issued = invoiceRows.filter((i) => i.status === "ISSUED");
  // Đối soát theo ngành: một hàng mỗi ngành — gộp lại khi xem toàn
  // doanh nghiệp để trang chi tiết vẫn có một bộ số duy nhất.
  const consRows = (consignment.data ?? []) as AnyRow[];
  const consignmentRow =
    consRows.length === 0
      ? null
      : {
          partner_id: id,
          qty_sent: consRows.reduce((a, r) => a + Number(r.qty_sent ?? 0), 0),
          qty_consumed: consRows.reduce((a, r) => a + Number(r.qty_consumed ?? 0), 0),
          qty_returned: consRows.reduce((a, r) => a + Number(r.qty_returned ?? 0), 0),
          qty_still_at_partner: consRows.reduce((a, r) => a + Number(r.qty_still_at_partner ?? 0), 0),
          receivable_outstanding: consRows.reduce((a, r) => a + Number(r.receivable_outstanding ?? 0), 0),
        };
  return {
    configured: true,
    data: {
      partner: (partner.data ?? null) as AnyRow | null,
      consignment: consignmentRow,
      receivables: receivableRows,
      invoices: invoiceRows,
      stats: {
        outstanding: receivableRows
          .filter((r) => r.status === "UNPAID" || r.status === "PARTIAL")
          .reduce((a, r) => a + Number(r.amount) - Number(r.amount_paid), 0),
        totalPaid: receivableRows.reduce((a, r) => a + Number(r.amount_paid), 0),
        invoiceCount: issued.length,
        invoiceTotal: issued.reduce((a, i) => a + Number(i.total_amount), 0),
        stillAtPartner: Number(consignmentRow?.qty_still_at_partner ?? 0),
      },
    },
  };
}

export interface LedgerRow {
  id: string;
  created_at: string;
  movement_kind: string;
  qty: number;
  from_name: string | null;
  to_name: string | null;
  ref_doc_type: string | null;
  ref_doc_id: string | null;
  doc_code: string | null;
  reversal_of_id: string | null;
  created_by_name: string | null;
  batch_code: string;
  sku: string;
  product_name: string;
}

/** 200 bút toán kho mới nhất, kèm tên lô / sản phẩm / kho / người làm (nối tay, tránh join FK mơ hồ). */
/**
 * P2 — lịch sử kho theo ngành: lineId === undefined -> toàn doanh nghiệp;
 * lineId = uuid -> chỉ bút toán của lô thuộc ngành đó (quy chiếu qua
 * lô -> sản phẩm); lineId === null (chưa gán ngành) -> rỗng.
 */
/** N bút toán kho mới nhất, kèm tên lô / sản phẩm / kho / người làm (nối tay, tránh join FK mơ hồ). */
/**
 * P5 (E8) — đọc từ v_stock_movements_with_line (0030): ngành của lô đã
 * quy chiếu sẵn ở DB (qua v_batches_for_sales), lọc bằng .eq() thay vì
 * kéo rồi lọc tay ở app; đếm tổng bằng count exact của DB để trang sổ
 * cái hiện "đang hiện X / tổng Y". Trả về { configured, data, total }.
 * lineId === undefined -> toàn doanh nghiệp (gồm cả bút toán của lô
 * không quy chiếu được ngành, business_line_id NULL); lineId = uuid ->
 * chỉ bút toán của ngành đó; lineId === null (chưa gán ngành) -> rỗng.
 * Lỗi truy vấn -> rỗng + total 0 (không ném như trước, để trang sổ cái
 * không sập khi DB chưa chạy 0030).
 */
export async function listLedgerMovements(limit = 200, lineId?: string | null): Promise<QueryResult<LedgerRow[]> & { total: number }> {
  const supabase = await client();
  if (!supabase) return { configured: false, data: [], total: 0 };
  if (lineId === null) return { configured: true, data: [], total: 0 };
  let q = supabase
    .from("v_stock_movements_with_line")
    .select("id, created_at, movement_kind, qty, from_location_id, to_location_id, ref_doc_type, ref_doc_id, reversal_of_id, created_by, batch_id", { count: "exact" });
  if (lineId !== undefined) q = q.eq("business_line_id", lineId);
  const { data: rows, count, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, limit - 1);
  if (error) return { configured: true, data: [], total: 0 };
  const list = (rows ?? []) as AnyRow[];
  const total = count ?? list.length;
  const batchIds = Array.from(new Set(list.map((r) => r.batch_id as string)));
  const batchRows = batchIds.length
    ? ((await supabase.from("v_batches_for_sales").select("batch_id, batch_code, product_id").in("batch_id", batchIds)).data ?? [])
    : [];
  const batches = (batchRows as AnyRow[]).map((b) => ({ ...b, id: b.batch_id }));
  const productIds = Array.from(new Set((batches as AnyRow[]).map((b) => b.product_id as string)));
  const products = productIds.length
    ? ((await supabase.from("products").select("id, sku, name, business_line_id").in("id", productIds)).data ?? [])
    : [];
  const locIds = Array.from(
    new Set(list.flatMap((r) => [r.from_location_id, r.to_location_id]).filter(Boolean) as string[]),
  );
  const locs = locIds.length
    ? ((await supabase.from("locations").select("id, name").in("id", locIds)).data ?? [])
    : [];
  const userIds = Array.from(new Set(list.map((r) => r.created_by as string).filter(Boolean)));
  const profs = userIds.length
    ? ((await supabase.from("profiles").select("id, full_name").in("id", userIds)).data ?? [])
    : [];
  const batchMap = new Map((batches as AnyRow[]).map((b) => [b.id as string, b]));
  const productMap = new Map((products as AnyRow[]).map((p) => [p.id as string, p]));
  const locMap = new Map((locs as AnyRow[]).map((l) => [l.id as string, l.name as string]));
  const profMap = new Map((profs as AnyRow[]).map((p) => [p.id as string, p.full_name as string]));
  // Mã chứng từ (PN/GK/BH/…) theo từng loại chứng từ nguồn — để bút toán truy vết được tới chứng từ gốc.
  const docTables: Record<string, string> = {
    PURCHASE_RECEIPT: "purchase_receipts",
    CONSIGNMENT_RECEIPT: "consignment_receipts",
    CONSIGNMENT_OUT: "consignment_out_slips",
    SALES_DOCUMENT: "sales_documents",
    RETURN_DOCUMENT: "return_documents",
  };
  const docCodeMap = new Map<string, string>();
  const idsByType = new Map<string, string[]>();
  for (const r of list) {
    if (r.ref_doc_type && r.ref_doc_id) {
      const arr = idsByType.get(r.ref_doc_type as string) ?? [];
      arr.push(r.ref_doc_id as string);
      idsByType.set(r.ref_doc_type as string, arr);
    }
  }
  for (const [docType, ids] of Array.from(idsByType.entries())) {
    const table = docTables[docType];
    if (!table) continue;
    const { data: docs } = await supabase.from(table).select("id, doc_code").in("id", Array.from(new Set(ids)));
    for (const d of (docs ?? []) as AnyRow[]) docCodeMap.set(d.id as string, d.doc_code as string);
  }
  return {
    configured: true,
    total,
    data: list.map((r) => {
      const batch = batchMap.get(r.batch_id as string);
      const product = batch ? productMap.get(batch.product_id as string) : undefined;
      return {
        id: r.id as string,
        created_at: r.created_at as string,
        movement_kind: r.movement_kind as string,
        qty: Number(r.qty),
        from_name: r.from_location_id ? (locMap.get(r.from_location_id as string) ?? "—") : null,
        to_name: r.to_location_id ? (locMap.get(r.to_location_id as string) ?? "—") : null,
        ref_doc_type: (r.ref_doc_type as string) ?? null,
        ref_doc_id: (r.ref_doc_id as string) ?? null,
        doc_code: r.ref_doc_id ? (docCodeMap.get(r.ref_doc_id as string) ?? null) : null,
        reversal_of_id: (r.reversal_of_id as string) ?? null,
        created_by_name: r.created_by ? (profMap.get(r.created_by as string) ?? null) : null,
        batch_code: (batch?.batch_code as string) ?? "—",
        sku: (product?.sku as string) ?? "—",
        product_name: (product?.name as string) ?? "—",
      };
    }),
  };
}

export interface GroupPerformanceRow {
  group: string;
  revenue: number;
  qty: number;
}

/** Doanh thu + số lượng theo nhóm hàng, từ dòng chứng từ BH/KG đã xác nhận. */
/**
 * Doanh thu + số lượng theo nhóm hàng, từ v_group_performance_by_line
 * (0030) — tổng hợp ở DB thay cho kéo dòng về app cộng tay (E8).
 * Doanh thu là GỘP trước chiết khấu (SUM(line_total)), giữ nguyên ý
 * nghĩa của hàm cũ. Ở chế độ ALL, view trả một dòng mỗi (nhóm, ngành)
 * nên gộp lại theo nhóm bằng mergeGroupPerformance.
 * lineId = uuid -> chỉ ngành đó; undefined -> toàn doanh nghiệp;
 * null -> rỗng (fail-closed).
 */
export async function getGroupPerformance(lineId?: string | null): Promise<GroupPerformanceRow[]> {
  const supabase = await client();
  if (!supabase) return [];
  if (lineId === null) return [];
  let q = supabase
    .from("v_group_performance_by_line")
    .select("product_group, business_line_id, revenue, qty");
  if (lineId !== undefined) q = q.eq("business_line_id", lineId);
  const { data, error } = await q;
  if (error || !data) return [];
  return mergeGroupPerformance(
    (data as AnyRow[]).map((r) => ({
      group: String(r.product_group),
      lineId: r.business_line_id ? String(r.business_line_id) : null,
      revenue: Number(r.revenue ?? 0),
      qty: Number(r.qty ?? 0),
    })),
  );
}

export interface SlowMovingRow {
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  lastOutAt: string | null;
  idleDays: number;
}

const OUT_KINDS = new Set(["OUT_SALE", "OUT_CONSIGNMENT", "OUT_RETURN_SUPPLIER"]);

/**
 * Hàng chậm luân chuyển: còn tồn kho mà `days` ngày không có bút toán xuất,
 * bán hay trả nào; sản phẩm mới nhập trong `days` ngày thì không tính là chậm.
 */
/**
 * Hàng chậm luân chuyển: còn tồn kho mà `days` ngày không có bút toán xuất,
 * bán hay trả nào; sản phẩm mới nhập trong `days` ngày thì không tính là chậm.
 * P5: thêm tham số lineId (lọc sản phẩm theo ngành ở DB); kéo toàn bộ
 * dòng bằng fetchAllPages thay cho .limit(5000) (E8). Lỗi DB -> rỗng.
 */
export async function getSlowMoving(days = 90, lineId?: string | null): Promise<{ rows: SlowMovingRow[]; total: number }> {
  const supabase = await client();
  if (!supabase) return { rows: [], total: 0 };
  if (lineId === null) return { rows: [], total: 0 };
  try {
    const [stock, movements, batches, products] = await Promise.all([
      fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("v_product_stock")
          .select("product_id, total_qty")
          .order("product_id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
      fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("stock_movements")
          .select("batch_id, movement_kind, created_at")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
      fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("v_batches_for_sales")
          .select("batch_id, product_id")
          .order("batch_id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
      fetchAllPages(async (from, to) => {
        let q = supabase.from("products").select("id, sku, name");
        if (lineId !== undefined) q = q.eq("business_line_id", lineId);
        const { data, error } = await q.order("id", { ascending: true }).range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
    ]);
    const cutoff = Date.now() - days * 86400000;
    const productOfBatch = new Map(batches.map((b) => [b.batch_id as string, b.product_id as string]));
    const lastOut = new Map<string, number>();
    const firstIn = new Map<string, number>();
    for (const m of movements) {
      const pid = productOfBatch.get(m.batch_id as string);
      if (!pid) continue;
      const t = new Date(m.created_at as string).getTime();
      if (OUT_KINDS.has(m.movement_kind as string)) {
        if (t > (lastOut.get(pid) ?? 0)) lastOut.set(pid, t);
      }
      if (t < (firstIn.get(pid) ?? Infinity)) firstIn.set(pid, t);
    }
    const info = new Map(products.map((p) => [p.id as string, p]));
    const rows: SlowMovingRow[] = [];
    for (const s of stock) {
      const qty = Number(s.total_qty);
      if (qty <= 0) continue;
      const pid = s.product_id as string;
      const last = lastOut.get(pid);
      const first = firstIn.get(pid) ?? Date.now();
      if (last == null && first >= cutoff) continue; // mới nhập, chưa tính là chậm
      if (last != null && last >= cutoff) continue;
      const p = info.get(pid);
      if (!p) continue;
      const idleDays = Math.floor((Date.now() - (last ?? first)) / 86400000);
      rows.push({
        product_id: pid,
        sku: (p.sku as string) ?? "—",
        name: (p.name as string) ?? "—",
        qty,
        lastOutAt: last != null ? new Date(last).toISOString() : null,
        idleDays,
      });
    }
    rows.sort((a, b) => b.idleDays - a.idleDays);
    return { rows: rows.slice(0, 10), total: rows.length };
  } catch {
    return { rows: [], total: 0 };
  }
}

export type ConsignmentGoodStatus = "UNSOLD" | "PARTIAL" | "SOLD_OUT" | "RETURNED";

export interface PartnerConsignmentGood {
  batch_id: string;
  batch_code: string;
  sku: string;
  product_name: string;
  sent: number;
  consumed: number;
  returned: number;
  still: number;
  status: ConsignmentGoodStatus;
  slip_id: string | null;
  slip_code: string | null;
  slip_date: string | null;
}

export const CONSIGNMENT_GOOD_STATUS_LABELS: Record<ConsignmentGoodStatus, string> = {
  UNSOLD: "Chưa bán",
  PARTIAL: "Đã bán một phần",
  SOLD_OUT: "Đã bán hết",
  RETURNED: "Đã trả lại",
};

/**
 * Hàng hoá ký gửi của một đối tác, theo từng lô: đã gửi, đã bán (tiêu thụ),
 * đã trả, còn giữ — kèm trạng thái bán. Lô đã bán hết / đã trả hết vẫn hiện
 * để đối tác nào cũng đối chiếu được toàn bộ lịch sử ký gửi.
 */
/**
 * Hàng hoá ký gửi của một đối tác, theo từng lô: đã gửi, đã bán (tiêu thụ),
 * đã trả, còn giữ — kèm trạng thái bán. Lô đã bán hết / đã trả hết vẫn hiện
 * để đối tác nào cũng đối chiếu được toàn bộ lịch sử ký gửi.
 * P5: thêm tham số lineId (lọc sản phẩm theo ngành ở DB — lô của ngành
 * khác bị bỏ vì không tra được sản phẩm trong danh sách đã lọc);
 * kéo bút toán bằng fetchAllPages thay cho .limit(5000) (E8).
 * Lỗi DB -> rỗng.
 */
export async function getPartnerConsignmentGoods(partnerId: string, lineId?: string | null): Promise<PartnerConsignmentGood[]> {
  const supabase = await client();
  if (!supabase) return [];
  if (lineId === null) return [];
  try {
    const { data: locs } = await supabase
      .from("locations")
      .select("id")
      .eq("partner_id", partnerId)
      .eq("location_kind", "PARTNER_VIRTUAL")
      .limit(50);
    const locIds = ((locs ?? []) as AnyRow[]).map((l) => String(l.id));
    if (locIds.length === 0) return [];
    const [atPartner, inbound, outbound] = await Promise.all([
      fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("batch_locations")
          .select("batch_id, qty")
          .in("location_id", locIds)
          .order("batch_id", { ascending: true })
          .order("location_id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
      fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("stock_movements")
          .select("batch_id, qty, ref_doc_id, created_at")
          .in("to_location_id", locIds)
          .eq("movement_kind", "OUT_CONSIGNMENT")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
      fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("stock_movements")
          .select("batch_id, qty, movement_kind, to_location_id")
          .in("from_location_id", locIds)
          .in("movement_kind", ["OUT_SALE", "TRANSFER", "IN_RETURN"])
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
    ]);
    const sentByBatch = new Map<string, number>();
    const slipByBatch = new Map<string, { id: string; at: string }>();
    for (const m of inbound) {
      const id = String(m.batch_id);
      sentByBatch.set(id, (sentByBatch.get(id) ?? 0) + Number(m.qty));
      const refId = String(m.ref_doc_id ?? "");
      if (refId) {
        const at = String(m.created_at ?? "");
        const cur = slipByBatch.get(id);
        if (!cur || at > cur.at) slipByBatch.set(id, { id: refId, at });
      }
    }
    const consumedByBatch = new Map<string, number>();
    const returnedByBatch = new Map<string, number>();
    const locSet = new Set(locIds);
    for (const m of outbound) {
      const id = String(m.batch_id);
      const qty = Number(m.qty);
      if (m.movement_kind === "OUT_SALE") {
        consumedByBatch.set(id, (consumedByBatch.get(id) ?? 0) + qty);
      } else if (!locSet.has(String(m.to_location_id))) {
        // Chuyển/trả ra khỏi kho đối tác về kho TVK mới là trả lại; chuyển
        // nội bộ giữa các kho của cùng đối tác thì không.
        returnedByBatch.set(id, (returnedByBatch.get(id) ?? 0) + qty);
      }
    }
    const stillByBatch = new Map<string, number>();
    for (const bl of atPartner) {
      const id = String(bl.batch_id);
      stillByBatch.set(id, (stillByBatch.get(id) ?? 0) + Number(bl.qty));
    }
    const batchIds = Array.from(
      new Set([
        ...Array.from(sentByBatch.keys()),
        ...Array.from(consumedByBatch.keys()),
        ...Array.from(returnedByBatch.keys()),
        ...Array.from(stillByBatch.keys()),
      ])
    );
    if (batchIds.length === 0) return [];
    const batches: AnyRow[] = [];
    for (const chunk of chunkIds(batchIds)) {
      const { data, error } = await supabase
        .from("v_batches_for_sales")
        .select("batch_id, batch_code, product_id")
        .in("batch_id", chunk);
      if (error) throw error;
      batches.push(...((data ?? []) as AnyRow[]));
    }
    // View trả một dòng mỗi vị trí — gộp theo lô để bảng không trùng dòng.
    const batchRows: AnyRow[] = Array.from(
      new Map<string, AnyRow>(
        (batches as AnyRow[]).map((b) => [String(b.batch_id), { ...b, id: b.batch_id } as AnyRow]),
      ).values(),
    );
    const productIds = Array.from(new Set(batchRows.map((b) => String(b.product_id))));
    const products: AnyRow[] = [];
    for (const chunk of chunkIds(productIds)) {
      let productsQuery = supabase.from("products").select("id, sku, name");
      if (lineId !== undefined) productsQuery = productsQuery.eq("business_line_id", lineId);
      const { data, error } = await productsQuery.in("id", chunk);
      if (error) throw error;
      products.push(...((data ?? []) as AnyRow[]));
    }
    const productOf = new Map((products as AnyRow[]).map((p) => [String(p.id), p]));
    // Phiếu gửi gần nhất của từng lô (bút toán OUT_CONSIGNMENT mang ref_doc_id
    // là id phiếu GK) — để bảng lô bấm mở được chi tiết phiếu.
    const slipIds = Array.from(new Set(Array.from(slipByBatch.values()).map((s) => s.id)));
    const slipOf = new Map<string, AnyRow>();
    if (slipIds.length) {
      const { data: slips } = await supabase
        .from("consignment_out_slips")
        .select("id, doc_code, slip_date")
        .in("id", slipIds)
        .limit(500);
      for (const s of (slips ?? []) as AnyRow[]) slipOf.set(String(s.id), s);
    }
    const rows: PartnerConsignmentGood[] = [];
    for (const b of batchRows) {
      const id = String(b.id);
      const p = productOf.get(String(b.product_id));
      if (!p) continue;
      const sent = sentByBatch.get(id) ?? 0;
      const consumed = consumedByBatch.get(id) ?? 0;
      const returned = returnedByBatch.get(id) ?? 0;
      const still = stillByBatch.get(id) ?? 0;
      const status: ConsignmentGoodStatus =
        still > 0 ? (consumed > 0 ? "PARTIAL" : "UNSOLD") : consumed > 0 ? "SOLD_OUT" : returned > 0 ? "RETURNED" : "UNSOLD";
      const slipRef = slipByBatch.get(id);
      const slip = slipRef ? slipOf.get(slipRef.id) : undefined;
      rows.push({
        batch_id: id,
        batch_code: String(b.batch_code),
        sku: String(p.sku),
        product_name: String(p.name),
        sent,
        consumed,
        returned,
        still,
        status,
        slip_id: slip ? String(slip.id) : null,
        slip_code: slip ? String(slip.doc_code) : null,
        slip_date: slip ? String(slip.slip_date) : null,
      });
    }
    rows.sort((a, b) => b.still - a.still || b.sent - a.sent || a.batch_code.localeCompare(b.batch_code));
    return rows;
  } catch {
    return [];
  }
}

/** Một điểm trên biểu đồ doanh thu – giá vốn – biên lợi nhuận. margin là
 *  % lãi gộp trên doanh thu thuần, null khi kỳ đó không có doanh thu. */
export interface PerformancePoint {
  label: string;
  revenue: number;
  cogs: number;
  margin: number | null;
}

function dayParts(iso: string): { y: number; m: number; d: number; dayNum: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, dayNum: Math.floor(Date.UTC(y, m - 1, d) / 86400000) };
}

/** Gom chứng từ đã xác nhận trong khoảng [fromISO, toISO] thành từng
 *  khoảng (ngày khi kỳ ≤ 31 ngày, 7 ngày khi ≤ 120 ngày, tháng khi dài
 *  hơn). Giá vốn theo lô thực tế đã xuất, cùng cách tính với Phân tích
 *  đơn hàng. Luôn trả đủ các khoảng trong kỳ, kể cả khoảng bằng 0. */
/** Gom chứng từ đã xác nhận trong khoảng [fromISO, toISO] thành từng
 *  khoảng (ngày khi kỳ ≤ 31 ngày, 7 ngày khi ≤ 120 ngày, tháng khi dài
 *  hơn). Luôn trả đủ các khoảng trong kỳ, kể cả khoảng bằng 0.
 *
 * P5 (§17.6 — ĐỔI NGUỒN, GIỮ ĐỊNH NGHĨA): doanh thu thuần + giá vốn
 * đọc từ v_daily_revenue_by_line (tổng hợp ở DB, không giới hạn dòng)
 * thay cho cộng tay từ sales_documents / sales_document_lines với
 * .limit(2000). Định nghĩa doanh thu KHÔNG đổi: doanh thu thuần =
 * SUM(line_total) − giảm giá đầu chứng từ, chặn dưới 0 — đúng định
 * nghĩa của v_sales_doc_totals. Trước đây hàm này đọc header
 * total_amount, mà confirm_sales_document (0019) cũng ghi bằng
 * subtotal − discount_amount, nên giá trị kỳ vọng KHỚP nhau; khác biệt
 * chỉ còn ở (a) chứng từ có total_amount lưu sẵn lệch với tổng dòng
 * (dữ liệu cũ / ghi tay) thì nay lấy theo tổng dòng, và (b) kỳ dài
 * trên 2000 chứng từ trước đây bị cắt ngắn âm thầm (E8), nay đủ số.
 * lineId = uuid -> chỉ ngành đó; undefined -> toàn doanh nghiệp
 * (gồm chứng từ chưa phân loại); null -> các khoảng 0 (fail-closed).
 * Lỗi DB lan ra (throw) để số tiền sai không hiện như số đúng.
 */
export async function getPerformanceSeries(
  fromISO: string,
  toISO: string,
  lineId?: string | null
): Promise<PerformancePoint[]> {
  const supabase = await client();
  const from = dayParts(fromISO);
  const to = dayParts(toISO);
  const spanDays = Math.max(1, to.dayNum - from.dayNum + 1);
  const mode: "day" | "week" | "month" = spanDays <= 31 ? "day" : spanDays <= 120 ? "week" : "month";
  type Bucket = { label: string; revenue: number; cogs: number; order: number };
  const buckets: Bucket[] = [];
  const bucketIndex = new Map<string, number>();
  if (mode === "month") {
    let y = from.y;
    let m = from.m;
    while (y < to.y || (y === to.y && m <= to.m)) {
      const key = `${y}-${m}`;
      bucketIndex.set(key, buckets.length);
      buckets.push({ label: `T${m}/${y}`, revenue: 0, cogs: 0, order: buckets.length });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  } else {
    const step = mode === "day" ? 1 : 7;
    for (let dayNum = from.dayNum; dayNum <= to.dayNum; dayNum += step) {
      const dt = new Date(dayNum * 86400000);
      const key = String(dayNum);
      bucketIndex.set(key, buckets.length);
      buckets.push({
        label: `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`,
        revenue: 0,
        cogs: 0,
        order: buckets.length,
      });
    }
  }
  const keyOf = (iso: string): string => {
    const p = dayParts(iso);
    if (mode === "month") return `${p.y}-${p.m}`;
    if (mode === "day") return String(p.dayNum);
    return String(from.dayNum + Math.floor((p.dayNum - from.dayNum) / 7) * 7);
  };
  const zeroBuckets = buckets.map((b) => ({ label: b.label, revenue: 0, cogs: 0, margin: null }));
  if (!supabase) return zeroBuckets;
  if (lineId === null) return zeroBuckets;
  const daily = await fetchAllPages(async (fromPage, toPage) => {
    let q = supabase
      .from("v_daily_revenue_by_line")
      .select("doc_date, business_line_id, revenue, cogs")
      .gte("doc_date", fromISO)
      .lte("doc_date", toISO);
    if (lineId !== undefined) q = q.eq("business_line_id", lineId);
    const { data, error } = await q
      .order("doc_date", { ascending: true })
      .order("business_line_id", { ascending: true })
      .range(fromPage, toPage);
    return { data: (data ?? []) as AnyRow[], error };
  });
  for (const r of daily) {
    const i = bucketIndex.get(keyOf(String(r.doc_date).slice(0, 10)));
    if (i === undefined) continue;
    buckets[i].revenue += Number(r.revenue ?? 0);
    buckets[i].cogs += Number(r.cogs ?? 0);
  }
  return buckets.map((b) => ({
    label: b.label,
    revenue: b.revenue,
    cogs: b.cogs,
    margin: b.revenue > 0 ? ((b.revenue - b.cogs) / b.revenue) * 100 : null,
  }));
}

/** Giá trị tồn kho theo nhóm hàng, chỉ hàng TVK sở hữu, theo giá vốn lô. */
export interface GroupValueRow {
  group: string;
  value: number;
  lots: number;
}

/**
 * Giá trị tồn kho theo nhóm hàng, chỉ hàng TVK sở hữu, theo giá vốn lô.
 * P5: thêm tham số lineId (lọc sản phẩm theo ngành ở DB); kéo toàn bộ
 * dòng bằng fetchAllPages thay cho .limit(5000) (E8). Lỗi DB -> rỗng.
 */
export async function getInventoryValueByGroup(lineId?: string | null): Promise<GroupValueRow[]> {
  const supabase = await client();
  if (!supabase) return [];
  if (lineId === null) return [];
  try {
    const [locs, batches, products] = await Promise.all([
      fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("batch_locations")
          .select("batch_id, qty")
          .gt("qty", 0)
          .order("batch_id", { ascending: true })
          .order("location_id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
      fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("stock_batches")
          .select("id, product_id, ownership, unit_cost")
          .eq("ownership", "OWNED")
          .order("id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
      fetchAllPages(async (from, to) => {
        let q = supabase.from("products").select("id, product_group");
        if (lineId !== undefined) q = q.eq("business_line_id", lineId);
        const { data, error } = await q.order("id", { ascending: true }).range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
    ]);
    const batchMap = new Map<string, { product_id: string; unit_cost: number }>(
      (batches as AnyRow[]).map((b) => [
        String(b.id),
        { product_id: String(b.product_id), unit_cost: Number(b.unit_cost ?? 0) },
      ])
    );
    const groupOf = new Map<string, string>(
      (products as AnyRow[]).map((p) => [String(p.id), String(p.product_group ?? "").trim()])
    );
    const byGroup = new Map<string, { value: number; lots: Set<string> }>();
    for (const bl of locs) {
      const b = batchMap.get(String(bl.batch_id));
      if (!b) continue;
      const label = groupOf.get(b.product_id) || "Chưa xếp nhóm";
      const cur = byGroup.get(label) ?? { value: 0, lots: new Set<string>() };
      cur.value += Number(bl.qty ?? 0) * b.unit_cost;
      cur.lots.add(String(bl.batch_id));
      byGroup.set(label, cur);
    }
    return Array.from(byGroup.entries())
      .map(([group, v]) => ({ group, value: v.value, lots: v.lots.size }))
      .sort((a, b) => b.value - a.value);
  } catch {
    return [];
  }
}

/** Hiệu suất tiêu thụ ký gửi theo từng đối tác: đã gửi / đã tiêu thụ /
 *  còn tại đối tác / chờ đối soát (phiếu phân bổ nháp chưa xác nhận). */
export interface PartnerConsignmentBar {
  partnerId: string;
  partnerName: string;
  sent: number;
  consumed: number;
  remaining: number;
  pending: number;
  transferValue: number;
}

/**
 * Hiệu suất tiêu thụ ký gửi theo từng đối tác: đã gửi / đã tiêu thụ /
 * còn tại đối tác / chờ đối soát (phiếu phân bổ nháp chưa xác nhận).
 * P5: đọc từ v_partner_consignment_by_line (0030) thay cho
 * v_partner_consignment, thêm tham số lineId (lọc theo ngành ở DB;
 * ở chế độ ALL gộp các hàng theo ngành về từng đối tác). Ước tính giá
 * trị còn giữ cũng lọc theo ngành qua getPartnerRemainingEstimates.
 * Lỗi DB -> rỗng.
 */
export async function getPartnerConsignmentBars(lineId?: string | null): Promise<PartnerConsignmentBar[]> {
  const supabase = await client();
  if (!supabase) return [];
  if (lineId === null) return [];
  try {
    const [view, partners, drafts, estimates] = await Promise.all([
      fetchAllPages(async (from, to) => {
        let q = supabase
          .from("v_partner_consignment_by_line")
          .select("partner_id, business_line_id, qty_sent, qty_consumed, qty_still_at_partner");
        if (lineId !== undefined) q = q.eq("business_line_id", lineId);
        const { data, error } = await q
          .order("partner_id", { ascending: true })
          .order("business_line_id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
      fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("partners")
          .select("id, name")
          .order("id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
      fetchAllPages(async (from, to) => {
        let q = supabase.from("allocation_slips").select("id, partner_id").eq("status", "DRAFT");
        if (lineId !== undefined) q = q.eq("business_line_id", lineId);
        const { data, error } = await q.order("id", { ascending: true }).range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
      getPartnerRemainingEstimates(lineId),
    ]);
    const nameMap = new Map<string, string>(
      (partners as AnyRow[]).map((p) => [String(p.id), String(p.name)])
    );
    const pendingByPartner = new Map<string, number>();
    const draftRows = drafts as AnyRow[];
    if (draftRows.length) {
      const slipPartner = new Map<string, string>(
        draftRows.map((s) => [String(s.id), String(s.partner_id)])
      );
      for (const chunk of chunkIds(Array.from(slipPartner.keys()))) {
        const { data: draftLines, error } = await supabase
          .from("allocation_lines")
          .select("allocation_id, qty")
          .in("allocation_id", chunk);
        if (error) throw error;
        for (const l of (draftLines ?? []) as AnyRow[]) {
          const pid = slipPartner.get(String(l.allocation_id));
          if (!pid) continue;
          pendingByPartner.set(pid, (pendingByPartner.get(pid) ?? 0) + Number(l.qty ?? 0));
        }
      }
    }
    // Gộp các hàng theo ngành về từng đối tác (ALL) — đã là một hàng
    // mỗi đối tác khi lọc theo ngành.
    const byPartner = new Map<string, { sent: number; consumed: number; remaining: number }>();
    for (const v of view) {
      const pid = String(v.partner_id);
      const cur = byPartner.get(pid) ?? { sent: 0, consumed: 0, remaining: 0 };
      cur.sent += Number(v.qty_sent ?? 0);
      cur.consumed += Number(v.qty_consumed ?? 0);
      cur.remaining += Number(v.qty_still_at_partner ?? 0);
      byPartner.set(pid, cur);
    }
    const rows: PartnerConsignmentBar[] = [];
    for (const [pid, v] of Array.from(byPartner.entries())) {
      const pending = pendingByPartner.get(pid) ?? 0;
      if (v.sent === 0 && pending === 0) continue;
      rows.push({
        partnerId: pid,
        partnerName: nameMap.get(pid) ?? "—",
        sent: v.sent,
        consumed: v.consumed,
        remaining: v.remaining,
        pending,
        transferValue: estimates.get(pid) ?? 0,
      });
    }
    rows.sort((a, b) => b.sent - a.sent || a.partnerName.localeCompare(b.partnerName));
    return rows;
  } catch {
    return [];
  }
}

/** Tổng tuổi nợ phải thu theo từng nhóm tuổi (nhóm của kế toán), để vẽ
 *  biểu đồ thanh ngang ở tầng cảnh báo. */
/**
 * Tổng tuổi nợ phải thu theo từng nhóm tuổi (nhóm của kế toán), để vẽ
 * biểu đồ thanh ngang ở tầng cảnh báo.
 * P5: thêm tham số lineId (lọc khoản phải thu theo ngành ở DB); kéo
 * toàn bộ dòng bằng fetchAllPages thay cho .limit(2000) (E8).
 * Lỗi DB -> rỗng.
 */
export async function getReceivableAgingBars(lineId?: string | null): Promise<
  { label: string; value: number; color: string }[]
> {
  const supabase = await client();
  if (!supabase) return [];
  if (lineId === null) return [];
  try {
    const [rows, partners] = await Promise.all([
      fetchAllPages(async (from, to) => {
        let q = supabase
          .from("partner_receivables")
          .select("partner_id, amount, amount_paid, due_date, business_line_id");
        if (lineId !== undefined) q = q.eq("business_line_id", lineId);
        const { data, error } = await q.order("id", { ascending: true }).range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
      fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("partners")
          .select("id, name")
          .order("id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      }),
    ]);
    const nameMap = new Map<string, string>(
      (partners as AnyRow[]).map((p) => [String(p.id), String(p.name)])
    );
    const aged = buildAging(
      (rows as AnyRow[]).map((r) => ({
        partyId: String(r.partner_id),
        due_date: r.due_date,
        amount: Number(r.amount ?? 0),
        amount_paid: Number(r.amount_paid ?? 0),
      })),
      nameMap
    );
    const total = (f: "notDue" | "band1" | "band2" | "band3" | "over6") =>
      aged.reduce((a, r) => a + r[f], 0);
    return [
      { label: "Chưa đến hạn", value: total("notDue"), color: "#10b981" },
      { label: "1–2 tháng", value: total("band1"), color: "#f59e0b" },
      { label: "3–4 tháng", value: total("band2"), color: "#f97316" },
      { label: "5–6 tháng", value: total("band3"), color: "#ef4444" },
      { label: "Trên 6 tháng", value: total("over6"), color: "#7f1d1d" },
    ];
  } catch {
    return [];
  }
}

/** Chứng từ + hoá đơn gắn với từng khoản phải thu của một đối tác. */
export interface ReceivableDocInfo {
  docId: string | null;
  docCode: string | null;
  docKind: string | null;
  docDate: string | null;
  invoices: { id: string; number: string; symbol: string; date: string }[];
}

export async function getPartnerReceivableDocs(partnerId: string): Promise<Map<string, ReceivableDocInfo>> {
  const out = new Map<string, ReceivableDocInfo>();
  const supabase = await client();
  if (!supabase) return out;
  const { data: recs } = await supabase
    .from("partner_receivables")
    .select("id, source_document_id")
    .eq("partner_id", partnerId)
    .limit(500);
  const recRows = (recs ?? []) as AnyRow[];
  if (recRows.length === 0) return out;
  const docIds = Array.from(new Set(recRows.map((r) => String(r.source_document_id ?? "")).filter(Boolean)));
  const docOf = new Map<string, AnyRow>();
  if (docIds.length) {
    const { data: docs } = await supabase
      .from("sales_documents")
      .select("id, doc_code, doc_kind, doc_date")
      .in("id", docIds)
      .limit(500);
    for (const d of (docs ?? []) as AnyRow[]) docOf.set(String(d.id), d);
  }
  const lineDoc = new Map<string, string>();
  if (docIds.length) {
    const { data: lines } = await supabase
      .from("sales_document_lines")
      .select("id, document_id")
      .in("document_id", docIds)
      .limit(20000);
    for (const l of (lines ?? []) as AnyRow[]) lineDoc.set(String(l.id), String(l.document_id));
  }
  const invByDoc = new Map<string, { id: string; number: string; symbol: string; date: string }[]>();
  if (lineDoc.size) {
    const { data: invLines } = await supabase
      .from("vat_invoice_lines")
      .select("vat_invoice_id, sales_document_line_id")
      .eq("is_active", true)
      .in("sales_document_line_id", Array.from(lineDoc.keys()))
      .limit(20000);
    const invIds = Array.from(new Set(((invLines ?? []) as AnyRow[]).map((l) => String(l.vat_invoice_id))));
    const invOf = new Map<string, AnyRow>();
    if (invIds.length) {
      const { data: invs } = await supabase
        .from("vat_invoices")
        .select("id, invoice_no, symbol, invoice_date")
        .in("id", invIds)
        .limit(500);
      for (const v of (invs ?? []) as AnyRow[]) invOf.set(String(v.id), v);
    }
    for (const l of (invLines ?? []) as AnyRow[]) {
      const docId = lineDoc.get(String(l.sales_document_line_id));
      const inv = invOf.get(String(l.vat_invoice_id));
      if (!docId || !inv) continue;
      const list = invByDoc.get(docId) ?? [];
      if (!list.some((x) => x.id === String(inv.id))) {
        list.push({ id: String(inv.id), number: String(inv.invoice_no), symbol: String(inv.symbol), date: String(inv.invoice_date) });
      }
      invByDoc.set(docId, list);
    }
  }
  for (const r of recRows) {
    const doc = docOf.get(String(r.source_document_id ?? ""));
    out.set(String(r.id), {
      docId: doc ? String(doc.id) : null,
      docCode: doc ? String(doc.doc_code) : null,
      docKind: doc ? String(doc.doc_kind) : null,
      docDate: doc ? String(doc.doc_date) : null,
      invoices: doc ? invByDoc.get(String(doc.id)) ?? [] : [],
    });
  }
  return out;
}

/** Một dòng hàng trong chi tiết chứng từ / hoá đơn / phiếu gửi. */
export interface DetailLine {
  sourceId?: string;
  productName: string;
  sku: string;
  batchCode: string;
  docCode?: string;
  docDate?: string;
  qty: number;
  unitPrice: number;
  amount: number;
  unitCost: number;
  profit: number;
  consumedQty?: number;
  remainingQty?: number;
  consumedAmount?: number;
  remainingEstimate?: number;
  consumedProfit?: number;
  remainingProfitEstimate?: number;
}

export interface DocumentDetail {
  kind: "DOC" | "SLIP" | "INV";
  kindLabel: string;
  code: string;
  date: string;
  /** P2: ngành của chứng từ. P4b: hoá đơn GTGT cũng có ngành. */
  business_line_id?: string | null;
  /** P4b: riêng hoá đơn GTGT — tổng trước thuế và tổng thuế GTGT (8%). */
  totalBeforeTax?: number;
  totalVat?: number;
  lines: DetailLine[];
  totalAmount: number;
  totalCost: number;
  totalProfit: number;
  /** Riêng phiếu gửi: tách phần đã bán (thật) và phần còn giữ (ước tính). */
  consumedAmount?: number;
  remainingEstimate?: number;
  consumedProfit?: number;
  remainingProfitEstimate?: number;
  note?: string;
}

async function resolveLineCosts(
  supabase: NonNullable<Awaited<ReturnType<typeof client>>>,
  lineRows: AnyRow[]
): Promise<Map<string, { batchCode: string; unitCost: number }>> {
  const allocIds = Array.from(new Set(lineRows.map((l) => String(l.allocation_line_id ?? "")).filter(Boolean)));
  const allocBatch = new Map<string, string>();
  if (allocIds.length) {
    const { data: allocs } = await supabase.from("allocation_lines").select("id, batch_id").in("id", allocIds).limit(5000);
    for (const a of (allocs ?? []) as AnyRow[]) allocBatch.set(String(a.id), String(a.batch_id));
  }
  const batchIds = Array.from(
    new Set(
      lineRows
        .map((l) => (l.batch_id ? String(l.batch_id) : allocBatch.get(String(l.allocation_line_id ?? ""))))
        .filter((v): v is string => Boolean(v))
    )
  );
  const out = new Map<string, { batchCode: string; unitCost: number }>();
  if (batchIds.length) {
    const { data: batches } = await supabase.from("stock_batches").select("id, batch_code, unit_cost").in("id", batchIds).limit(5000);
    for (const b of (batches ?? []) as AnyRow[]) {
      out.set(String(b.id), { batchCode: String(b.batch_code ?? ""), unitCost: Number(b.unit_cost ?? 0) });
    }
  }
  return out;
}

function buildDocLines(
  lineRows: AnyRow[],
  productOf: Map<string, AnyRow>,
  costOf: Map<string, { batchCode: string; unitCost: number }>,
  allocBatchOf: (line: AnyRow) => string | undefined,
  docOf?: Map<string, AnyRow>
): DetailLine[] {
  return lineRows.map((l) => {
    const p = productOf.get(String(l.product_id));
    const batchId = l.batch_id ? String(l.batch_id) : allocBatchOf(l);
    const cost = batchId ? costOf.get(batchId) : undefined;
    const qty = Number(l.qty ?? 0);
    const unitPrice = Number(l.unit_price ?? 0);
    const amount = Number(l.line_total ?? qty * unitPrice);
    const unitCost = cost?.unitCost ?? 0;
    const doc = docOf?.get(String(l.document_id));
    return {
      sourceId: String(l.id),
      productName: p ? String(p.name) : "—",
      sku: p ? String(p.sku) : "",
      batchCode: cost?.batchCode ?? "",
      docCode: doc ? String(doc.doc_code) : undefined,
      docDate: doc ? String(doc.doc_date) : undefined,
      qty,
      unitPrice,
      amount,
      unitCost,
      profit: amount - qty * unitCost,
    };
  });
}

/** Chi tiết một chứng từ quản lý (BH/KG): danh sách hàng, tiền, giá vốn, lãi. */
export async function getSalesDocumentDetail(docId: string): Promise<DocumentDetail | null> {
  const supabase = await client();
  if (!supabase) return null;
  const { data: doc } = await supabase
    .from("sales_documents")
    .select("id, doc_code, doc_kind, doc_date, partner_id, business_line_id")
    .eq("id", docId)
    .maybeSingle();
  if (!doc) return null;
  const d = doc as AnyRow;
  const { data: lines } = await supabase
    .from("sales_document_lines")
    .select("id, document_id, product_id, batch_id, allocation_line_id, qty, unit_price, line_total")
    .eq("document_id", docId)
    .order("id")
    .limit(2000);
  const lineRows = (lines ?? []) as AnyRow[];
  const allocIds = Array.from(new Set(lineRows.map((l) => String(l.allocation_line_id ?? "")).filter(Boolean)));
  const allocBatch = new Map<string, string>();
  if (allocIds.length) {
    const { data: allocs } = await supabase.from("allocation_lines").select("id, batch_id").in("id", allocIds).limit(5000);
    for (const a of (allocs ?? []) as AnyRow[]) allocBatch.set(String(a.id), String(a.batch_id));
  }
  const productIds = Array.from(new Set(lineRows.map((l) => String(l.product_id))));
  const { data: products } = await supabase.from("products").select("id, sku, name").in("id", productIds).limit(2000);
  const productOf = new Map(((products ?? []) as AnyRow[]).map((p) => [String(p.id), p]));
  const costOf = await resolveLineCosts(supabase, lineRows);
  const detailLines = buildDocLines(lineRows, productOf, costOf, (l) => allocBatch.get(String(l.allocation_line_id ?? "")));
  const totalAmount = detailLines.reduce((a, l) => a + l.amount, 0);
  const totalCost = detailLines.reduce((a, l) => a + l.qty * l.unitCost, 0);
  return {
    kind: "DOC",
    kindLabel: String(d.doc_kind) === "KG" ? "Chứng từ tiêu thụ ký gửi" : "Chứng từ bán hàng",
    code: String(d.doc_code),
    date: String(d.doc_date),
    business_line_id: (d.business_line_id as string | null) ?? null,
    lines: detailLines,
    totalAmount,
    totalCost,
    totalProfit: totalAmount - totalCost,
  };
}

/** Chi tiết một hoá đơn GTGT: các dòng hàng đã xuất hoá đơn, gom theo chứng từ gốc. */
export async function getInvoiceDetail(invoiceId: string): Promise<DocumentDetail | null> {
  const supabase = await client();
  if (!supabase) return null;
  const { data: inv } = await supabase
    .from("vat_invoices")
    .select("id, invoice_no, symbol, invoice_date, total_amount, business_line_id, total_before_tax, total_vat")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return null;
  const v = inv as AnyRow;
  const { data: invLines } = await supabase
    .from("vat_invoice_lines")
    .select("sales_document_line_id, amount")
    .eq("vat_invoice_id", invoiceId)
    .eq("is_active", true)
    .order("line_no")
    .limit(2000);
  const invLineRows = (invLines ?? []) as AnyRow[];
  if (invLineRows.length === 0) {
    return {
      kind: "INV",
      kindLabel: "Hoá đơn GTGT",
      code: `${String(v.invoice_no)} (${String(v.symbol)})`,
      date: String(v.invoice_date),
      business_line_id: (v.business_line_id as string | null) ?? null,
      totalBeforeTax: Number(v.total_before_tax ?? 0),
      totalVat: Number(v.total_vat ?? 0),
      lines: [],
      totalAmount: Number(v.total_amount ?? 0),
      totalCost: 0,
      totalProfit: 0,
    };
  }
  const lineIds = invLineRows.map((l) => String(l.sales_document_line_id));
  const { data: lines } = await supabase
    .from("sales_document_lines")
    .select("id, document_id, product_id, batch_id, allocation_line_id, qty, unit_price, line_total")
    .in("id", lineIds)
    .limit(2000);
  const lineRows = (lines ?? []) as AnyRow[];
  const docIds = Array.from(new Set(lineRows.map((l) => String(l.document_id))));
  const { data: docs } = await supabase.from("sales_documents").select("id, doc_code, doc_date").in("id", docIds).limit(500);
  const docOf = new Map(((docs ?? []) as AnyRow[]).map((dd) => [String(dd.id), dd]));
  const allocIds = Array.from(new Set(lineRows.map((l) => String(l.allocation_line_id ?? "")).filter(Boolean)));
  const allocBatch = new Map<string, string>();
  if (allocIds.length) {
    const { data: allocs } = await supabase.from("allocation_lines").select("id, batch_id").in("id", allocIds).limit(5000);
    for (const a of (allocs ?? []) as AnyRow[]) allocBatch.set(String(a.id), String(a.batch_id));
  }
  const productIds = Array.from(new Set(lineRows.map((l) => String(l.product_id))));
  const { data: products } = await supabase.from("products").select("id, sku, name").in("id", productIds).limit(2000);
  const productOf = new Map(((products ?? []) as AnyRow[]).map((p) => [String(p.id), p]));
  const costOf = await resolveLineCosts(supabase, lineRows);
  const detailLines = buildDocLines(lineRows, productOf, costOf, (l) => allocBatch.get(String(l.allocation_line_id ?? "")), docOf);
  // Giữ đúng thứ tự dòng hoá đơn: sắp theo line_no của hoá đơn.
  const order = new Map(lineIds.map((id, i) => [id, i]));
  detailLines.sort((a, b) => (order.get(a.sourceId ?? "") ?? 0) - (order.get(b.sourceId ?? "") ?? 0));
  const totalAmount = detailLines.reduce((a, l) => a + l.amount, 0);
  const totalCost = detailLines.reduce((a, l) => a + l.qty * l.unitCost, 0);
  // P4b: tổng hoá đơn lấy theo số đã ghi (đã trừ giảm giá + tách VAT);
  // tổng cộng từ dòng (gross, chưa trừ giảm giá) chỉ dùng khi hoá đơn
  // cũ chưa có số tách (trước 0029).
  const storedTotal = Number(v.total_amount ?? 0);
  const finalTotal = storedTotal > 0 ? storedTotal : totalAmount;
  return {
    kind: "INV",
    kindLabel: "Hoá đơn GTGT",
    code: `${String(v.invoice_no)} (${String(v.symbol)})`,
    date: String(v.invoice_date),
    business_line_id: (v.business_line_id as string | null) ?? null,
    totalBeforeTax: Number(v.total_before_tax ?? 0),
    totalVat: Number(v.total_vat ?? 0),
    lines: detailLines,
    totalAmount: finalTotal,
    totalCost,
    totalProfit: finalTotal - totalCost,
  };
}

/** Chi tiết một phiếu gửi ký gửi (GK): từng lô đã gửi, đã tiêu thụ (thật)
 *  và còn giữ (ước tính theo giá chuyển giao), tách lãi thật / lãi ước tính.
 *  Đã tiêu thụ / còn giữ tính theo lô tại đối tác này — một lô có thể đi
 *  trên nhiều phiếu thì các phiếu cùng thấy con số theo lô đó. */
export async function getConsignmentSlipDetail(slipId: string): Promise<DocumentDetail | null> {
  const supabase = await client();
  if (!supabase) return null;
  const { data: slip } = await supabase
    .from("consignment_out_slips")
    .select("id, doc_code, slip_date, partner_id, business_line_id")
    .eq("id", slipId)
    .maybeSingle();
  if (!slip) return null;
  const s = slip as AnyRow;
  const { data: items } = await supabase
    .from("consignment_out_items")
    .select("id, batch_id, qty, transfer_price")
    .eq("slip_id", slipId)
    .order("id")
    .limit(2000);
  const itemRows = (items ?? []) as AnyRow[];
  const batchIds = Array.from(new Set(itemRows.map((i) => String(i.batch_id))));
  const { data: batches } = await supabase
    .from("stock_batches")
    .select("id, batch_code, product_id, unit_cost")
    .in("id", batchIds)
    .limit(2000);
  const batchOf = new Map(((batches ?? []) as AnyRow[]).map((b) => [String(b.id), b]));
  const productIds = Array.from(new Set(((batches ?? []) as AnyRow[]).map((b) => String(b.product_id))));
  const { data: products } = await supabase.from("products").select("id, sku, name").in("id", productIds).limit(2000);
  const productOf = new Map(((products ?? []) as AnyRow[]).map((p) => [String(p.id), p]));
  // Tổng theo lô tại đối tác này (cùng cách tính với bảng lô ký gửi).
  const { data: locs } = await supabase
    .from("locations")
    .select("id")
    .eq("partner_id", String(s.partner_id))
    .eq("location_kind", "PARTNER_VIRTUAL")
    .limit(50);
  const locIds = ((locs ?? []) as AnyRow[]).map((l) => String(l.id));
  const consumedByBatch = new Map<string, number>();
  const stillByBatch = new Map<string, number>();
  if (locIds.length) {
    const [outbound, atPartner] = await Promise.all([
      supabase
        .from("stock_movements")
        .select("batch_id, qty")
        .in("from_location_id", locIds)
        .eq("movement_kind", "OUT_SALE")
        .in("batch_id", batchIds)
        .limit(5000),
      supabase.from("batch_locations").select("batch_id, qty").in("location_id", locIds).in("batch_id", batchIds).limit(2000),
    ]);
    for (const m of (outbound.data ?? []) as AnyRow[]) {
      const id = String(m.batch_id);
      consumedByBatch.set(id, (consumedByBatch.get(id) ?? 0) + Number(m.qty));
    }
    for (const bl of (atPartner.data ?? []) as AnyRow[]) {
      const id = String(bl.batch_id);
      stillByBatch.set(id, (stillByBatch.get(id) ?? 0) + Number(bl.qty));
    }
  }
  const lines: DetailLine[] = itemRows.map((it) => {
    const b = batchOf.get(String(it.batch_id));
    const p = b ? productOf.get(String(b.product_id)) : undefined;
    const qty = Number(it.qty ?? 0);
    const unitPrice = Number(it.transfer_price ?? 0);
    const unitCost = b ? Number(b.unit_cost ?? 0) : 0;
    const consumedQty = consumedByBatch.get(String(it.batch_id)) ?? 0;
    const remainingQty = stillByBatch.get(String(it.batch_id)) ?? 0;
    const consumedAmount = consumedQty * unitPrice;
    const remainingEstimate = remainingQty * unitPrice;
    return {
      productName: p ? String(p.name) : "—",
      sku: p ? String(p.sku) : "",
      batchCode: b ? String(b.batch_code) : "",
      qty,
      unitPrice,
      amount: qty * unitPrice,
      unitCost,
      profit: qty * (unitPrice - unitCost),
      consumedQty,
      remainingQty,
      consumedAmount,
      remainingEstimate,
      consumedProfit: consumedQty * (unitPrice - unitCost),
      remainingProfitEstimate: remainingQty * (unitPrice - unitCost),
    };
  });
  const totalAmount = lines.reduce((a, l) => a + l.amount, 0);
  const totalCost = lines.reduce((a, l) => a + l.qty * l.unitCost, 0);
  const consumedAmount = lines.reduce((a, l) => a + (l.consumedAmount ?? 0), 0);
  const remainingEstimate = lines.reduce((a, l) => a + (l.remainingEstimate ?? 0), 0);
  const consumedProfit = lines.reduce((a, l) => a + (l.consumedProfit ?? 0), 0);
  const remainingProfitEstimate = lines.reduce((a, l) => a + (l.remainingProfitEstimate ?? 0), 0);
  return {
    kind: "SLIP",
    kindLabel: "Phiếu gửi ký gửi",
    code: String(s.doc_code),
    date: String(s.slip_date),
    business_line_id: (s.business_line_id as string | null) ?? null,
    lines,
    totalAmount,
    totalCost,
    totalProfit: totalAmount - totalCost,
    consumedAmount,
    remainingEstimate,
    consumedProfit,
    remainingProfitEstimate,
    note: "Đã tiêu thụ / còn giữ tính theo lô tại đối tác này; một lô có thể đi trên nhiều phiếu.",
  };
}

/**
 * 4 nhóm tuổi nợ phục vụ Bàn điều hành CEO (Executive Receivables Aging):
 * Chưa đến hạn, 1–30 ngày, 31–60 ngày, >60 ngày
 */
export interface ExecutiveAgingBucket {
  key: string;
  label: string;
  amount: number;
  pct: number;
  color: string;
  count: number;
}

export async function getExecutiveReceivableAging(): Promise<{
  buckets: ExecutiveAgingBucket[];
  total: number;
  overdueTotal: number;
  overdueRatio: number | null;
}> {
  const supabase = await client();
  if (!supabase) {
    return {
      buckets: [],
      total: 0,
      overdueTotal: 0,
      overdueRatio: null,
    };
  }

  const { data: recs } = await supabase
    .from("partner_receivables")
    .select("amount, amount_paid, due_date, status")
    .in("status", ["UNPAID", "PARTIAL"]);

  const today = todayISO();
  const rows = (recs ?? []) as AnyRow[];

  let notDue = 0;
  let notDueCount = 0;
  let band1To30 = 0;
  let band1To30Count = 0;
  let band31To60 = 0;
  let band31To60Count = 0;
  let bandOver60 = 0;
  let bandOver60Count = 0;

  for (const r of rows) {
    const remain = Math.max(Number(r.amount ?? 0) - Number(r.amount_paid ?? 0), 0);
    if (remain <= 0) continue;
    if (!r.due_date) {
      notDue += remain;
      notDueCount += 1;
      continue;
    }
    const due = String(r.due_date).slice(0, 10);
    const diff = Math.floor((Date.parse(today) - Date.parse(due)) / 86400000);
    if (diff <= 0) {
      notDue += remain;
      notDueCount += 1;
    } else if (diff <= 30) {
      band1To30 += remain;
      band1To30Count += 1;
    } else if (diff <= 60) {
      band31To60 += remain;
      band31To60Count += 1;
    } else {
      bandOver60 += remain;
      bandOver60Count += 1;
    }
  }

  const total = notDue + band1To30 + band31To60 + bandOver60;
  const overdueTotal = band1To30 + band31To60 + bandOver60;
  const overdueRatio = total > 0 ? (overdueTotal / total) * 100 : null;

  const buckets: ExecutiveAgingBucket[] = [
    {
      key: "not_due",
      label: "Chưa đến hạn",
      amount: notDue,
      pct: total > 0 ? (notDue / total) * 100 : 0,
      color: "#10B981", // Emerald
      count: notDueCount,
    },
    {
      key: "1_30",
      label: "1–30 ngày",
      amount: band1To30,
      pct: total > 0 ? (band1To30 / total) * 100 : 0,
      color: "#F59E0B", // Amber
      count: band1To30Count,
    },
    {
      key: "31_60",
      label: "31–60 ngày",
      amount: band31To60,
      pct: total > 0 ? (band31To60 / total) * 100 : 0,
      color: "#F97316", // Orange
      count: band31To60Count,
    },
    {
      key: "over_60",
      label: ">60 ngày",
      amount: bandOver60,
      pct: total > 0 ? (bandOver60 / total) * 100 : 0,
      color: "#EF4444", // Red
      count: bandOver60Count,
    },
  ];

  return { buckets, total, overdueTotal, overdueRatio };
}

/** Nhóm hàng tạo lợi nhuận cao nhất cho CEO Dashboard */
export interface CategoryProfitabilityRow {
  group: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number | null;
  qty: number;
}

export async function getTopCategoriesProfitability(
  fromISO?: string,
  toISO?: string
): Promise<CategoryProfitabilityRow[]> {
  const supabase = await client();
  if (!supabase) return [];

  let docQuery = supabase
    .from("sales_documents")
    .select("id, doc_date")
    .eq("status", "CONFIRMED");

  if (fromISO) docQuery = docQuery.gte("doc_date", fromISO);
  if (toISO) docQuery = docQuery.lte("doc_date", toISO);

  const { data: docs } = await docQuery.limit(5000);
  const docRows = (docs ?? []) as AnyRow[];
  if (docRows.length === 0) return [];

  const docIds = docRows.map((d) => String(d.id));

  const CHUNK_SIZE = 100;
  const lines: AnyRow[] = [];
  for (let i = 0; i < docIds.length; i += CHUNK_SIZE) {
    const chunk = docIds.slice(i, i + CHUNK_SIZE);
    const { data: chunkLines } = await supabase
      .from("sales_document_lines")
      .select("document_id, product_id, qty, line_total, batch_id, allocation_line_id")
      .in("document_id", chunk)
      .limit(10000);
    if (chunkLines?.length) {
      lines.push(...(chunkLines as AnyRow[]));
    }
  }

  const { data: productsRes } = await supabase.from("products").select("id, product_group").limit(5000);
  const products = (productsRes ?? []) as AnyRow[];

  const groupOf = new Map(
    products.map((p) => [String(p.id), String(p.product_group ?? "").trim() || "Chưa xếp nhóm"])
  );

  const allocIds = Array.from(
    new Set(lines.map((l) => String(l.allocation_line_id ?? "")).filter(Boolean))
  );
  const directBatchIds = Array.from(
    new Set(lines.map((l) => String(l.batch_id ?? "")).filter(Boolean))
  );

  const allocBatch = new Map<string, string>();
  if (allocIds.length) {
    const { data: allocs } = await supabase
      .from("allocation_lines")
      .select("id, batch_id")
      .in("id", allocIds)
      .limit(5000);
    for (const a of (allocs ?? []) as AnyRow[]) {
      allocBatch.set(String(a.id), String(a.batch_id));
    }
  }

  const allBatchIds = Array.from(
    new Set([...directBatchIds, ...Array.from(allocBatch.values())])
  );

  const batchCost = new Map<string, number>();
  if (allBatchIds.length) {
    for (let i = 0; i < allBatchIds.length; i += CHUNK_SIZE) {
      const chunk = allBatchIds.slice(i, i + CHUNK_SIZE);
      const { data: batches } = await supabase
        .from("stock_batches")
        .select("id, unit_cost")
        .in("id", chunk)
        .limit(5000);
      for (const b of (batches ?? []) as AnyRow[]) {
        batchCost.set(String(b.id), Number(b.unit_cost ?? 0));
      }
    }
  }

  const byGroup = new Map<string, { revenue: number; cogs: number; qty: number }>();

  for (const l of lines) {
    const group = groupOf.get(String(l.product_id)) || "Chưa xếp nhóm";
    const cur = byGroup.get(group) ?? { revenue: 0, cogs: 0, qty: 0 };
    const rev = Number(l.line_total ?? 0);
    const qty = Number(l.qty ?? 0);
    const batchId = l.batch_id
      ? String(l.batch_id)
      : allocBatch.get(String(l.allocation_line_id ?? ""));
    const cost = qty * (batchCost.get(batchId ?? "") ?? 0);

    cur.revenue += rev;
    cur.cogs += cost;
    cur.qty += qty;
    byGroup.set(group, cur);
  }

  const rows: CategoryProfitabilityRow[] = Array.from(byGroup.entries()).map(
    ([group, data]) => {
      const grossProfit = data.revenue - data.cogs;
      const grossMargin = data.revenue > 0 ? (grossProfit / data.revenue) * 100 : null;
      return {
        group,
        revenue: data.revenue,
        cogs: data.cogs,
        grossProfit,
        grossMargin,
        qty: data.qty,
      };
    }
  );

  rows.sort((a, b) => b.grossProfit - a.grossProfit);
  return rows;
}

// =====================================================================
// SỔ QUỸ, DANH MỤC THU CHI & DÒNG TIỀN QUẢN TRỊ (/cashflow)
// =====================================================================

export interface CashCategoryRow {
  id: string;
  code: string;
  name: string;
  kind: "IN" | "OUT";
  group_key: "SALARY" | "RENT" | "TRANSPORT" | "TAX" | "OTHER";
  is_fixed: boolean;
  monthly_budget: number;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
}

export interface CashMovementFilters {
  fund_id?: string;
  movement_kind?: string;
  from_date?: string;
  to_date?: string;
  search?: string;
  limit?: number;
}

export interface UnifiedCashMovementRow {
  id: string;
  fund_id: string;
  fund_name: string;
  fund_kind: string;
  payment_id: string | null;
  payment_doc_code: string | null;
  amount: number;
  movement_date: string;
  created_at: string;
  movement_kind: "DEBT_PAYMENT" | "OPERATING" | "INTERNAL_TRANSFER" | "REVERSAL";
  category_id: string | null;
  category_name: string | null;
  category_kind: string | null;
  category_group_key: string | null;
  transfer_id: string | null;
  counter_fund_id: string | null;
  counter_fund_name: string | null;
  counter_movement_id: string | null;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  is_cancelled: boolean;
  cancel_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancelled_by_name: string | null;
  reversal_of_id: string | null;
  reversal_entry_id: string | null;
}

export interface MonthlyCashflowSummaryRow {
  monthKey: string;
  monthLabel: string;
  actualIn: number;
  actualOut: number;
  netCashflow: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpense: number;
  operatingIncome: number;
  netManagementProfit: number;
}

/**
 * Danh sách khoản mục thu / chi vận hành
 */
export async function listCashCategories(includeInactive = false): Promise<CashCategoryRow[]> {
  const supabase = await client();
  if (!supabase) return [];
  let q = supabase
    .from("cash_categories")
    .select("*")
    .order("kind", { ascending: true })
    .order("group_key", { ascending: true })
    .order("name", { ascending: true });
  if (!includeInactive) {
    q = q.eq("is_active", true);
  }
  const { data } = await q;
  return ((data ?? []) as AnyRow[]).map((c) => ({
    id: String(c.id),
    code: String(c.code ?? ""),
    name: String(c.name ?? ""),
    kind: c.kind === "IN" ? "IN" : "OUT",
    group_key: c.group_key ?? "OTHER",
    is_fixed: Boolean(c.is_fixed),
    monthly_budget: Number(c.monthly_budget ?? 0),
    is_active: Boolean(c.is_active),
    is_system: Boolean(c.is_system),
    created_at: String(c.created_at ?? ""),
  }));
}

/**
 * Sổ biến động quỹ tiền hợp nhất (Công nợ + Vận hành + Chuyển quỹ + Bút toán đảo)
 */
export async function listCashMovements(
  filters?: CashMovementFilters
): Promise<UnifiedCashMovementRow[]> {
  const supabase = await client();
  if (!supabase) return [];

  let q = supabase
    .from("cash_movements")
    .select("*")
    .order("movement_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters?.fund_id && filters.fund_id !== "ALL") {
    q = q.eq("fund_id", filters.fund_id);
  }
  if (filters?.movement_kind && filters.movement_kind !== "ALL") {
    q = q.eq("movement_kind", filters.movement_kind);
  }
  if (filters?.from_date) {
    q = q.gte("movement_date", filters.from_date);
  }
  if (filters?.to_date) {
    q = q.lte("movement_date", filters.to_date);
  }
  if (filters?.limit) {
    q = q.limit(filters.limit);
  } else {
    q = q.limit(500);
  }

  const [movsRes, fundsRes, catsRes, profilesRes] = await Promise.all([
    q,
    supabase.from("cash_funds").select("id, name, kind"),
    supabase.from("cash_categories").select("id, code, name, kind, group_key"),
    supabase.from("profiles").select("id, full_name"),
  ]);

  const rawMovs = (movsRes.data ?? []) as AnyRow[];
  const fundMap = new Map<string, AnyRow>();
  for (const f of (fundsRes.data ?? []) as AnyRow[]) {
    fundMap.set(String(f.id), f);
  }

  const categoryMap = new Map<string, AnyRow>();
  for (const c of (catsRes.data ?? []) as AnyRow[]) {
    categoryMap.set(String(c.id), c);
  }

  const profileMap = new Map<string, AnyRow>();
  for (const p of (profilesRes.data ?? []) as AnyRow[]) {
    profileMap.set(String(p.id), p);
  }

  const paymentIds = Array.from(
    new Set(rawMovs.map((m) => m.payment_id ? String(m.payment_id) : "").filter(Boolean))
  );
  const paymentMap = new Map<string, AnyRow>();
  if (paymentIds.length > 0) {
    const { data: pmts } = await supabase
      .from("payments")
      .select("id, doc_code, payment_kind, note")
      .in("id", paymentIds)
      .limit(2000);
    for (const p of (pmts ?? []) as AnyRow[]) {
      paymentMap.set(String(p.id), p);
    }
  }

  let mapped: UnifiedCashMovementRow[] = rawMovs.map((r) => {
    const fund = fundMap.get(String(r.fund_id));
    const category = r.category_id ? categoryMap.get(String(r.category_id)) : null;
    const counterFund = r.counter_fund_id ? fundMap.get(String(r.counter_fund_id)) : null;
    const payment = r.payment_id ? paymentMap.get(String(r.payment_id)) : null;
    const createdProfile = r.created_by ? profileMap.get(String(r.created_by)) : null;
    const cancelledProfile = r.cancelled_by ? profileMap.get(String(r.cancelled_by)) : null;

    return {
      id: String(r.id),
      fund_id: String(r.fund_id),
      fund_name: String(fund?.name ?? "Quỹ tiền"),
      fund_kind: String(fund?.kind ?? "CASH"),
      payment_id: r.payment_id ? String(r.payment_id) : null,
      payment_doc_code: payment?.doc_code ? String(payment.doc_code) : null,
      amount: Number(r.amount ?? 0),
      movement_date: String(r.movement_date ?? ""),
      created_at: String(r.created_at ?? ""),
      movement_kind: r.movement_kind ?? "DEBT_PAYMENT",
      category_id: r.category_id ? String(r.category_id) : null,
      category_name: category?.name ? String(category.name) : null,
      category_kind: category?.kind ? String(category.kind) : null,
      category_group_key: category?.group_key ? String(category.group_key) : null,
      transfer_id: r.transfer_id ? String(r.transfer_id) : null,
      counter_fund_id: r.counter_fund_id ? String(r.counter_fund_id) : null,
      counter_fund_name: counterFund?.name ? String(counterFund.name) : null,
      counter_movement_id: r.counter_movement_id ? String(r.counter_movement_id) : null,
      note: r.note ? String(r.note) : null,
      created_by: r.created_by ? String(r.created_by) : null,
      created_by_name: createdProfile?.full_name ? String(createdProfile.full_name) : null,
      is_cancelled: Boolean(r.is_cancelled),
      cancel_reason: r.cancel_reason ? String(r.cancel_reason) : null,
      cancelled_at: r.cancelled_at ? String(r.cancelled_at) : null,
      cancelled_by: r.cancelled_by ? String(r.cancelled_by) : null,
      cancelled_by_name: cancelledProfile?.full_name ? String(cancelledProfile.full_name) : null,
      reversal_of_id: r.reversal_of_id ? String(r.reversal_of_id) : null,
      reversal_entry_id: r.reversal_entry_id ? String(r.reversal_entry_id) : null,
    };
  });

  if (filters?.search && filters.search.trim().length > 0) {
    const s = filters.search.trim().toLowerCase();
    mapped = mapped.filter((m) => {
      return (
        (m.payment_doc_code && m.payment_doc_code.toLowerCase().includes(s)) ||
        (m.note && m.note.toLowerCase().includes(s)) ||
        (m.category_name && m.category_name.toLowerCase().includes(s)) ||
        (m.fund_name && m.fund_name.toLowerCase().includes(s)) ||
        (m.cancel_reason && m.cancel_reason.toLowerCase().includes(s))
      );
    });
  }

  return mapped;
}

/**
 * Báo cáo tổng hợp Thực thu - Thực chi và Lãi ròng quản trị 6 tháng gần nhất
 */
export async function getMonthlyCashflowSummary(): Promise<MonthlyCashflowSummaryRow[]> {
  const supabase = await client();
  const today = todayISO();
  const [curY, curM] = today.split("-").map(Number);
  const buckets: MonthlyCashflowSummaryRow[] = [];
  const monthMap = new Map<string, number>();

  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(curY, curM - 1 - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const padM = String(m).padStart(2, "0");
    const key = `${y}-${padM}`;
    const label = `Tháng ${padM}/${y}`;
    monthMap.set(key, buckets.length);
    buckets.push({
      monthKey: key,
      monthLabel: label,
      actualIn: 0,
      actualOut: 0,
      netCashflow: 0,
      revenue: 0,
      cogs: 0,
      grossProfit: 0,
      operatingExpense: 0,
      operatingIncome: 0,
      netManagementProfit: 0,
    });
  }

  if (!supabase) return buckets;

  const fromISO = `${buckets[0].monthKey}-01`;
  const toISO = today;

  // 1. Biến động dòng tiền thực tế từ cash_movements
  // P6 — không .limit(5000) cố định: kéo toàn bộ 6 tháng bằng
  // fetchAllPages (thứ tự ổn định). Lỗi DB ném ra theo quy ước P5/E8.
  const movements = await fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from("cash_movements")
      .select("movement_date, amount, movement_kind, is_cancelled")
      .gte("movement_date", fromISO)
      .lte("movement_date", toISO)
      .order("movement_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return { data: (data ?? []) as AnyRow[], error };
  });

  for (const m of movements) {
    if (m.is_cancelled) continue;
    const kind = String(m.movement_kind ?? "DEBT_PAYMENT");
    if (kind === "INTERNAL_TRANSFER" || kind === "REVERSAL") continue;

    const dateStr = String(m.movement_date ?? "").slice(0, 7);
    const idx = monthMap.get(dateStr);
    if (idx === undefined) continue;

    const amt = Number(m.amount ?? 0);
    if (amt > 0) {
      buckets[idx].actualIn += amt;
      if (kind === "OPERATING") {
        buckets[idx].operatingIncome += amt;
      }
    } else if (amt < 0) {
      const out = Math.abs(amt);
      buckets[idx].actualOut += out;
      if (kind === "OPERATING") {
        buckets[idx].operatingExpense += out;
      }
    }
  }

  // 2. Doanh thu & giá vốn từ đơn bán hàng CONFIRMED
  // P6 — không .limit(3000) cố định: kéo toàn bộ chứng từ 6 tháng
  // bằng fetchAllPages (thứ tự ổn định). Lỗi DB ném ra theo quy ước P5/E8.
  const docs = await fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from("sales_documents")
      .select("id, doc_date, total_amount")
      .eq("status", "CONFIRMED")
      .gte("doc_date", fromISO)
      .lte("doc_date", toISO)
      .order("doc_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return { data: (data ?? []) as AnyRow[], error };
  });

  const docRows = docs;
  if (docRows.length > 0) {
    const docIds = docRows.map((d) => String(d.id));
    // P6 — không .limit(20000) cố định: dòng theo từng chunk 200
    // chứng từ + phân trang range, thứ tự ổn định.
    const lineRows: AnyRow[] = [];
    for (const chunk of chunkIds(docIds)) {
      const rows = await fetchAllPages(async (from, to) => {
        const { data, error } = await supabase
          .from("sales_document_lines")
          .select("document_id, qty, batch_id, allocation_line_id")
          .in("document_id", chunk)
          .order("document_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        return { data: (data ?? []) as AnyRow[], error };
      });
      lineRows.push(...rows);
    }

    const allocIds = Array.from(
      new Set(lineRows.map((l) => String(l.allocation_line_id ?? "")).filter(Boolean))
    );
    const batchIds = Array.from(
      new Set(lineRows.map((l) => String(l.batch_id ?? "")).filter(Boolean))
    );

    const allocBatch = new Map<string, string>();
    if (allocIds.length) {
      // P6 — chunk .in() tối đa 200 id, không .limit(5000).
      for (const chunk of chunkIds(allocIds)) {
        const { data: allocs } = await supabase
          .from("allocation_lines")
          .select("id, batch_id")
          .in("id", chunk);
        for (const a of ((allocs ?? []) as AnyRow[])) {
          allocBatch.set(String(a.id), String(a.batch_id));
        }
      }
    }

    if (allocBatch.size) {
      for (const b of Array.from(allocBatch.values())) {
        batchIds.push(b);
      }
    }

    const batchCost = new Map<string, number>();
    if (batchIds.length) {
      // P6 — chunk .in() tối đa 200 id, không .limit(5000).
      for (const chunk of chunkIds(Array.from(new Set(batchIds)))) {
        const { data: batches } = await supabase
          .from("stock_batches")
          .select("id, unit_cost")
          .in("id", chunk);
        for (const b of (batches ?? []) as AnyRow[]) {
          batchCost.set(String(b.id), Number(b.unit_cost ?? 0));
        }
      }
    }

    const byDoc = new Map<string, { revenue: number; cogs: number; date: string }>();
    for (const d of docRows) {
      byDoc.set(String(d.id), {
        revenue: Math.max(Number(d.total_amount ?? 0), 0),
        cogs: 0,
        date: String(d.doc_date),
      });
    }

    for (const l of lineRows) {
      const b = byDoc.get(String(l.document_id));
      if (!b) continue;
      const batchId = l.batch_id
        ? String(l.batch_id)
        : allocBatch.get(String(l.allocation_line_id ?? ""));
      b.cogs += Number(l.qty ?? 0) * (batchCost.get(batchId ?? "") ?? 0);
    }

    for (const b of Array.from(byDoc.values())) {
      const dateStr = b.date.slice(0, 7);
      const idx = monthMap.get(dateStr);
      if (idx !== undefined) {
        buckets[idx].revenue += b.revenue;
        buckets[idx].cogs += b.cogs;
      }
    }
  }

  // 3. Tính toán các chỉ số quản trị
  for (const b of buckets) {
    b.netCashflow = b.actualIn - b.actualOut;
    b.grossProfit = b.revenue - b.cogs;
    b.netManagementProfit = b.grossProfit - b.operatingExpense + b.operatingIncome;
  }

  return buckets;
}






