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
export const listProductCodes = () =>
  list("product_codes", { column: "code", ascending: true });

/** Normalized (trim + uppercase) map: any known product code or SKU → product_id. Used by the barcode scan box. */
export function buildProductCodeMap(
  products: AnyRow[],
  codes: AnyRow[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of products) {
    if (p.sku) map[String(p.sku).trim().toUpperCase()] = p.id;
  }
  for (const c of codes) {
    if (c.code) map[String(c.code).trim().toUpperCase()] = c.product_id;
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

export async function getDashboard() {
  const supabase = await client();
  if (!supabase) {
    return {
      configured: false,
      ownedQty: 0, ownedValue: 0, consignedQty: 0, consignedValue: 0,
      atPartnersQty: 0, payablesOutstanding: 0, receivablesOutstanding: 0,
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
  const [batchStock, payables, receivables, productStock, partnerCons, productMins, salesDocs] = await Promise.all([
    supabase.from("v_batch_stock").select("*").limit(2000),
    supabase.from("supplier_payables").select("amount, amount_paid, status").in("status", ["UNPAID", "PARTIAL"]),
    supabase.from("partner_receivables").select("amount, amount_paid, status").in("status", ["UNPAID", "PARTIAL"]),
    supabase.from("v_product_stock").select("*").limit(2000),
    supabase.from("v_partner_consignment").select("*"),
    supabase.from("products").select("id, min_stock"),
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
  const rows = (batchStock.data ?? []) as AnyRow[];
  const sum = (filter: (r: AnyRow) => boolean, field: (r: AnyRow) => number) =>
    rows.filter(filter).reduce((acc, r) => acc + field(r), 0);
  const owned = (r: AnyRow) => r.ownership === "OWNED";
  const consigned = (r: AnyRow) => r.ownership === "CONSIGNED";
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const compositionOf = (filter: (r: AnyRow) => boolean) => ({
    qty: sum(filter, (r) => Number(r.qty)),
    value: sum(filter, (r) => Number(r.qty) * Number(r.unit_cost)),
  });
  const remainingByStatus = (data: AnyRow[] | null, status: string) =>
    (data ?? [])
      .filter((r: AnyRow) => r.status === status)
      .reduce((a: number, r: AnyRow) => a + Number(r.amount) - Number(r.amount_paid), 0);
  return {
    configured: true,
    ownedQty: sum(owned, (r) => Number(r.qty)),
    ownedValue: sum(owned, (r) => Number(r.qty) * Number(r.unit_cost)),
    consignedQty: sum(consigned, (r) => Number(r.qty)),
    consignedValue: sum(consigned, (r) => Number(r.qty) * Number(r.unit_cost)),
    atPartnersQty: sum((r) => r.location_kind === "PARTNER_VIRTUAL", (r) => Number(r.qty)),
    payablesOutstanding: (payables.data ?? []).reduce(
      (a: number, r: AnyRow) => a + Number(r.amount) - Number(r.amount_paid), 0),
    receivablesOutstanding: (receivables.data ?? []).reduce(
      (a: number, r: AnyRow) => a + Number(r.amount) - Number(r.amount_paid), 0),
    revenue14,
    topProducts,
    stockComposition: {
      ownedOwn: compositionOf((r) => owned(r) && r.location_kind === "OWN_WAREHOUSE"),
      consignedOwn: compositionOf((r) => consigned(r) && r.location_kind === "OWN_WAREHOUSE"),
      atPartners: compositionOf((r) => r.location_kind === "PARTNER_VIRTUAL"),
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
