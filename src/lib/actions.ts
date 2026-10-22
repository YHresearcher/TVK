"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AnyRow } from "@/lib/types";

async function db() {
  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase chưa được cấu hình.");
  return supabase;
}

async function userId() {
  const supabase = await db();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function str(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
function optStr(formData: FormData, name: string): string | null {
  const v = str(formData, name);
  return v === "" ? null : v;
}
function num(formData: FormData, name: string): number {
  return Number(str(formData, name) || 0);
}
function optDate(formData: FormData, name: string): string | null {
  return optStr(formData, name);
}

/** Zip repeated form fields into row objects, dropping fully-empty rows. */
function zipItems(formData: FormData, fields: string[]): AnyRow[] {
  const cols = fields.map((f) => formData.getAll(f).map((v) => String(v).trim()));
  const count = Math.max(0, ...cols.map((c) => c.length));
  const rows: AnyRow[] = [];
  for (let i = 0; i < count; i++) {
    const row: AnyRow = {};
    let hasValue = false;
    fields.forEach((f, j) => {
      row[f] = cols[j][i] ?? "";
      if (row[f] !== "") hasValue = true;
    });
    if (hasValue) rows.push(row);
  }
  return rows;
}

function must<T>(result: { data: T; error: AnyRow | null }, what: string): NonNullable<T> {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null || result.data === undefined)
    throw new Error(`${what}: không có dữ liệu trả về`);
  return result.data as NonNullable<T>;
}

function done(result: { error: AnyRow | null }, what: string) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
}

/** Location currently holding the most of a batch inside our own warehouses. */
async function mainOwnLocationOfBatch(supabase: AnyRow, batchId: string) {
  const { data, error } = await supabase
    .from("batch_locations")
    .select("location_id, qty, locations(location_kind)")
    .eq("batch_id", batchId)
    .order("qty", { ascending: false });
  if (error) throw new Error(error.message);
  const own = (data ?? []).filter(
    (r: AnyRow) => (r.locations as AnyRow)?.location_kind === "OWN_WAREHOUSE"
  );
  return own[0]?.location_id as string | undefined;
}

async function partnerLocationId(supabase: AnyRow, partnerId: string) {
  const { data } = await supabase
    .from("locations")
    .select("id")
    .eq("partner_id", partnerId)
    .eq("location_kind", "PARTNER_VIRTUAL")
    .maybeSingle();
  return data?.id as string | undefined;
}

async function defaultWarehouseId(supabase: AnyRow) {
  const { data } = await supabase
    .from("locations")
    .select("id")
    .eq("location_kind", "OWN_WAREHOUSE")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id as string | undefined;
}

// ------------------------------------------------------------------ auth
export async function signOutAction() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}

// -------------------------------------------------------------- catalog
export async function createProductAction(formData: FormData) {
  const supabase = await db();
  const product = must(
    await supabase
      .from("products")
      .insert({
        sku: str(formData, "sku"),
        name: str(formData, "name"),
        brand: optStr(formData, "brand"),
        unit: str(formData, "unit") || "cái",
        retail_price: num(formData, "retail_price"),
        garage_price: num(formData, "garage_price"),
        wholesale_price: num(formData, "wholesale_price"),
        min_stock: Math.trunc(num(formData, "min_stock")),
      })
      .select("id")
      .single(),
    "Tạo sản phẩm"
  );
  const codesText = str(formData, "codes");
  if (codesText) {
    const rows = codesText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [code, kind] = l.split("|").map((s) => s.trim());
        return {
          product_id: product.id,
          code,
          code_kind: kind || "OEM",
        };
      });
    if (rows.length) await supabase.from("product_codes").insert(rows);
  }
  revalidatePath("/products");
  redirect("/products?ok=1");
}

export async function createProductCodeAction(productId: string, formData: FormData) {
  const supabase = await db();
  done(
    await supabase.from("product_codes").insert({
      product_id: productId,
      code: str(formData, "code"),
      code_kind: str(formData, "code_kind") || "OEM",
      note: optStr(formData, "note"),
    }),
    "Thêm mã sản phẩm"
  );
  revalidatePath(`/products/${productId}`);
}

export async function createFitmentAction(productId: string, formData: FormData) {
  const supabase = await db();
  const vehicle = {
    make: str(formData, "make"),
    model: str(formData, "model"),
    year_from: str(formData, "year_from") ? Math.trunc(num(formData, "year_from")) : null,
    year_to: str(formData, "year_to") ? Math.trunc(num(formData, "year_to")) : null,
    engine: optStr(formData, "engine"),
  };
  let vehicleId: string | undefined;
  const inserted = await supabase.from("vehicles").insert(vehicle).select("id").single();
  if (!inserted.error) {
    vehicleId = inserted.data.id;
  } else {
    const { data } = await supabase
      .from("vehicles")
      .select("id")
      .eq("make", vehicle.make)
      .eq("model", vehicle.model)
      .limit(1)
      .maybeSingle();
    vehicleId = data?.id;
  }
  if (!vehicleId) throw new Error("Không tạo/tìm được xe.");
  await supabase
    .from("product_fitments")
    .insert({ product_id: productId, vehicle_id: vehicleId, note: optStr(formData, "note") });
  revalidatePath(`/products/${productId}`);
}

// ------------------------------------------------------------- partners
export async function createSupplierAction(formData: FormData) {
  const supabase = await db();
  done(
    await supabase.from("suppliers").insert({
      name: str(formData, "name"),
      contact_name: optStr(formData, "contact_name"),
      phone: optStr(formData, "phone"),
      email: optStr(formData, "email"),
      address: optStr(formData, "address"),
      tax_code: optStr(formData, "tax_code"),
      consignment_pay_days: Math.trunc(num(formData, "consignment_pay_days") || 30),
      consignment_return_days: Math.trunc(num(formData, "consignment_return_days") || 90),
      allow_sub_consignment: formData.get("allow_sub_consignment") === "on",
      notes: optStr(formData, "notes"),
    }),
    "Tạo nhà cung cấp"
  );
  revalidatePath("/suppliers");
  redirect("/suppliers?ok=1");
}

export async function createPartnerAction(formData: FormData) {
  const supabase = await db();
  done(
    await supabase.from("partners").insert({
      name: str(formData, "name"),
      partner_kind: str(formData, "partner_kind") || "GARAGE",
      contact_name: optStr(formData, "contact_name"),
      phone: optStr(formData, "phone"),
      email: optStr(formData, "email"),
      address: optStr(formData, "address"),
      tax_code: optStr(formData, "tax_code"),
      payment_days: Math.trunc(num(formData, "payment_days")),
      credit_limit: num(formData, "credit_limit"),
      consignment_limit: num(formData, "consignment_limit"),
      notes: optStr(formData, "notes"),
    }),
    "Tạo đối tác"
  );
  revalidatePath("/partners");
  redirect("/partners?ok=1");
}

export async function createWarehouseAction(formData: FormData) {
  const supabase = await db();
  done(
    await supabase.from("locations").insert({
      name: str(formData, "name"),
      location_kind: "OWN_WAREHOUSE",
      detail: optStr(formData, "detail"),
    }),
    "Tạo kho"
  );
  revalidatePath("/settings");
  revalidatePath("/stock-in");
}

// -------------------------------------------------------------- stock in
export async function createPurchaseReceiptAction(formData: FormData) {
  const supabase = await db();
  const receipt = must(
    await supabase
      .from("purchase_receipts")
      .insert({
        supplier_id: str(formData, "supplier_id"),
        warehouse_id: str(formData, "warehouse_id"),
        receipt_date: optDate(formData, "receipt_date") ?? undefined,
        supplier_invoice_no: optStr(formData, "supplier_invoice_no"),
        note: optStr(formData, "note"),
        created_by: await userId(),
      })
      .select("id")
      .single(),
    "Tạo phiếu nhập mua"
  );
  const items = zipItems(formData, ["product_id", "qty", "unit_cost"])
    .filter((r) => r.product_id && Number(r.qty) > 0)
    .map((r) => ({
      receipt_id: receipt.id,
      product_id: r.product_id,
      qty: Math.trunc(Number(r.qty)),
      unit_cost: Number(r.unit_cost),
    }));
  if (!items.length) throw new Error("Phiếu nhập cần ít nhất một dòng hàng.");
  done(await supabase.from("purchase_receipt_items").insert(items), "Thêm dòng phiếu nhập");
  revalidatePath("/stock-in");
  redirect("/stock-in?tab=purchase&ok=1");
}

export async function confirmPurchaseReceiptAction(formData: FormData) {
  const supabase = await db();
  const { error } = await supabase.rpc("confirm_purchase_receipt", {
    p_receipt_id: str(formData, "id"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/stock-in");
  revalidatePath("/inventory");
}

export async function createConsignmentReceiptAction(formData: FormData) {
  const supabase = await db();
  const receipt = must(
    await supabase
      .from("consignment_receipts")
      .insert({
        supplier_id: str(formData, "supplier_id"),
        warehouse_id: str(formData, "warehouse_id"),
        receipt_date: optDate(formData, "receipt_date") ?? undefined,
        return_by_date: optDate(formData, "return_by_date"),
        note: optStr(formData, "note"),
        created_by: await userId(),
      })
      .select("id")
      .single(),
    "Tạo phiếu nhận ký gửi"
  );
  const items = zipItems(formData, ["product_id", "qty", "consignment_price"])
    .filter((r) => r.product_id && Number(r.qty) > 0)
    .map((r) => ({
      receipt_id: receipt.id,
      product_id: r.product_id,
      qty: Math.trunc(Number(r.qty)),
      consignment_price: Number(r.consignment_price),
    }));
  if (!items.length) throw new Error("Phiếu nhập cần ít nhất một dòng hàng.");
  done(await supabase.from("consignment_receipt_items").insert(items), "Thêm dòng phiếu nhập");
  revalidatePath("/stock-in");
  redirect("/stock-in?tab=consignment&ok=1");
}

export async function confirmConsignmentReceiptAction(formData: FormData) {
  const supabase = await db();
  const { error } = await supabase.rpc("confirm_consignment_receipt", {
    p_receipt_id: str(formData, "id"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/stock-in");
  revalidatePath("/inventory");
}

// -------------------------------------------------------- consignment out
export async function createConsignmentOutAction(formData: FormData) {
  const supabase = await db();
  const slip = must(
    await supabase
      .from("consignment_out_slips")
      .insert({
        partner_id: str(formData, "partner_id"),
        slip_date: optDate(formData, "slip_date") ?? undefined,
        settlement_due_date: optDate(formData, "settlement_due_date"),
        return_by_date: optDate(formData, "return_by_date"),
        note: optStr(formData, "note"),
        created_by: await userId(),
      })
      .select("id")
      .single(),
    "Tạo phiếu gửi ký gửi"
  );
  const raw = zipItems(formData, ["batch_id", "qty", "term", "transfer_price"]).filter(
    (r) => r.batch_id && Number(r.qty) > 0
  );
  if (!raw.length) throw new Error("Phiếu cần ít nhất một dòng lô hàng.");
  const items = [];
  for (const r of raw) {
    const fromLocation = await mainOwnLocationOfBatch(supabase, r.batch_id);
    if (!fromLocation)
      throw new Error("Một lô đã chọn không còn hàng tại kho của mình.");
    items.push({
      slip_id: slip.id,
      batch_id: r.batch_id,
      from_location_id: fromLocation,
      qty: Math.trunc(Number(r.qty)),
      term: r.term || "CONSIGNMENT",
      transfer_price: Number(r.transfer_price),
    });
  }
  done(await supabase.from("consignment_out_items").insert(items), "Thêm dòng phiếu");
  revalidatePath("/consignment-out");
  redirect("/consignment-out?ok=1");
}

export async function confirmConsignmentOutAction(formData: FormData) {
  const supabase = await db();
  const { error } = await supabase.rpc("confirm_consignment_out", {
    p_slip_id: str(formData, "id"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/consignment-out");
  revalidatePath("/inventory");
}

// ------------------------------------------------------------------ sales
export async function createCounterSaleAction(formData: FormData) {
  const supabase = await db();
  const lines = zipItems(formData, ["batch_id", "qty", "unit_price"]).filter(
    (r) => r.batch_id && Number(r.qty) > 0
  );
  if (!lines.length) throw new Error("Đơn bán cần ít nhất một dòng lô hàng.");

  const batchIds = lines.map((l) => l.batch_id);
  const { data: batches, error } = await supabase
    .from("stock_batches")
    .select("id, product_id, ownership")
    .in("id", batchIds);
  if (error) throw new Error(error.message);
  const batchMap = new Map((batches ?? []).map((b: AnyRow) => [b.id, b]));

  const partnerId = optStr(formData, "partner_id");
  const order = must(
    await supabase
      .from("sales_orders")
      .insert({
        partner_id: partnerId,
        customer_name: optStr(formData, "customer_name"),
        created_by: await userId(),
      })
      .select("id")
      .single(),
    "Tạo đơn bán hàng"
  );

  const groups: Record<string, AnyRow[]> = { BH: [], KG: [] };
  for (const l of lines) {
    const batch = batchMap.get(l.batch_id);
    if (!batch) throw new Error("Không tìm thấy lô hàng.");
    const fromLocation = await mainOwnLocationOfBatch(supabase, l.batch_id);
    if (!fromLocation) throw new Error("Một lô đã chọn không còn hàng tại kho của mình.");
    groups[batch.ownership === "OWNED" ? "BH" : "KG"].push({
      product_id: batch.product_id,
      batch_id: l.batch_id,
      from_location_id: fromLocation,
      qty: Math.trunc(Number(l.qty)),
      unit_price: Number(l.unit_price),
    });
  }

  const discountRequested = num(formData, "discount_amount");
  let orderTotal = 0;
  for (const kind of ["BH", "KG"] as const) {
    const docLines = groups[kind];
    if (!docLines.length) continue;
    const subtotal = docLines.reduce((a, l) => a + l.qty * l.unit_price, 0);
    const discount = kind === "BH" ? Math.min(discountRequested, subtotal) : 0;
    const doc = must(
      await supabase
        .from("sales_documents")
        .insert({
          doc_kind: kind,
          sales_order_id: order.id,
          partner_id: partnerId,
          customer_name: optStr(formData, "customer_name"),
          is_credit: formData.get("is_credit") === "on",
          discount_amount: discount,
          created_by: await userId(),
        })
        .select("id")
        .single(),
      `Tạo chứng từ ${kind}`
    );
    done(
      await supabase.from("sales_document_lines").insert(
        docLines.map((l) => ({ ...l, document_id: doc.id }))
      ),
      "Thêm dòng chứng từ"
    );
    const { error: rpcError } = await supabase.rpc("confirm_sales_document", {
      p_doc_id: doc.id,
    });
    if (rpcError) throw new Error(rpcError.message);
    orderTotal += subtotal - discount;
  }

  await supabase
    .from("sales_orders")
    .update({ total_amount: orderTotal, status: "CONFIRMED" })
    .eq("id", order.id);
  revalidatePath("/sales");
  revalidatePath("/inventory");
  revalidatePath("/payables");
  revalidatePath("/receivables");
  redirect("/sales?ok=1");
}

// ------------------------------------------------- partner consumption
export async function createConsumptionReportAction(formData: FormData) {
  const supabase = await db();
  const report = must(
    await supabase
      .from("consumption_reports")
      .insert({
        partner_id: str(formData, "partner_id"),
        period_from: str(formData, "period_from"),
        period_to: str(formData, "period_to"),
        note: optStr(formData, "note"),
        created_by: await userId(),
      })
      .select("id")
      .single(),
    "Tạo báo cáo tiêu thụ"
  );
  const items = zipItems(formData, ["product_id", "qty_consumed"])
    .filter((r) => r.product_id && Number(r.qty_consumed) > 0)
    .map((r) => ({
      report_id: report.id,
      product_id: r.product_id,
      qty_consumed: Math.trunc(Number(r.qty_consumed)),
    }));
  if (!items.length) throw new Error("Báo cáo cần ít nhất một dòng hàng.");
  done(await supabase.from("consumption_report_items").insert(items), "Thêm dòng báo cáo");
  revalidatePath("/partner-consumption");
  redirect("/partner-consumption?ok=1");
}

export async function setConsumptionReportStatusAction(formData: FormData) {
  const supabase = await db();
  done(
    await supabase
      .from("consumption_reports")
      .update({ status: str(formData, "status") })
      .eq("id", str(formData, "id")),
    "Cập nhật trạng thái báo cáo"
  );
  revalidatePath("/partner-consumption");
}

export async function createAllocationAction(formData: FormData) {
  const supabase = await db();
  const slip = must(
    await supabase
      .from("allocation_slips")
      .insert({
        report_id: optStr(formData, "report_id"),
        partner_id: str(formData, "partner_id"),
        note: optStr(formData, "note"),
        created_by: await userId(),
      })
      .select("id")
      .single(),
    "Tạo phiếu phân bổ"
  );
  const lines = zipItems(formData, ["product_id", "batch_id", "nature", "qty", "unit_price"])
    .filter((r) => r.batch_id && r.product_id && Number(r.qty) > 0)
    .map((r) => ({
      allocation_id: slip.id,
      product_id: r.product_id,
      batch_id: r.batch_id,
      nature: r.nature || "CONSIGNED",
      qty: Math.trunc(Number(r.qty)),
      unit_price: Number(r.unit_price),
    }));
  if (!lines.length) throw new Error("Phiếu phân bổ cần ít nhất một dòng.");
  done(await supabase.from("allocation_lines").insert(lines), "Thêm dòng phân bổ");
  revalidatePath("/partner-consumption");
  redirect(`/partner-consumption/allocations/${slip.id}?ok=1`);
}

export async function confirmAllocationAction(formData: FormData) {
  const supabase = await db();
  const { error } = await supabase.rpc("confirm_allocation", {
    p_allocation_id: str(formData, "id"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/partner-consumption");
}

/** Turn a CONFIRMED allocation into BH/KG documents (one per nature), then confirm them. */
export async function createAllocationDocumentsAction(formData: FormData) {
  const supabase = await db();
  const allocationId = str(formData, "id");
  const { data: slip, error } = await supabase
    .from("allocation_slips")
    .select("*")
    .eq("id", allocationId)
    .single();
  if (error) throw new Error(error.message);
  if (slip.status !== "CONFIRMED")
    throw new Error("Phiếu phân bổ phải ở trạng thái Đã xác nhận trước khi tạo chứng từ.");

  const { data: lines } = await supabase
    .from("allocation_lines")
    .select("*")
    .eq("allocation_id", allocationId);
  const lineIds = (lines ?? []).map((l: AnyRow) => l.id);
  const { data: existing } = await supabase
    .from("sales_document_lines")
    .select("allocation_line_id")
    .in("allocation_line_id", lineIds);
  const doneSet = new Set((existing ?? []).map((r: AnyRow) => r.allocation_line_id));
  const pending = (lines ?? []).filter((l: AnyRow) => !doneSet.has(l.id));
  if (!pending.length) throw new Error("Mọi dòng phân bổ đều đã có chứng từ.");

  const fromLocation = await partnerLocationId(supabase, slip.partner_id);
  if (!fromLocation) throw new Error("Không tìm thấy kho ảo của đối tác.");

  const groups: Record<string, AnyRow[]> = { BH: [], KG: [] };
  for (const l of pending) {
    groups[l.nature === "PURCHASED" ? "BH" : "KG"].push(l);
  }
  for (const kind of ["BH", "KG"] as const) {
    const group = groups[kind];
    if (!group.length) continue;
    const doc = must(
      await supabase
        .from("sales_documents")
        .insert({
          doc_kind: kind,
          allocation_id: allocationId,
          partner_id: slip.partner_id,
          is_credit: true,
          created_by: await userId(),
        })
        .select("id")
        .single(),
      `Tạo chứng từ ${kind}`
    );
    done(
      await supabase.from("sales_document_lines").insert(
        group.map((l: AnyRow) => ({
          document_id: doc.id,
          product_id: l.product_id,
          batch_id: l.batch_id,
          allocation_line_id: l.id,
          from_location_id: fromLocation,
          qty: l.qty,
          unit_price: l.unit_price,
        }))
      ),
      "Thêm dòng chứng từ"
    );
    const { error: rpcError } = await supabase.rpc("confirm_sales_document", {
      p_doc_id: doc.id,
    });
    if (rpcError) throw new Error(rpcError.message);
  }
  revalidatePath("/partner-consumption");
  revalidatePath("/invoices");
  revalidatePath("/receivables");
  redirect(`/partner-consumption/allocations/${allocationId}?ok=1`);
}

// ---------------------------------------------------------------- invoices
export async function createVatInvoiceAction(formData: FormData) {
  const supabase = await db();
  const lineIds = formData.getAll("line_id").map((v) => String(v));
  if (!lineIds.length) throw new Error("Chọn ít nhất một dòng chứng từ để xuất hoá đơn.");
  const { error } = await supabase.rpc("create_vat_invoice", {
    p_partner_id: optStr(formData, "partner_id"),
    p_invoice_no: str(formData, "invoice_no"),
    p_symbol: str(formData, "symbol"),
    p_invoice_date: str(formData, "invoice_date"),
    p_provider: optStr(formData, "provider"),
    p_line_ids: lineIds,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/invoices");
  revalidatePath("/partner-consumption");
  redirect("/invoices?ok=1");
}

export async function cancelVatInvoiceAction(formData: FormData) {
  const supabase = await db();
  const { error } = await supabase.rpc("cancel_vat_invoice", {
    p_invoice_id: str(formData, "id"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/invoices");
  revalidatePath("/partner-consumption");
}

// ----------------------------------------------------------------- returns
export async function createReturnAction(formData: FormData) {
  const supabase = await db();
  const kind = str(formData, "return_kind");
  const partnerId = optStr(formData, "partner_id");
  const doc = must(
    await supabase
      .from("return_documents")
      .insert({
        return_kind: kind,
        partner_id: partnerId,
        supplier_id: optStr(formData, "supplier_id"),
        note: optStr(formData, "note"),
        created_by: await userId(),
      })
      .select("id")
      .single(),
    "Tạo phiếu trả hàng"
  );
  const raw = zipItems(formData, ["batch_id", "qty", "reason"]).filter(
    (r) => r.batch_id && Number(r.qty) > 0
  );
  if (!raw.length) throw new Error("Phiếu trả cần ít nhất một dòng lô hàng.");
  const defaultWh = await defaultWarehouseId(supabase);
  const items = [];
  for (const r of raw) {
    let fromLocation: string | null = null;
    let toLocation: string | null = null;
    if (kind === "CUSTOMER_RETURN") {
      toLocation = defaultWh ?? null;
    } else if (kind === "PARTNER_RETURN") {
      if (!partnerId) throw new Error("Trả hàng từ đối tác cần chọn đối tác.");
      fromLocation = (await partnerLocationId(supabase, partnerId)) ?? null;
      toLocation = defaultWh ?? null;
    } else if (kind === "SUPPLIER_RETURN") {
      fromLocation = (await mainOwnLocationOfBatch(supabase, r.batch_id)) ?? null;
    }
    items.push({
      return_id: doc.id,
      batch_id: r.batch_id,
      from_location_id: fromLocation,
      to_location_id: toLocation,
      qty: Math.trunc(Number(r.qty)),
      reason: r.reason || "OTHER",
    });
  }
  done(await supabase.from("return_items").insert(items), "Thêm dòng trả hàng");
  revalidatePath("/returns");
  redirect("/returns?ok=1");
}

export async function confirmReturnAction(formData: FormData) {
  const supabase = await db();
  const { error } = await supabase.rpc("confirm_return_document", {
    p_return_id: str(formData, "id"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/returns");
  revalidatePath("/inventory");
}

// ------------------------------------------------------- payables / money
export async function recordPayablePaymentAction(formData: FormData) {
  const supabase = await db();
  done(
    await supabase.from("payments").insert({
      payment_kind: "OUT",
      payable_id: str(formData, "payable_id"),
      amount: num(formData, "amount"),
      method: str(formData, "method") || "BANK",
      payment_date: optDate(formData, "payment_date") ?? undefined,
      note: optStr(formData, "note"),
      created_by: await userId(),
    }),
    "Ghi nhận thanh toán"
  );
  revalidatePath("/payables");
  redirect("/payables?ok=1");
}

export async function recordReceivablePaymentAction(formData: FormData) {
  const supabase = await db();
  done(
    await supabase.from("payments").insert({
      payment_kind: "IN",
      receivable_id: str(formData, "receivable_id"),
      amount: num(formData, "amount"),
      method: str(formData, "method") || "BANK",
      payment_date: optDate(formData, "payment_date") ?? undefined,
      note: optStr(formData, "note"),
      created_by: await userId(),
    }),
    "Ghi nhận thu tiền"
  );
  revalidatePath("/receivables");
  redirect("/receivables?ok=1");
}

export async function createSettlementAction(formData: FormData) {
  const supabase = await db();
  const partyKind = str(formData, "party_kind");
  const isSupplier = partyKind === "SUPPLIER";
  const selectedIds = formData
    .getAll(isSupplier ? "payable_id" : "receivable_id")
    .map((v) => String(v));
  if (!selectedIds.length) throw new Error("Chọn ít nhất một dòng công nợ đang mở.");

  const table = isSupplier ? "supplier_payables" : "partner_receivables";
  const { data: balances, error } = await supabase
    .from(table)
    .select("id, amount, amount_paid")
    .in("id", selectedIds);
  if (error) throw new Error(error.message);
  const total = (balances ?? []).reduce(
    (a: number, b: AnyRow) => a + Number(b.amount) - Number(b.amount_paid),
    0
  );
  const settlement = must(
    await supabase
      .from("settlements")
      .insert({
        party_kind: partyKind,
        supplier_id: isSupplier ? str(formData, "supplier_id") : null,
        partner_id: isSupplier ? null : str(formData, "partner_id"),
        period_from: optDate(formData, "period_from"),
        period_to: optDate(formData, "period_to"),
        total_amount: total,
        status: "CONFIRMED",
        note: optStr(formData, "note"),
        created_by: await userId(),
      })
      .select("id")
      .single(),
    "Tạo đợt đối soát"
  );
  done(
    await supabase.from("settlement_lines").insert(
      (balances ?? []).map((b: AnyRow) => ({
        settlement_id: settlement.id,
        payable_id: isSupplier ? b.id : null,
        receivable_id: isSupplier ? null : b.id,
        amount: Number(b.amount) - Number(b.amount_paid),
      }))
    ),
    "Thêm dòng đối soát"
  );
  revalidatePath(isSupplier ? "/payables" : "/receivables");
  redirect(`${isSupplier ? "/payables" : "/receivables"}?ok=1`);
}

// ---------------------------------------------------------------- settings
export async function updateVatModeAction(formData: FormData) {
  const supabase = await db();
  done(
    await supabase.from("app_settings").upsert({
      key: "vat_invoice_mode",
      value: str(formData, "vat_invoice_mode") || "COMBINED",
    }),
    "Lưu cài đặt"
  );
  revalidatePath("/settings");
}

export async function createStockAdjustmentAction(formData: FormData) {
  const supabase = await db();
  const { error } = await supabase.rpc("create_stock_adjustment", {
    p_batch_id: str(formData, "batch_id"),
    p_location_id: str(formData, "location_id"),
    p_qty_delta: Math.trunc(num(formData, "qty_delta")),
    p_note: optStr(formData, "note"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/inventory");
  redirect("/inventory?ok=1");
}

// ---------------------------------------------------- quản lý tài khoản
// Chỉ OWNER. Các thao tác đụng tới Supabase Auth (mời/tạo/khoá/xoá tài
// khoản) đi qua service-role client phía máy chủ; mọi action đều tự kiểm
// tra lại vai trò của người gọi, không dựa vào giao diện.

const APP_ROLES = ["OWNER", "SALES", "WAREHOUSE", "ACCOUNTING"];

async function requireOwnerAdmin() {
  const supabase = await db();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Bạn chưa đăng nhập.");
  const { data: me } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!me || me.role !== "OWNER")
    throw new Error("Chỉ Chủ cửa hàng mới quản lý được tài khoản.");
  const admin = createAdminClient();
  if (!admin)
    throw new Error(
      "Tính năng quản lý tài khoản chưa được bật (thiếu khoá quản trị phía máy chủ)."
    );
  return { admin, meId: user.id as string };
}

async function countOwners(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  activeOnly = false
): Promise<number> {
  let q = admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "OWNER");
  if (activeOnly) q = q.eq("is_active", true);
  const { count } = await q;
  return count ?? 0;
}

async function getTargetProfile(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  id: string
) {
  const { data } = await admin
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new Error("Không tìm thấy tài khoản.");
  return data as AnyRow;
}

export async function inviteUserAction(formData: FormData) {
  const { admin } = await requireOwnerAdmin();
  const email = str(formData, "email").toLowerCase();
  const fullName = str(formData, "full_name");
  const role = str(formData, "role") || "SALES";
  const usernameRaw = optStr(formData, "username");
  const username = usernameRaw ? usernameRaw.toLowerCase() : null;
  const mode = str(formData, "mode"); // "invite" | "password"
  if (!email || !fullName) throw new Error("Cần nhập email và họ tên.");
  if (!APP_ROLES.includes(role)) throw new Error("Vai trò không hợp lệ.");

  let newUserId: string | null = null;
  if (mode === "password") {
    const password = str(formData, "password");
    if (password.length < 8)
      throw new Error("Mật khẩu tạm phải có ít nhất 8 ký tự.");
    const res = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (res.error) throw new Error(`Tạo tài khoản: ${res.error.message}`);
    newUserId = res.data.user?.id ?? null;
  } else {
    // Không truyền redirectTo: link mời dùng Site URL đã cấu hình sẵn
    // (trỏ về trang đặt mật khẩu trên production).
    const res = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
    });
    if (res.error) throw new Error(`Mời tài khoản: ${res.error.message}`);
    newUserId = res.data.user?.id ?? null;
  }
  if (!newUserId) throw new Error("Không tạo được tài khoản.");

  const ins = await admin
    .from("profiles")
    .insert({ id: newUserId, email, full_name: fullName, role, username });
  if (ins.error) {
    // Gỡ tài khoản auth vừa tạo để không bỏ lại tài khoản mồ côi.
    await admin.auth.admin.deleteUser(newUserId);
    throw new Error(`Tạo hồ sơ: ${ins.error.message}`);
  }
  revalidatePath("/settings");
}

export async function updateUserRoleAction(formData: FormData) {
  const { admin, meId } = await requireOwnerAdmin();
  const id = str(formData, "profile_id");
  const role = str(formData, "role");
  if (!APP_ROLES.includes(role)) throw new Error("Vai trò không hợp lệ.");
  if (id === meId)
    throw new Error("Bạn không thể tự đổi vai trò của chính mình.");
  const target = await getTargetProfile(admin, id);
  if (target.role === "OWNER" && role !== "OWNER") {
    if ((await countOwners(admin)) <= 1)
      throw new Error("Hệ thống cần ít nhất một Chủ cửa hàng.");
  }
  done(
    await admin.from("profiles").update({ role }).eq("id", id),
    "Đổi vai trò"
  );
  revalidatePath("/settings");
}

export async function setUserActiveAction(formData: FormData) {
  const { admin, meId } = await requireOwnerAdmin();
  const id = str(formData, "profile_id");
  const active = str(formData, "active") === "1";
  if (id === meId && !active)
    throw new Error("Bạn không thể tự khoá tài khoản của mình.");
  const target = await getTargetProfile(admin, id);
  if (!active && target.role === "OWNER" && target.is_active) {
    if ((await countOwners(admin, true)) <= 1)
      throw new Error("Không thể khoá Chủ cửa hàng đang hoạt động cuối cùng.");
  }
  done(
    await admin.from("profiles").update({ is_active: active }).eq("id", id),
    "Cập nhật trạng thái tài khoản"
  );
  const ban = await admin.auth.admin.updateUserById(id, {
    ban_duration: active ? "none" : "876000h",
  });
  if (ban.error) throw new Error(`Khoá/mở đăng nhập: ${ban.error.message}`);
  revalidatePath("/settings");
}

export async function resetUserPasswordAction(formData: FormData) {
  await requireOwnerAdmin();
  const email = str(formData, "email").toLowerCase();
  if (!email) throw new Error("Tài khoản không có email.");
  const supabase = await db();
  const origin = headers().get("origin");
  const res = await supabase.auth.resetPasswordForEmail(
    email,
    origin ? { redirectTo: `${origin}/auth/set-password` } : undefined
  );
  if (res.error)
    throw new Error(`Gửi email đặt lại mật khẩu: ${res.error.message}`);
  revalidatePath("/settings");
}

export async function deleteUserAction(formData: FormData) {
  const { admin, meId } = await requireOwnerAdmin();
  const id = str(formData, "profile_id");
  if (id === meId)
    throw new Error("Bạn không thể tự xoá tài khoản của mình.");
  const target = await getTargetProfile(admin, id);
  if (target.role === "OWNER") {
    if ((await countOwners(admin)) <= 1)
      throw new Error("Không thể xoá Chủ cửa hàng cuối cùng.");
  }
  const res = await admin.auth.admin.deleteUser(id);
  if (res.error) throw new Error(`Xoá tài khoản: ${res.error.message}`);
  // Dòng profiles tự xoá theo khoá ngoại (on delete cascade).
  revalidatePath("/settings");
}
