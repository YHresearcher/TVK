import { createClient } from "@/lib/supabase/server";
import { buildAging } from "@/lib/aging";
import type { AnyRow, Profile, RingSegment, StockRings } from "@/lib/types";

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

async function list<T = AnyRow>(
  table: string,
  order?: { column: string; ascending?: boolean },
  limit = 500
): Promise<QueryResult<T[]>> {
  const supabase = await client();
  if (!supabase) return empty([]);
  let q = supabase.from(table).select("*").limit(limit);
  if (order) q = q.order(order.column, { ascending: order.ascending ?? false });
  const { data, error } = await q;
  if (error) return { configured: true, data: [] };
  return { configured: true, data: (data ?? []) as T[] };
}

export const listProducts = () =>
  list("products", { column: "name", ascending: true });

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
export const listPurchaseReceipts = () =>
  list("purchase_receipts", { column: "created_at" });
export const listConsignmentReceipts = () =>
  list("consignment_receipts", { column: "created_at" });
export const listConsignmentOutSlips = () =>
  list("consignment_out_slips", { column: "created_at" });
export const listConsumptionReports = () =>
  list("consumption_reports", { column: "created_at" });
export const listAllocations = () =>
  list("allocation_slips", { column: "created_at" });
export const listSalesOrders = () =>
  list("sales_orders", { column: "created_at" });
export const listSalesDocuments = () =>
  list("sales_documents", { column: "created_at" });
export const listVatInvoices = () =>
  list("vat_invoices", { column: "invoice_date" });
export const listPayables = () =>
  list("supplier_payables", { column: "created_at" });
export const listReceivables = () =>
  list("partner_receivables", { column: "created_at" });
export const listReturnDocuments = () =>
  list("return_documents", { column: "created_at" });
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
export async function getPartnerRemainingEstimates(): Promise<Map<string, number>> {
  const supabase = await client();
  const out = new Map<string, number>();
  if (!supabase) return out;
  const [stock, slips, products] = await Promise.all([
    supabase
      .from("v_batch_stock")
      .select("batch_id, product_id, partner_id, qty")
      .eq("location_kind", "PARTNER_VIRTUAL")
      .limit(2000),
    supabase.from("consignment_out_slips").select("id, created_at").eq("status", "CONFIRMED").limit(500),
    supabase.from("products").select("id, retail_price, wholesale_price"),
  ]);
  const slipCreated = new Map(
    ((slips.data ?? []) as AnyRow[]).map((s) => [String(s.id), String(s.created_at)])
  );
  const latestTransfer = new Map<string, number>();
  if ((slips.data ?? []).length) {
    const { data: items } = await supabase
      .from("consignment_out_items")
      .select("slip_id, batch_id, transfer_price")
      .in("slip_id", (slips.data ?? []).map((s) => s.id))
      .limit(5000);
    const sorted = ((items ?? []) as AnyRow[]).sort((a, b) =>
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
    ((products.data ?? []) as AnyRow[]).map((p) => [
      String(p.id),
      Number(p.retail_price ?? 0) > 0 ? Number(p.retail_price) : Number(p.wholesale_price ?? 0),
    ])
  );
  for (const r of (stock.data ?? []) as AnyRow[]) {
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

/** Sales-document lines of CONFIRMED documents that are not on any active VAT invoice yet. */
export async function listUninvoicedLines(): Promise<QueryResult<AnyRow[]>> {
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
    .select("*, products(name, sku)")
    .in("document_id", Array.from(docMap.keys()));
  const { data: activeVat } = await supabase
    .from("vat_invoice_lines")
    .select("sales_document_line_id")
    .eq("is_active", true);
  const invoiced = new Set((activeVat ?? []).map((r: AnyRow) => r.sales_document_line_id));
  const data: AnyRow[] = (lines ?? [])
    .filter((l: AnyRow) => !invoiced.has(l.id))
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
  const { data: lines } = await supabase
    .from("sales_document_lines")
    .select("document_id, qty, line_total, batch_id, allocation_line_id")
    .in("document_id", Array.from(confirmed))
    .limit(20000);
  const allLines = (lines ?? []) as AnyRow[];
  const allocIds = Array.from(new Set(allLines.map((l) => l.allocation_line_id).filter(Boolean)));
  let allocBatch = new Map<string, string>();
  if (allocIds.length) {
    const { data: allocs } = await supabase
      .from("allocation_lines")
      .select("id, batch_id")
      .in("id", allocIds);
    allocBatch = new Map(((allocs ?? []) as AnyRow[]).map((a) => [String(a.id), String(a.batch_id)]));
  }
  const batchIds = Array.from(
    new Set(
      allLines
        .map((l) => (l.batch_id ? String(l.batch_id) : allocBatch.get(String(l.allocation_line_id))))
        .filter((v): v is string => Boolean(v))
    )
  );
  let batchCost = new Map<string, number>();
  if (batchIds.length) {
    const { data: batches } = await supabase
      .from("stock_batches")
      .select("id, unit_cost")
      .in("id", batchIds);
    batchCost = new Map(((batches ?? []) as AnyRow[]).map((b) => [String(b.id), Number(b.unit_cost ?? 0)]));
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

export async function getDashboard() {
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
  const { data: me } = await getCurrentProfile();
  const isSales = me?.role === "SALES";
  const dayMs = 864e5;
  const isoDay = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * dayMs).toISOString().slice(0, 10);
  const [batchStock, payables, receivables, productStock, partnerCons, productMins, partnersList, salesDocs] = await Promise.all([
    supabase.from(isSales ? "v_batches_for_sales" : "v_batch_stock").select("*").limit(2000),
    supabase.from("supplier_payables").select("amount, amount_paid, status, due_date").in("status", ["UNPAID", "PARTIAL"]),
    supabase.from("partner_receivables").select("amount, amount_paid, status, due_date").in("status", ["UNPAID", "PARTIAL"]),
    supabase.from("v_product_stock").select("*").limit(2000),
    supabase.from("v_partner_consignment").select("*"),
    supabase.from("products").select("id, min_stock, retail_price, wholesale_price"),
    supabase.from("partners").select("id, name"),
    supabase
      .from("sales_documents")
      .select("id, doc_date, discount_amount")
      .eq("status", "CONFIRMED")
      .gte("doc_date", isoDay(29)),
  ]);
  // Lines of those confirmed documents drive both revenue (14d) and top products (30d).
  const docRows = (salesDocs.data ?? []) as AnyRow[];
  const docDate = new Map(docRows.map((d) => [d.id, String(d.doc_date).slice(0, 10)]));
  const docDiscount = new Map(docRows.map((d) => [d.id, Number(d.discount_amount ?? 0)]));
  let salesLines: AnyRow[] = [];
  if (docRows.length) {
    const { data: lines } = await supabase
      .from("sales_document_lines")
      .select("document_id, product_id, qty, line_total")
      .in("document_id", docRows.map((d) => d.id))
      .limit(10000);
    salesLines = (lines ?? []) as AnyRow[];
  }
  const docRevenue = new Map<string, number>();
  const productQty = new Map<string, number>();
  for (const l of salesLines) {
    docRevenue.set(l.document_id, (docRevenue.get(l.document_id) ?? 0) + Number(l.line_total ?? 0));
    productQty.set(l.product_id, (productQty.get(l.product_id) ?? 0) + Number(l.qty ?? 0));
  }
  const dailyRevenue = new Map<string, number>();
  for (const [docId, sum] of Array.from(docRevenue.entries())) {
    const date = docDate.get(docId);
    if (!date) continue;
    dailyRevenue.set(date, (dailyRevenue.get(date) ?? 0) + Math.max(sum - (docDiscount.get(docId) ?? 0), 0));
  }
  const revenue14 = Array.from({ length: 14 }, (_, i) => {
    const iso = isoDay(13 - i);
    return { label: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, value: dailyRevenue.get(iso) ?? 0 };
  });
  const topIds = Array.from(productQty.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);
  let topProducts: AnyRow[] = [];
  if (topIds.length) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, sku, name")
      .in("id", topIds);
    const byId = new Map(((prods ?? []) as AnyRow[]).map((p) => [p.id, p]));
    topProducts = topIds
      .filter((id) => byId.has(id))
      .map((id) => ({ ...byId.get(id), qty_sold: productQty.get(id) ?? 0 }));
  }
  const minMap = new Map(((productMins.data ?? []) as AnyRow[]).map((p) => [p.id, Number(p.min_stock ?? 0)]));
  // Giá bán của sản phẩm: giá lẻ trước, không có thì giá đại lý, không có
  // nữa thì giá vốn. Dùng để tính "giá trị thật" của hàng tồn cho CEO.
  const sellPrice = new Map(
    ((productMins.data ?? []) as AnyRow[]).map((p) => [
      p.id,
      Number(p.retail_price ?? 0) > 0 ? Number(p.retail_price) : Number(p.wholesale_price ?? 0),
    ])
  );
  // Giá đại lý của sản phẩm, dùng cho dòng so sánh 3 mức giá của hàng trong kho.
  const wholesalePrice = new Map(
    ((productMins.data ?? []) as AnyRow[]).map((p) => [p.id, Number(p.wholesale_price ?? 0)])
  );
  // Giá chuyển giao mới nhất của từng lô đã gửi ký gửi (phiếu đã xác nhận):
  // hàng ở kho đối tác tính theo giá này, vì đó là giá đối tác sẽ trả khi
  // tiêu thụ — không phải giá vốn, không phải giá lẻ hiện tại.
  const { data: confirmedSlips } = await supabase
    .from("consignment_out_slips")
    .select("id, created_at")
    .eq("status", "CONFIRMED")
    .limit(500);
  const slipCreated = new Map(
    ((confirmedSlips ?? []) as AnyRow[]).map((s) => [String(s.id), String(s.created_at)])
  );
  const latestTransfer = new Map<string, number>();
  if ((confirmedSlips ?? []).length) {
    const { data: gkItems } = await supabase
      .from("consignment_out_items")
      .select("slip_id, batch_id, transfer_price")
      .in("slip_id", (confirmedSlips ?? []).map((s) => s.id))
      .limit(5000);
    const sorted = ((gkItems ?? []) as AnyRow[]).sort((a, b) =>
      String(slipCreated.get(String(b.slip_id)) ?? "").localeCompare(
        String(slipCreated.get(String(a.slip_id)) ?? "")
      )
    );
    for (const it of sorted) {
      const key = String(it.batch_id);
      if (!latestTransfer.has(key)) latestTransfer.set(key, Number(it.transfer_price ?? 0));
    }
  }
  const rows = (batchStock.data ?? []) as AnyRow[];
  const sum = (filter: (r: AnyRow) => boolean, field: (r: AnyRow) => number) =>
    rows.filter(filter).reduce((acc, r) => acc + field(r), 0);
  const owned = (r: AnyRow) => r.ownership === "OWNED";
  const consigned = (r: AnyRow) => r.ownership === "CONSIGNED";
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
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
  // Sổ kế toán: tồn kho ghi theo GIÁ VỐN, không theo giá bán. Hàng được ký gửi
  // không phải tài sản — chỉ theo dõi riêng, không gộp
  // vào tồn kho thuộc sở hữu.
  const costOf = (filter: (r: AnyRow) => boolean) => ({
    qty: sum(filter, (r) => Number(r.qty)),
    value: sum(filter, (r) => Number(r.qty) * Number(r.unit_cost ?? 0)),
  });
  const bookOwnedOwn = costOf((r) => owned(r) && r.location_kind === "OWN_WAREHOUSE");
  const bookAtPartnersOwned = costOf((r) => owned(r) && r.location_kind === "PARTNER_VIRTUAL");
  const bookConsignedCustody = costOf(consigned);
  // Hàng trong kho TVK theo 3 mức giá (chỉ lô thuộc sở hữu, chỉ kho TVK):
  // vốn = giá vốn lô; sỉ = giá đại lý (chưa có thì giá vốn); lẻ = giá bán
  // (giá lẻ trước, không có thì giá đại lý, không có nữa thì giá vốn).
  const warehouseTierValues = {
    cost: bookOwnedOwn.value,
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
  const [draftSaleDocs, draftGkSlips, draftAllocSlips] = await Promise.all([
    supabase.from("sales_documents").select("id").eq("status", "DRAFT").limit(500),
    supabase.from("consignment_out_slips").select("id").eq("status", "DRAFT").limit(500),
    supabase.from("allocation_slips").select("id").eq("status", "DRAFT").limit(500),
  ]);
  const saleIds = ((draftSaleDocs.data ?? []) as AnyRow[]).map((d) => d.id);
  const gkIds = ((draftGkSlips.data ?? []) as AnyRow[]).map((d) => d.id);
  const draftAllocIds = ((draftAllocSlips.data ?? []) as AnyRow[]).map((d) => d.id);
  const [saleLines, gkItems, allocLines] = await Promise.all([
    saleIds.length
      ? supabase.from("sales_document_lines").select("batch_id, qty").in("document_id", saleIds).limit(5000)
      : Promise.resolve({ data: [] as AnyRow[] }),
    gkIds.length
      ? supabase.from("consignment_out_items").select("batch_id, qty").in("slip_id", gkIds).limit(5000)
      : Promise.resolve({ data: [] as AnyRow[] }),
    draftAllocIds.length
      ? supabase.from("allocation_lines").select("batch_id, qty").in("allocation_id", draftAllocIds).limit(5000)
      : Promise.resolve({ data: [] as AnyRow[] }),
  ]);
  for (const l of (saleLines.data ?? []) as AnyRow[]) addHeld(l.batch_id, l.qty);
  for (const l of (gkItems.data ?? []) as AnyRow[]) addHeld(l.batch_id, l.qty);
  for (const l of (allocLines.data ?? []) as AnyRow[]) addHeld(l.batch_id, l.qty);
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
  // Doanh thu / lợi nhuận gộp / số đơn — mọi chứng từ đã xác nhận, không
  // giới hạn ngày (ngày chứng từ có thể ghi lùi so với ngày nhập máy).
  // Giá vốn của mỗi dòng lấy từ lô đã bán của dòng đó (luồng đối tác thì
  // lô nằm ở dòng phân bổ gốc). Giảm giá trừ ở cấp chứng từ, như biểu đồ.
  const allDocsRes = await supabase
    .from("sales_documents")
    .select("id, doc_code, doc_date, doc_kind, discount_amount, partner_id, customer_name")
    .eq("status", "CONFIRMED")
    .limit(5000);
  const allDocRows = (allDocsRes.data ?? []) as AnyRow[];
  let allLines: AnyRow[] = [];
  if (allDocRows.length) {
    const { data: lines } = await supabase
      .from("sales_document_lines")
      .select("document_id, qty, line_total, batch_id, allocation_line_id")
      .in("document_id", allDocRows.map((d) => d.id))
      .limit(20000);
    allLines = (lines ?? []) as AnyRow[];
  }
  const allocIds = Array.from(new Set(allLines.map((l) => l.allocation_line_id).filter(Boolean)));
  let allocBatch = new Map<string, string>();
  if (allocIds.length) {
    const { data: allocs } = await supabase
      .from("allocation_lines")
      .select("id, batch_id")
      .in("id", allocIds);
    allocBatch = new Map(((allocs ?? []) as AnyRow[]).map((a) => [String(a.id), String(a.batch_id)]));
  }
  const batchIds = Array.from(
    new Set(
      allLines
        .map((l) => (l.batch_id ? String(l.batch_id) : allocBatch.get(String(l.allocation_line_id))))
        .filter((v): v is string => Boolean(v))
    )
  );
  let batchCost = new Map<string, number>();
  if (batchIds.length) {
    const { data: batches } = await supabase
      .from("stock_batches")
      .select("id, unit_cost")
      .in("id", batchIds);
    batchCost = new Map(((batches ?? []) as AnyRow[]).map((b) => [String(b.id), Number(b.unit_cost ?? 0)]));
  }
  const docDateAll = new Map(allDocRows.map((d) => [d.id, String(d.doc_date).slice(0, 10)]));
  const docDiscountAll = new Map(allDocRows.map((d) => [d.id, Number(d.discount_amount ?? 0)]));
  const perDoc = new Map<string, { total: number; cost: number; qty: number }>();
  for (const l of allLines) {
    const batchId = l.batch_id ? String(l.batch_id) : allocBatch.get(String(l.allocation_line_id));
    const cost = batchId ? batchCost.get(batchId) ?? 0 : 0;
    const entry = perDoc.get(l.document_id) ?? { total: 0, cost: 0, qty: 0 };
    entry.total += Number(l.line_total ?? 0);
    entry.cost += Number(l.qty ?? 0) * cost;
    entry.qty += Number(l.qty ?? 0);
    perDoc.set(l.document_id, entry);
  }
  const cutoff30 = isoDay(29);
  let revenueAll = 0;
  let cogsAll = 0;
  let revenue30 = 0;
  let cogs30 = 0;
  let orderCount30 = 0;
  const partnerName = new Map(
    ((partnersList.data ?? []) as AnyRow[]).map((p) => [String(p.id), String(p.name)])
  );
  const orderAnalysis = allDocRows
    .map((d) => {
      const t = perDoc.get(d.id);
      const net = Math.max((t?.total ?? 0) - (docDiscountAll.get(d.id) ?? 0), 0);
      const cost = t?.cost ?? 0;
      return {
        code: String(d.doc_code),
        date: String(d.doc_date).slice(0, 10),
        customer: String(d.customer_name ?? partnerName.get(String(d.partner_id)) ?? "—"),
        revenue: net,
        cogs: cost,
        profit: net - cost,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
  for (const d of allDocRows) {
    const t = perDoc.get(d.id);
    const net = Math.max((t?.total ?? 0) - (docDiscountAll.get(d.id) ?? 0), 0);
    revenueAll += net;
    cogsAll += t?.cost ?? 0;
    if ((docDateAll.get(d.id) ?? "") >= cutoff30) {
      revenue30 += net;
      cogs30 += t?.cost ?? 0;
      orderCount30++;
    }
  }
  // Luồng hàng đã bán / đã gửi ký gởi (chỉ chứng từ/phiếu đã xác nhận).
  // Đã bán chỉ tính chứng từ BH; đã gửi ký gởi tính theo phiếu GK đã xác
  // nhận (số lượng + giá chuyển giao); đã tiêu thụ/còn ở đối tác lấy từ
  // đối soát ký gửi theo đối tác.
  let soldQty = 0;
  let soldRevenue = 0;
  for (const d of allDocRows) {
    if (String((d as AnyRow).doc_kind) !== "BH") continue;
    const t = perDoc.get(d.id);
    soldQty += t?.qty ?? 0;
    soldRevenue += Math.max((t?.total ?? 0) - (docDiscountAll.get(d.id) ?? 0), 0);
  }
  let sentQty = 0;
  let sentValue = 0;
  {
    const { data: slips } = await supabase
      .from("consignment_out_slips")
      .select("id")
      .eq("status", "CONFIRMED")
      .limit(5000);
    const slipIds = ((slips ?? []) as AnyRow[]).map((s) => String(s.id));
    if (slipIds.length) {
      const { data: items } = await supabase
        .from("consignment_out_items")
        .select("qty, transfer_price")
        .in("slip_id", slipIds)
        .limit(20000);
      for (const it of (items ?? []) as AnyRow[]) {
        sentQty += Number(it.qty ?? 0);
        sentValue += Number(it.qty ?? 0) * Number(it.transfer_price ?? 0);
      }
    }
  }
  const consRows = (partnerCons.data ?? []) as AnyRow[];
  const consumedQty = consRows.reduce((a, r) => a + Number(r.qty_consumed ?? 0), 0);
  const stillQty = consRows.reduce((a, r) => a + Number(r.qty_still_at_partner ?? 0), 0);
  const remainingByStatus = (data: AnyRow[] | null, status: string) =>
    (data ?? [])
      .filter((r: AnyRow) => r.status === status)
      .reduce((a: number, r: AnyRow) => a + Number(r.amount) - Number(r.amount_paid), 0);
  // Quá hạn: còn nợ và đã qua hạn thanh toán (hàng đã giao/bán nhưng
  // chưa thu/trả đúng hẹn — khoản cần đôn đốc trước tiên).
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdueOutstanding = (data: AnyRow[] | null) =>
    (data ?? [])
      .filter((r: AnyRow) => r.due_date && String(r.due_date).slice(0, 10) < todayIso)
      .reduce((a: number, r: AnyRow) => a + Number(r.amount) - Number(r.amount_paid), 0);
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
    payablesOutstanding: (payables.data ?? []).reduce(
      (a: number, r: AnyRow) => a + Number(r.amount) - Number(r.amount_paid), 0),
    receivablesOutstanding: (receivables.data ?? []).reduce(
      (a: number, r: AnyRow) => a + Number(r.amount) - Number(r.amount_paid), 0),
    revenueAll,
    grossProfitAll: revenueAll - cogsAll,
    orderCountAll: allDocRows.length,
    revenue30,
    grossProfit30: revenue30 - cogs30,
    orderCount30,
    orderAnalysis,
    bookOwnedOwnValue: bookOwnedOwn.value,
    bookAtPartnersOwnedValue: bookAtPartnersOwned.value,
    bookInventoryValue: bookOwnedOwn.value + bookAtPartnersOwned.value,
    bookConsignedCustodyValue: bookConsignedCustody.value,
    ownedLotCount,
    consignedLotCount,
    atPartnersLotCount,
    warehouseTierValues,
    overduePayables: overdueOutstanding(payables.data as AnyRow[] | null),
    overdueReceivables: overdueOutstanding(receivables.data as AnyRow[] | null),
    revenue14,
    topProducts,
    stockComposition: {
      ownedOwn,
      ownedAtPartners,
      consignedAll,
    },
    rings,
    balances: {
      payablesUnpaid: remainingByStatus(payables.data as AnyRow[] | null, "UNPAID"),
      payablesPartial: remainingByStatus(payables.data as AnyRow[] | null, "PARTIAL"),
      receivablesUnpaid: remainingByStatus(receivables.data as AnyRow[] | null, "UNPAID"),
      receivablesPartial: remainingByStatus(receivables.data as AnyRow[] | null, "PARTIAL"),
    },
    lowStock: ((productStock.data ?? []) as AnyRow[]).filter(
      (r) => Number(r.total_qty) <= (minMap.get(r.product_id) ?? 0)
    ),
    expiring: rows.filter(
      (r) => r.ownership === "CONSIGNED" && r.return_by_date && r.return_by_date <= soon && r.location_kind === "OWN_WAREHOUSE"
    ),
    discrepancies: ((partnerCons.data ?? []) as AnyRow[]).filter(
      (r) => Number(r.qty_sent) !== Number(r.qty_consumed) + Number(r.qty_returned) + Number(r.qty_still_at_partner)
    ),
  };
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
export async function getPartnerDetail(id: string): Promise<QueryResult<PartnerDetail>> {
  const supabase = await client();
  const blank: PartnerDetail = {
    partner: null,
    consignment: null,
    receivables: [],
    invoices: [],
    stats: { outstanding: 0, totalPaid: 0, invoiceCount: 0, invoiceTotal: 0, stillAtPartner: 0 },
  };
  if (!supabase) return empty(blank);
  const [partner, consignment, receivables, invoices] = await Promise.all([
    supabase.from("partners").select("*").eq("id", id).maybeSingle(),
    supabase.from("v_partner_consignment").select("*").eq("partner_id", id).maybeSingle(),
    supabase.from("partner_receivables").select("*").eq("partner_id", id).order("created_at", { ascending: false }).limit(500),
    supabase.from("vat_invoices").select("*").eq("partner_id", id).order("invoice_date", { ascending: false }).limit(500),
  ]);
  const receivableRows = (receivables.data ?? []) as AnyRow[];
  const invoiceRows = (invoices.data ?? []) as AnyRow[];
  const issued = invoiceRows.filter((i) => i.status === "ISSUED");
  return {
    configured: true,
    data: {
      partner: (partner.data ?? null) as AnyRow | null,
      consignment: (consignment.data ?? null) as AnyRow | null,
      receivables: receivableRows,
      invoices: invoiceRows,
      stats: {
        outstanding: receivableRows
          .filter((r) => r.status === "UNPAID" || r.status === "PARTIAL")
          .reduce((a, r) => a + Number(r.amount) - Number(r.amount_paid), 0),
        totalPaid: receivableRows.reduce((a, r) => a + Number(r.amount_paid), 0),
        invoiceCount: issued.length,
        invoiceTotal: issued.reduce((a, i) => a + Number(i.total_amount), 0),
        stillAtPartner: Number(consignment.data?.qty_still_at_partner ?? 0),
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
export async function listLedgerMovements(limit = 200): Promise<QueryResult<LedgerRow[]>> {
  const supabase = await client();
  if (!supabase) return empty([]);
  const { data: rows, error } = await supabase
    .from("stock_movements")
    .select("id, created_at, movement_kind, qty, from_location_id, to_location_id, ref_doc_type, ref_doc_id, reversal_of_id, created_by, batch_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const list = (rows ?? []) as AnyRow[];
  const batchIds = Array.from(new Set(list.map((r) => r.batch_id as string)));
  const batchRows = batchIds.length
    ? ((await supabase.from("v_batches_for_sales").select("batch_id, batch_code, product_id").in("batch_id", batchIds)).data ?? [])
    : [];
  const batches = (batchRows as AnyRow[]).map((b) => ({ ...b, id: b.batch_id }));
  const productIds = Array.from(new Set((batches as AnyRow[]).map((b) => b.product_id as string)));
  const products = productIds.length
    ? ((await supabase.from("products").select("id, sku, name").in("id", productIds)).data ?? [])
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
export async function getGroupPerformance(): Promise<GroupPerformanceRow[]> {
  const supabase = await client();
  if (!supabase) return [];
  const [lines, docs, products] = await Promise.all([
    supabase.from("sales_document_lines").select("document_id, product_id, qty, line_total").limit(2000),
    supabase.from("sales_documents").select("id, status").eq("status", "CONFIRMED").limit(2000),
    supabase.from("products").select("id, product_group").limit(5000),
  ]);
  if (lines.error || docs.error || products.error) return [];
  const confirmed = new Set(((docs.data ?? []) as AnyRow[]).map((d) => d.id as string));
  const groupOf = new Map(((products.data ?? []) as AnyRow[]).map((p) => [p.id as string, (p.product_group as string) ?? ""]));
  const byGroup = new Map<string, GroupPerformanceRow>();
  for (const l of (lines.data ?? []) as AnyRow[]) {
    if (!confirmed.has(l.document_id as string)) continue;
    const label = groupOf.get(l.product_id as string)?.trim() || "Chưa xếp nhóm";
    const row = byGroup.get(label) ?? { group: label, revenue: 0, qty: 0 };
    row.revenue += Number(l.line_total);
    row.qty += Number(l.qty);
    byGroup.set(label, row);
  }
  return Array.from(byGroup.values()).sort((a, b) => b.revenue - a.revenue);
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
export async function getSlowMoving(days = 90): Promise<{ rows: SlowMovingRow[]; total: number }> {
  const supabase = await client();
  if (!supabase) return { rows: [], total: 0 };
  const [stock, movements, batches, products] = await Promise.all([
    supabase.from("v_product_stock").select("product_id, total_qty").limit(5000),
    supabase.from("stock_movements").select("batch_id, movement_kind, created_at").limit(5000),
    supabase.from("v_batches_for_sales").select("batch_id, product_id").limit(5000),
    supabase.from("products").select("id, sku, name").limit(5000),
  ]);
  if (stock.error || movements.error || batches.error || products.error) return { rows: [], total: 0 };
  const cutoff = Date.now() - days * 86400000;
  const productOfBatch = new Map(((batches.data ?? []) as AnyRow[]).map((b) => [b.batch_id as string, b.product_id as string]));
  const lastOut = new Map<string, number>();
  const firstIn = new Map<string, number>();
  for (const m of (movements.data ?? []) as AnyRow[]) {
    const pid = productOfBatch.get(m.batch_id as string);
    if (!pid) continue;
    const t = new Date(m.created_at as string).getTime();
    if (OUT_KINDS.has(m.movement_kind as string)) {
      if (t > (lastOut.get(pid) ?? 0)) lastOut.set(pid, t);
    }
    if (t < (firstIn.get(pid) ?? Infinity)) firstIn.set(pid, t);
  }
  const info = new Map(((products.data ?? []) as AnyRow[]).map((p) => [p.id as string, p]));
  const rows: SlowMovingRow[] = [];
  for (const s of (stock.data ?? []) as AnyRow[]) {
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
export async function getPartnerConsignmentGoods(partnerId: string): Promise<PartnerConsignmentGood[]> {
  const supabase = await client();
  if (!supabase) return [];
  const { data: locs } = await supabase
    .from("locations")
    .select("id")
    .eq("partner_id", partnerId)
    .eq("location_kind", "PARTNER_VIRTUAL")
    .limit(50);
  const locIds = ((locs ?? []) as AnyRow[]).map((l) => String(l.id));
  if (locIds.length === 0) return [];
  const [atPartner, inbound, outbound] = await Promise.all([
    supabase.from("batch_locations").select("batch_id, qty").in("location_id", locIds).limit(2000),
    supabase
      .from("stock_movements")
      .select("batch_id, qty, ref_doc_id, created_at")
      .in("to_location_id", locIds)
      .eq("movement_kind", "OUT_CONSIGNMENT")
      .limit(5000),
    supabase
      .from("stock_movements")
      .select("batch_id, qty, movement_kind, to_location_id")
      .in("from_location_id", locIds)
      .in("movement_kind", ["OUT_SALE", "TRANSFER", "IN_RETURN"])
      .limit(5000),
  ]);
  if (atPartner.error || inbound.error || outbound.error) return [];
  const sentByBatch = new Map<string, number>();
  const slipByBatch = new Map<string, { id: string; at: string }>();
  for (const m of (inbound.data ?? []) as AnyRow[]) {
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
  for (const m of (outbound.data ?? []) as AnyRow[]) {
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
  for (const bl of (atPartner.data ?? []) as AnyRow[]) {
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
  const { data: batches } = await supabase
    .from("v_batches_for_sales")
    .select("batch_id, batch_code, product_id")
    .in("batch_id", batchIds)
    .limit(5000);
  // View trả một dòng mỗi vị trí — gộp theo lô để bảng không trùng dòng.
  const batchRows: AnyRow[] = Array.from(
    new Map<string, AnyRow>(
      ((batches ?? []) as AnyRow[]).map((b) => [String(b.batch_id), { ...b, id: b.batch_id } as AnyRow]),
    ).values(),
  );
  const productIds = Array.from(new Set(batchRows.map((b) => String(b.product_id))));
  const { data: products } = await supabase.from("products").select("id, sku, name").in("id", productIds).limit(2000);
  const productOf = new Map(((products ?? []) as AnyRow[]).map((p) => [String(p.id), p]));
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
export async function getPerformanceSeries(
  fromISO: string,
  toISO: string
): Promise<PerformancePoint[]> {
  const supabase = await client();
  if (!supabase) return [];
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
  const { data: docs } = await supabase
    .from("sales_documents")
    .select("id, doc_date, total_amount, discount_amount")
    .eq("status", "CONFIRMED")
    .gte("doc_date", fromISO)
    .lte("doc_date", toISO)
    .limit(2000);
  const docRows = (docs ?? []) as AnyRow[];
  if (docRows.length === 0) return buckets.map((b) => ({ label: b.label, revenue: 0, cogs: 0, margin: null }));
  const docIds = docRows.map((d) => String(d.id));
  const { data: lines } = await supabase
    .from("sales_document_lines")
    .select("document_id, qty, batch_id, allocation_line_id")
    .in("document_id", docIds)
    .limit(20000);
  const lineRows = (lines ?? []) as AnyRow[];
  const allocIds = Array.from(new Set(lineRows.map((l) => String(l.allocation_line_id ?? "")).filter(Boolean)));
  const batchIds = Array.from(new Set(lineRows.map((l) => String(l.batch_id ?? "")).filter(Boolean)));
  const allocBatch = new Map<string, string>();
  if (allocIds.length) {
    const { data: allocs } = await supabase
      .from("allocation_lines")
      .select("id, batch_id")
      .in("id", allocIds)
      .limit(5000);
    for (const a of (allocs ?? []) as AnyRow[]) allocBatch.set(String(a.id), String(a.batch_id));
  }
  if (allocBatch.size) for (const b of Array.from(allocBatch.values())) batchIds.push(b);
  const batchCost = new Map<string, number>();
  if (batchIds.length) {
    const { data: batches } = await supabase
      .from("stock_batches")
      .select("id, unit_cost")
      .in("id", Array.from(new Set(batchIds)))
      .limit(5000);
    for (const b of (batches ?? []) as AnyRow[]) batchCost.set(String(b.id), Number(b.unit_cost ?? 0));
  }
  const byDoc = new Map<string, { revenue: number; cogs: number; date: string }>();
  for (const d of docRows) {
    byDoc.set(String(d.id), {
      revenue: Math.max(Number(d.total_amount ?? 0) - Number(d.discount_amount ?? 0), 0),
      cogs: 0,
      date: String(d.doc_date),
    });
  }
  for (const l of lineRows) {
    const b = byDoc.get(String(l.document_id));
    if (!b) continue;
    const batchId = l.batch_id ? String(l.batch_id) : allocBatch.get(String(l.allocation_line_id ?? ""));
    b.cogs += Number(l.qty ?? 0) * (batchCost.get(batchId ?? "") ?? 0);
  }
  for (const b of Array.from(byDoc.values())) {
    const i = bucketIndex.get(keyOf(b.date));
    if (i === undefined) continue;
    buckets[i].revenue += b.revenue;
    buckets[i].cogs += b.cogs;
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

export async function getInventoryValueByGroup(): Promise<GroupValueRow[]> {
  const supabase = await client();
  if (!supabase) return [];
  const [locs, batches, products] = await Promise.all([
    supabase.from("batch_locations").select("batch_id, qty").gt("qty", 0).limit(5000),
    supabase.from("stock_batches").select("id, product_id, ownership, unit_cost").eq("ownership", "OWNED").limit(5000),
    supabase.from("products").select("id, product_group").limit(5000),
  ]);
  if (locs.error || batches.error || products.error) return [];
  const batchMap = new Map<string, { product_id: string; unit_cost: number }>(
    ((batches.data ?? []) as AnyRow[]).map((b) => [
      String(b.id),
      { product_id: String(b.product_id), unit_cost: Number(b.unit_cost ?? 0) },
    ])
  );
  const groupOf = new Map<string, string>(
    ((products.data ?? []) as AnyRow[]).map((p) => [String(p.id), String(p.product_group ?? "").trim()])
  );
  const byGroup = new Map<string, { value: number; lots: Set<string> }>();
  for (const bl of (locs.data ?? []) as AnyRow[]) {
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

export async function getPartnerConsignmentBars(): Promise<PartnerConsignmentBar[]> {
  const supabase = await client();
  if (!supabase) return [];
  const [view, partners, drafts, estimates] = await Promise.all([
    supabase
      .from("v_partner_consignment")
      .select("partner_id, qty_sent, qty_consumed, qty_still_at_partner")
      .limit(500),
    supabase.from("partners").select("id, name").limit(500),
    supabase.from("allocation_slips").select("id, partner_id").eq("status", "DRAFT").limit(500),
    getPartnerRemainingEstimates(),
  ]);
  const nameMap = new Map<string, string>(
    ((partners.data ?? []) as AnyRow[]).map((p) => [String(p.id), String(p.name)])
  );
  const pendingByPartner = new Map<string, number>();
  const draftRows = (drafts.data ?? []) as AnyRow[];
  if (draftRows.length) {
    const slipPartner = new Map<string, string>(
      draftRows.map((s) => [String(s.id), String(s.partner_id)])
    );
    const { data: draftLines } = await supabase
      .from("allocation_lines")
      .select("allocation_id, qty")
      .in("allocation_id", Array.from(slipPartner.keys()))
      .limit(5000);
    for (const l of (draftLines ?? []) as AnyRow[]) {
      const pid = slipPartner.get(String(l.allocation_id));
      if (!pid) continue;
      pendingByPartner.set(pid, (pendingByPartner.get(pid) ?? 0) + Number(l.qty ?? 0));
    }
  }
  const rows: PartnerConsignmentBar[] = [];
  for (const v of (view.data ?? []) as AnyRow[]) {
    const pid = String(v.partner_id);
    const sent = Number(v.qty_sent ?? 0);
    const pending = pendingByPartner.get(pid) ?? 0;
    if (sent === 0 && pending === 0) continue;
    rows.push({
      partnerId: pid,
      partnerName: nameMap.get(pid) ?? "—",
      sent,
      consumed: Number(v.qty_consumed ?? 0),
      remaining: Number(v.qty_still_at_partner ?? 0),
      pending,
      transferValue: estimates.get(pid) ?? 0,
    });
  }
  rows.sort((a, b) => b.sent - a.sent || a.partnerName.localeCompare(b.partnerName));
  return rows;
}

/** Tổng tuổi nợ phải thu theo từng nhóm tuổi (nhóm của kế toán), để vẽ
 *  biểu đồ thanh ngang ở tầng cảnh báo. */
export async function getReceivableAgingBars(): Promise<
  { label: string; value: number; color: string }[]
> {
  const supabase = await client();
  if (!supabase) return [];
  const [rows, partners] = await Promise.all([
    supabase.from("partner_receivables").select("partner_id, amount, amount_paid, due_date").limit(2000),
    supabase.from("partners").select("id, name").limit(500),
  ]);
  const nameMap = new Map<string, string>(
    ((partners.data ?? []) as AnyRow[]).map((p) => [String(p.id), String(p.name)])
  );
  const aged = buildAging(
    ((rows.data ?? []) as AnyRow[]).map((r) => ({
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
    .select("id, doc_code, doc_kind, doc_date, partner_id")
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
    .select("id, invoice_no, symbol, invoice_date, total_amount")
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
  return {
    kind: "INV",
    kindLabel: "Hoá đơn GTGT",
    code: `${String(v.invoice_no)} (${String(v.symbol)})`,
    date: String(v.invoice_date),
    lines: detailLines,
    totalAmount,
    totalCost,
    totalProfit: totalAmount - totalCost,
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
    .select("id, doc_code, slip_date, partner_id")
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
