import { createClient } from "@/lib/supabase/server";
import type { AnyRow, Profile } from "@/lib/types";

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
    supabase.from("v_batch_stock").select("*").eq("product_id", id),
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
      overduePayables: 0, overdueReceivables: 0,
      lowStock: [] as AnyRow[], expiring: [] as AnyRow[], discrepancies: [] as AnyRow[],
      revenue14: [] as { label: string; value: number }[],
      topProducts: [] as AnyRow[],
      stockComposition: {
        ownedOwn: { qty: 0, value: 0 },
        consignedOwn: { qty: 0, value: 0 },
        atPartners: { qty: 0, value: 0 },
      },
      balances: { payablesUnpaid: 0, payablesPartial: 0, receivablesUnpaid: 0, receivablesPartial: 0 },
    };
  }
  const dayMs = 864e5;
  const isoDay = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * dayMs).toISOString().slice(0, 10);
  const [batchStock, payables, receivables, productStock, partnerCons, productMins, partnersList, salesDocs] = await Promise.all([
    supabase.from("v_batch_stock").select("*").limit(2000),
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
    return qty * (sp > 0 ? sp : Number(r.unit_cost));
  };
  const realCompositionOf = (filter: (r: AnyRow) => boolean) => ({
    qty: sum(filter, (r) => Number(r.qty)),
    value: rows.filter(filter).reduce((acc, r) => acc + realValueOf(r), 0),
  });
  const ownedOwn = realCompositionOf((r) => owned(r) && r.location_kind === "OWN_WAREHOUSE");
  const consignedOwn = realCompositionOf((r) => consigned(r) && r.location_kind === "OWN_WAREHOUSE");
  const atPartners = realCompositionOf((r) => r.location_kind === "PARTNER_VIRTUAL");
  const consignedReal = rows.filter(consigned).reduce((acc, r) => acc + realValueOf(r), 0);
  // Sổ kế toán: tồn kho ghi theo GIÁ VỐN, không theo giá bán. Hàng giữ hộ
  // của nhà cung cấp không phải tài sản — chỉ theo dõi riêng, không gộp
  // vào tồn kho thuộc sở hữu.
  const costOf = (filter: (r: AnyRow) => boolean) => ({
    qty: sum(filter, (r) => Number(r.qty)),
    value: sum(filter, (r) => Number(r.qty) * Number(r.unit_cost)),
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
        return Number(r.qty) * (wp > 0 ? wp : Number(r.unit_cost));
      }
    ),
    retail: ownedOwn.value,
  };
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
    ownedValue: ownedOwn.value,
    consignedQty: sum(consigned, (r) => Number(r.qty)),
    consignedValue: consignedReal,
    atPartnersQty: sum((r) => r.location_kind === "PARTNER_VIRTUAL", (r) => Number(r.qty)),
    atPartnersValue: atPartners.value,
    flows: { soldQty, soldRevenue, sentQty, sentValue, consumedQty, stillQty, stillValue: atPartners.value },
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
    warehouseTierValues,
    overduePayables: overdueOutstanding(payables.data as AnyRow[] | null),
    overdueReceivables: overdueOutstanding(receivables.data as AnyRow[] | null),
    revenue14,
    topProducts,
    stockComposition: {
      ownedOwn,
      consignedOwn,
      atPartners,
    },
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
  const batches = batchIds.length
    ? ((await supabase.from("stock_batches").select("id, batch_code, product_id").in("id", batchIds)).data ?? [])
    : [];
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
        reversal_of_id: (r.reversal_of_id as string) ?? null,
        created_by_name: r.created_by ? (profMap.get(r.created_by as string) ?? null) : null,
        batch_code: (batch?.batch_code as string) ?? "—",
        sku: (product?.sku as string) ?? "—",
        product_name: (product?.name as string) ?? "—",
      };
    }),
  };
}
