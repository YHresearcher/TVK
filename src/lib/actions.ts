"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { todayISO } from "@/lib/format";
import { compareLotOrder, isOilGroup, matchByNameVehicle, tierPriceOf } from "@/lib/product-match";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AnyRow } from "@/lib/types";
import { priceTierForKind, type PriceTier } from "@/lib/types";

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

/** Ngày YYYY-MM-DD hợp lệ theo lịch thì giữ, còn lại trả null. */
function validDate(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
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

/** Chuẩn hoá mã tra cứu: hoa hết, bỏ mọi khoảng trắng (kể cả xuống dòng
 * trong ô Excel) — cùng luật với normCode, để mã gõ tay, mã quét và mã
 * trong file đều khớp một mã đã lưu. */
function normKey(v: unknown): string {
  return String(v ?? "")
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Mã để LƯU vào danh mục: gộp mọi khoảng trắng trong ô (kể cả xuống
 * dòng) thành một dấu cách — mã lưu luôn sạch để hiển thị, in tem, quét. */
function storeCode(v: string): string {
  return v.trim().replace(/\s+/g, " ");
}

/** Từ chối cả file import khi có dòng không hợp lệ (không nhập một phần). */
function rejectImport(invalid: string[]): never {
  throw new Error(
    `Import bị từ chối: ${invalid.length} dòng không hợp lệ (${invalid
      .slice(0, 5)
      .join(", ")}${invalid.length > 5 ? "…" : ""}). Hãy sửa file Excel theo đúng định dạng chuẩn rồi tải lại — hệ thống không nhập một phần.`
  );
}

/**
 * Vị trí kho mình đang giữ nhiều nhất của mỗi lô, lấy trong MỘT query cho
 * nhiều lô — dùng chung cho form tay (hết N+1 gọi từng lô) và import.
 */
async function mainOwnLocations(
  supabase: AnyRow,
  batchIds: string[]
): Promise<Map<string, { locationId: string; qty: number }>> {
  const uniq = Array.from(new Set(batchIds.filter(Boolean)));
  const map = new Map<string, { locationId: string; qty: number }>();
  if (!uniq.length) return map;
  const { data, error } = await supabase
    .from("batch_locations")
    .select("batch_id, location_id, qty, locations(location_kind)")
    .in("batch_id", uniq)
    .order("qty", { ascending: false });
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as AnyRow[]) {
    if ((r.locations as AnyRow)?.location_kind !== "OWN_WAREHOUSE") continue;
    const id = r.batch_id as string;
    if (map.has(id)) continue; // đã có vị trí giữ nhiều nhất (qty giảm dần)
    map.set(id, { locationId: r.location_id as string, qty: Number(r.qty) || 0 });
  }
  return map;
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
        product_group: optStr(formData, "product_group"),
        sae_viscosity: optStr(formData, "sae_viscosity"),
        api_standard: optStr(formData, "api_standard"),
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

/** Sửa thông tin hàng hoá (tên, thương hiệu, nhóm hàng, đơn vị, tồn tối thiểu). Mã SKU
 * không sửa được — nó là chìa khoá khớp hàng của import, quầy bán và tem
 * mã vạch. Quyền sửa khớp đúng RLS của bảng products: chỉ Chủ cửa hàng
 * và Thủ kho; CEO và các vai trò còn lại bị chặn ngay ở đây. */
export async function updateProductInfoAction(productId: string, formData: FormData) {
  const supabase = await db();
  const uid = await userId();
  if (!uid) throw new Error("Chưa đăng nhập.");
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (prof?.role !== "OWNER" && prof?.role !== "WAREHOUSE")
    throw new Error("Chỉ Chủ cửa hàng và Thủ kho mới sửa được thông tin hàng hoá.");
  const name = str(formData, "name");
  const unit = str(formData, "unit");
  if (!name) throw new Error("Cần nhập tên hàng.");
  if (!unit) throw new Error("Cần nhập đơn vị tính.");
  done(
    await supabase.from("products").update({
      name,
      brand: optStr(formData, "brand"),
      product_group: optStr(formData, "product_group"),
      sae_viscosity: optStr(formData, "sae_viscosity"),
      api_standard: optStr(formData, "api_standard"),
      unit,
      min_stock: Math.max(0, Math.trunc(num(formData, "min_stock"))),
    }).eq("id", productId),
    "Cập nhật thông tin hàng hoá"
  );
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
}

export async function updateProductPricesAction(productId: string, formData: FormData) {
  const supabase = await db();
  const uid = await userId();
  if (!uid) throw new Error("Chưa đăng nhập.");
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (prof?.role === "CEO") throw new Error("Vai trò chỉ xem không được sửa giá.");
  const price = (name: string) => Math.max(0, Math.trunc(num(formData, name)));
  done(
    await supabase.from("products").update({
      retail_price: price("retail_price"),
      garage_price: price("garage_price"),
      wholesale_price: price("wholesale_price"),
    }).eq("id", productId),
    "Cập nhật giá sản phẩm"
  );
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
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

export async function updateSupplierAction(formData: FormData) {
  const supabase = await db();
  const uid = await userId();
  if (!uid) throw new Error("Chưa đăng nhập.");
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (!prof || !["OWNER", "ACCOUNTING"].includes(prof.role))
    throw new Error("Vai trò của bạn không được sửa nhà cung cấp.");
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!id || !name) throw new Error("Thiếu mã hoặc tên nhà cung cấp.");
  done(
    await supabase.from("suppliers").update({
      name,
      contact_name: optStr(formData, "contact_name"),
      phone: optStr(formData, "phone"),
      email: optStr(formData, "email"),
      address: optStr(formData, "address"),
      tax_code: optStr(formData, "tax_code"),
      consignment_pay_days: Math.trunc(num(formData, "consignment_pay_days") || 30),
      consignment_return_days: Math.trunc(num(formData, "consignment_return_days") || 90),
      allow_sub_consignment: formData.get("allow_sub_consignment") === "on",
      notes: optStr(formData, "notes"),
    }).eq("id", id),
    "Cập nhật nhà cung cấp"
  );
  revalidatePath("/suppliers");
  redirect("/suppliers?ok=1");
}

export async function updatePartnerAction(formData: FormData) {
  const supabase = await db();
  const uid = await userId();
  if (!uid) throw new Error("Chưa đăng nhập.");
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (!prof || !["OWNER", "ACCOUNTING", "SALES"].includes(prof.role))
    throw new Error("Vai trò của bạn không được sửa đối tác.");
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!id || !name) throw new Error("Thiếu mã hoặc tên đối tác.");
  done(
    await supabase.from("partners").update({
      name,
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
    }).eq("id", id),
    "Cập nhật đối tác"
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

export async function updateWarehouseAction(formData: FormData) {
  const supabase = await db();
  const uid = await userId();
  if (!uid) throw new Error("Chưa đăng nhập.");
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (!prof || !["OWNER", "WAREHOUSE"].includes(prof.role))
    throw new Error("Vai trò của bạn không được sửa kho.");
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!id || !name) throw new Error("Thiếu mã hoặc tên kho.");
  const { data: loc } = await supabase
    .from("locations")
    .select("id")
    .eq("id", id)
    .eq("location_kind", "OWN_WAREHOUSE")
    .maybeSingle();
  if (!loc) throw new Error("Không tìm thấy kho của TVK.");
  done(
    await supabase.from("locations").update({
      name,
      detail: optStr(formData, "detail"),
    }).eq("id", id),
    "Cập nhật kho"
  );
  revalidatePath("/settings");
  revalidatePath("/stock-in");
  redirect("/settings");
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
  const items = zipItems(formData, ["product_id", "qty", "unit_cost", "expiry_date"])
    .filter((r) => r.product_id && Number(r.qty) > 0)
    .map((r) => ({
      receipt_id: receipt.id,
      product_id: r.product_id,
      qty: Math.trunc(Number(r.qty)),
      unit_cost: Number(r.unit_cost),
      expiry_date: validDate(String(r.expiry_date ?? "")),
    }));
  if (!items.length) throw new Error("Phiếu nhập cần ít nhất một dòng hàng.");
  done(await supabase.from("purchase_receipt_items").insert(items), "Thêm dòng phiếu nhập");
  // Tick "Xác nhận ngay": xác nhận luôn trong cùng một thao tác, không để
  // lại phiếu nháp — cùng cách làm như import (xác nhận ngay).
  if (formData.get("confirm_now") === "on") {
    const { error } = await supabase.rpc("confirm_purchase_receipt", {
      p_receipt_id: receipt.id,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/inventory");
  }
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

// Xoá phiếu nhập (PN/NK) — chỉ Chủ cửa hàng. Hàm delete_receipt kiểm
// tra quyền và chặn khi lô đã phát sinh nghiệp vụ; lỗi quay lại trang
// kèm thông báo thay vì trang lỗi.
export async function deleteReceiptAction(formData: FormData) {
  const supabase = await db();
  const uid = await userId();
  if (!uid) throw new Error("Chưa đăng nhập.");
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (!prof || prof.role !== "OWNER")
    throw new Error("Chỉ chủ cửa hàng mới được xoá phiếu nhập.");
  const id = str(formData, "id");
  const kind = str(formData, "kind");
  const tab = str(formData, "tab") === "consignment" ? "consignment" : "purchase";
  if (!id || (kind !== "PN" && kind !== "NK")) throw new Error("Thiếu thông tin phiếu cần xoá.");
  const { error } = await supabase.rpc("delete_receipt", {
    p_receipt_id: id,
    p_kind: kind,
  });
  if (error) redirect(`/stock-in?tab=${tab}&error=${encodeURIComponent(error.message)}`);
  revalidatePath("/stock-in");
  revalidatePath("/inventory");
  redirect(`/stock-in?tab=${tab}&ok=1`);
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
  const items = zipItems(formData, ["product_id", "qty", "consignment_price", "expiry_date"])
    .filter((r) => r.product_id && Number(r.qty) > 0)
    .map((r) => ({
      receipt_id: receipt.id,
      product_id: r.product_id,
      qty: Math.trunc(Number(r.qty)),
      consignment_price: Number(r.consignment_price),
      expiry_date: validDate(String(r.expiry_date ?? "")),
    }));
  if (!items.length) throw new Error("Phiếu nhập cần ít nhất một dòng hàng.");
  done(await supabase.from("consignment_receipt_items").insert(items), "Thêm dòng phiếu nhập");
  // Tick "Xác nhận ngay": xác nhận luôn trong cùng một thao tác, không để
  // lại phiếu nháp — cùng cách làm như import (xác nhận ngay).
  if (formData.get("confirm_now") === "on") {
    const { error } = await supabase.rpc("confirm_consignment_receipt", {
      p_receipt_id: receipt.id,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/inventory");
  }
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

// ------------------------------------------------------- import từ Excel
interface ImportPayloadRow {
  code?: unknown;
  altCodes?: unknown;
  name?: unknown;
  brand?: unknown;
  fitment?: unknown;
  unit?: unknown;
  qty?: unknown;
  usd?: unknown;
  expiry?: unknown;
}

/**
 * Import a whole stock-in receipt (PN or NK) from a JSON payload produced by
 * the /import page. Prices are recomputed here — the client's preview is
 * never trusted. Tỷ giá, VAT, % lợi nhuận and % giá bán lẻ from the form
 * apply to the whole file: unit cost = GiaUSD × Tỷ giá × (1 + VAT%),
 * dealer price = unit cost × (1 + Lợi nhuận%), retail price = unit cost ×
 * (1 + % giá bán lẻ). Dealer and retail prices become wholesale_price and
 * retail_price of auto-created products. The receipt also stores rounding_adjustment
 * (migration 0010): round(sum of exact line values) minus sum of rounded
 * lines, so the receipt total matches the accountant's convention while
 * per-line prices stay invoice-compatible. Products are matched by primary
 * code or any equivalent code; unknown codes can optionally auto-create
 * the product (codes + fitment too).
 */
export async function importStockAction(formData: FormData) {
  const supabase = await db();
  let payload: AnyRow;
  try {
    payload = JSON.parse(str(formData, "payload"));
  } catch {
    throw new Error("Dữ liệu import không hợp lệ.");
  }
  const kind = payload.kind === "NK" ? "NK" : "PN";
  const supplierId = String(payload.supplierId ?? "");
  const warehouseId = String(payload.warehouseId ?? "");
  if (!supplierId) throw new Error("Cần chọn nhà cung cấp.");
  if (!warehouseId) throw new Error("Cần chọn kho nhập.");
  const tyGia = Number(payload.tyGia) || 0;
  const vatPct = Number(payload.vatPct) || 0;
  const profitPct = Number(payload.profitPct) || 0;
  const retailPct = Number(payload.retailPct) || 0;
  const autoCreate = !!payload.autoCreate;
  const confirmNow = !!payload.confirmNow;
  const productGroup = String(payload.productGroup ?? "").trim() || null;
  const rawRows: ImportPayloadRow[] = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rawRows.length) throw new Error("File không có dòng nào để nhập.");

  // Catalog snapshots for matching (case-insensitive, trimmed).
  const { data: allProducts } = await supabase.from("products").select("id, sku").limit(5000);
  const { data: allCodes } = await supabase.from("product_codes").select("code, product_id").limit(10000);
  const bySku = new Map<string, string>(
    ((allProducts ?? []) as AnyRow[]).map(
      (p): [string, string] => [normKey(p.sku), p.id as string]
    )
  );
  const byCode = new Map<string, string>(
    ((allCodes ?? []) as AnyRow[]).map(
      (c): [string, string] => [normKey(c.code), c.product_id as string]
    )
  );

  const items: { product_id: string; qty: number; unit_cost: number; expiry_date: string | null }[] = [];
  // Công thức phía máy chủ (không tin bản xem trước ở client), áp chung
  // cho toàn bộ file: Đơn giá nhập VNĐ = GiaUSD × Tỷ giá × (1 + VAT%),
  // giữ chính xác tới 4 số lẻ, KHÔNG làm tròn (migration 0014). Giá bán
  // vẫn làm tròn đồng chẵn như trước — chỉ giá vốn là tính chính xác.
  const rowPrices = (r: ImportPayloadRow): { unitCost: number; salePrice: number; retailPrice: number } => {
    const usd = Number(r.usd) || 0;
    const unitCost = usd > 0 ? usd * tyGia * (1 + vatPct / 100) : 0;
    return {
      unitCost,
      salePrice: Math.round(unitCost * (1 + profitPct / 100)),
      retailPrice: Math.round(unitCost * (1 + retailPct / 100)),
    };
  };
  // Không còn chênh lệch làm tròn (migration 0014): đơn giá giữ chính
  // xác nên tổng các dòng bằng đúng tổng chính xác. Cột
  // rounding_adjustment giữ lại làm chốt lịch sử, phiếu mới luôn ghi 0.
  // Kiểm soát phía máy chủ: kiểm tra TOÀN BỘ file trước khi ghi bất cứ thứ
  // gì. Bất kỳ dòng nào không hợp lệ cũng từ chối cả import (không nhập
  // một phần, không tạo sản phẩm dở dang), kể cả khi giao diện bị bỏ qua.
  const invalid: string[] = [];
  for (const r of rawRows) {
    const code = storeCode(String(r.code ?? ""));
    const qty = Math.trunc(Number(r.qty) || 0);
    const { unitCost } = rowPrices(r);
    if (!code || qty <= 0 || unitCost <= 0) {
      invalid.push(code || "(dòng thiếu mã)");
      continue;
    }
    // Hạn dùng: máy chủ không tin bản xem trước ở client — ô có ghi mà
    // không phải ngày YYYY-MM-DD hợp lệ thì từ chối cả file.
    const expRaw = String(r.expiry ?? "").trim();
    if (expRaw && !validDate(expRaw)) {
      invalid.push(code);
      continue;
    }
    const altCodes = (Array.isArray(r.altCodes) ? r.altCodes : [])
      .map((a) => storeCode(String(a ?? "")))
      .filter(Boolean);
    let found = bySku.get(normKey(code)) ?? byCode.get(normKey(code));
    if (!found) {
      for (const alt of altCodes) {
        found = bySku.get(normKey(alt)) ?? byCode.get(normKey(alt));
        if (found) break;
      }
    }
    if (!found && (!autoCreate || !String(r.name ?? "").trim()))
      invalid.push(code);
  }
  if (invalid.length)
    rejectImport(invalid);

  // Ghi hàng loạt: gom sản phẩm mới, mã và dòng xe rồi chèn một lần thay
  // cho từng câu insert nối tiếp — thứ tự dòng, công thức giá và cách xử
  // lý mã trùng giữ nguyên như trước. Sản phẩm mới được ghi tạm bằng ref
  // "pending:<mã>" trong các map tra cứu, rồi đổi sang id thật sau câu
  // insert hàng loạt.
  const pendingKeys = new Set<string>();
  const pendingRows: {
    sku: string;
    name: string;
    brand: string | null;
    product_group: string | null;
    unit: string;
    retail_price: number;
    garage_price: number;
    wholesale_price: number;
    min_stock: number;
  }[] = [];
  const codeRows: { productRef: string; code: string; code_kind: string }[] = [];
  const fitmentReqs: { productRef: string; fitment: string }[] = [];
  const pendingItems: { productRef: string; qty: number; unit_cost: number; expiry_date: string | null }[] = [];
  const pendingRef = (sku: string) => `pending:${normKey(sku)}`;

  for (const r of rawRows) {
    const code = storeCode(String(r.code ?? ""));
    const qty = Math.trunc(Number(r.qty) || 0);
    const { unitCost, salePrice, retailPrice } = rowPrices(r);
    const altCodes = (Array.isArray(r.altCodes) ? r.altCodes : [])
      .map((a) => storeCode(String(a ?? "")))
      .filter(Boolean);
    if (!code || qty <= 0 || unitCost <= 0) continue; // đã chặn ở vòng kiểm tra trước

    let productRef = bySku.get(normKey(code)) ?? byCode.get(normKey(code));
    if (!productRef) {
      for (const alt of altCodes) {
        productRef = bySku.get(normKey(alt)) ?? byCode.get(normKey(alt));
        if (productRef) break;
      }
    }

    if (!productRef) {
      if (!autoCreate) continue; // đã chặn ở vòng kiểm tra trước
      if (!String(r.name ?? "").trim()) continue; // đã chặn ở vòng kiểm tra trước
      const ref = pendingRef(code);
      if (!pendingKeys.has(normKey(code))) {
        pendingKeys.add(normKey(code));
        pendingRows.push({
          sku: code,
          name: String(r.name ?? "").trim() || code,
          brand: String(r.brand ?? "").trim() || null,
          product_group: productGroup,
          unit: String(r.unit ?? "").trim() || "Cái",
          // Giá ban đầu của sản phẩm mới: Giá lẻ = Đơn giá nhập ×
          // (1 + % giá bán lẻ trên form); Giá đại lý = Đơn giá nhập ×
          // (1 + % lợi nhuận trên form).
          retail_price: retailPrice,
          garage_price: 0,
          wholesale_price: salePrice,
          min_stock: 0,
        });
      }
      productRef = ref;
      bySku.set(normKey(code), ref);

      // Primary code as OEM + every equivalent code; a code already
      // registered (to any product) stays as-is — same outcome as the
      // old per-row insert whose conflict was ignored.
      for (const cr of [
        { code, code_kind: "OEM" },
        ...altCodes
          .filter((a) => normKey(a) !== normKey(code))
          .map((a) => ({ code: a, code_kind: "EQUIVALENT" })),
      ]) {
        const key = normKey(cr.code);
        if (byCode.has(key)) continue;
        byCode.set(key, ref);
        codeRows.push({ productRef: ref, code: cr.code, code_kind: cr.code_kind });
      }

      // Fitment: the free-text "Dòng xe" goes into vehicles.model, mirroring
      // createFitmentAction's vehicle + product_fitments inserts.
      const fitment = String(r.fitment ?? "").trim();
      if (fitment) fitmentReqs.push({ productRef: ref, fitment });
    } else if (!byCode.has(normKey(code)) && bySku.get(normKey(code)) !== productRef) {
      // Matched via an equivalent code: register the row's primary code too.
      byCode.set(normKey(code), productRef);
      codeRows.push({ productRef, code, code_kind: "OEM" });
    }

    pendingItems.push({
      productRef,
      qty,
      unit_cost: unitCost,
      expiry_date: String(r.expiry ?? "").trim() ? validDate(String(r.expiry ?? "").trim()) : null,
    });
  }

  // Chèn hàng loạt: sản phẩm mới trước (lấy id thật), rồi mã và dòng xe.
  const refToId = new Map<string, string>();
  if (pendingRows.length) {
    const created = must(
      await supabase.from("products").insert(pendingRows).select("id, sku"),
      "Tạo sản phẩm từ import"
    );
    for (const p of created as AnyRow[])
      refToId.set(pendingRef(p.sku as string), p.id as string);
  }
  const resolveRef = (ref: string) => refToId.get(ref) ?? ref;
  if (codeRows.length) {
    done(
      await supabase.from("product_codes").insert(
        codeRows.map((cr) => ({
          product_id: resolveRef(cr.productRef),
          code: cr.code,
          code_kind: cr.code_kind,
        }))
      ),
      "Đăng ký mã hàng từ import"
    );
  }
  if (fitmentReqs.length) {
    const models = Array.from(new Set(fitmentReqs.map((f) => f.fitment)));
    const { data: existingVehicles } = await supabase
      .from("vehicles")
      .select("id, model")
      .eq("make", "")
      .in("model", models);
    const vehicleByModel = new Map(
      ((existingVehicles ?? []) as AnyRow[]).map((v) => [v.model as string, v.id as string])
    );
    const missing = models.filter((m) => !vehicleByModel.has(m));
    if (missing.length) {
      const inserted = await supabase
        .from("vehicles")
        .insert(
          missing.map((model) => ({
            make: "",
            model,
            year_from: null,
            year_to: null,
            engine: null,
          }))
        )
        .select("id, model");
      if (inserted.error) {
        // Đua với một import khác tạo cùng dòng xe: đọc lại là đủ.
        const { data: reread } = await supabase
          .from("vehicles")
          .select("id, model")
          .eq("make", "")
          .in("model", missing);
        for (const v of (reread ?? []) as AnyRow[])
          vehicleByModel.set(v.model as string, v.id as string);
      } else {
        for (const v of (inserted.data ?? []) as AnyRow[])
          vehicleByModel.set(v.model as string, v.id as string);
      }
    }
    const seenFitment = new Set<string>();
    const fitmentRows: { product_id: string; vehicle_id: string }[] = [];
    for (const f of fitmentReqs) {
      const vehicleId = vehicleByModel.get(f.fitment);
      if (!vehicleId) continue;
      const productId = resolveRef(f.productRef);
      const key = `${productId}|${vehicleId}`;
      if (seenFitment.has(key)) continue;
      seenFitment.add(key);
      fitmentRows.push({ product_id: productId, vehicle_id: vehicleId });
    }
    if (fitmentRows.length)
      await supabase.from("product_fitments").insert(fitmentRows);
  }

  for (const pi of pendingItems)
    items.push({ product_id: resolveRef(pi.productRef), qty: pi.qty, unit_cost: pi.unit_cost, expiry_date: pi.expiry_date });

  if (!items.length)
    throw new Error(
      "Không có dòng hợp lệ nào để nhập (kiểm tra mã hàng, số lượng và giá vốn)."
    );

  const roundingAdjustment = 0; // migration 0014: tính chính xác, không còn chênh lệch làm tròn

  const me = await userId();
  const receiptDate = String(payload.receiptDate ?? "").trim() || undefined;

  if (kind === "PN") {
    const receipt = must(
      await supabase
        .from("purchase_receipts")
        .insert({
          supplier_id: supplierId,
          warehouse_id: warehouseId,
          receipt_date: receiptDate,
          supplier_invoice_no: String(payload.supplierInvoiceNo ?? "").trim() || null,
          rounding_adjustment: roundingAdjustment,
          created_by: me,
        })
        .select("id")
        .single(),
      "Tạo phiếu nhập mua"
    );
    done(
      await supabase.from("purchase_receipt_items").insert(
        items.map((i) => ({
          receipt_id: receipt.id,
          product_id: i.product_id,
          qty: i.qty,
          unit_cost: i.unit_cost,
          expiry_date: i.expiry_date,
        }))
      ),
      "Thêm dòng phiếu nhập"
    );
    if (confirmNow) {
      const { error } = await supabase.rpc("confirm_purchase_receipt", {
        p_receipt_id: receipt.id,
      });
      if (error) throw new Error(error.message);
    }
    revalidatePath("/stock-in");
    revalidatePath("/inventory");
    redirect("/stock-in?tab=purchase&ok=1");
  }

  const receipt = must(
    await supabase
      .from("consignment_receipts")
      .insert({
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        receipt_date: receiptDate,
        rounding_adjustment: roundingAdjustment,
        created_by: me,
      })
      .select("id")
      .single(),
    "Tạo phiếu nhận ký gửi"
  );
  done(
    await supabase.from("consignment_receipt_items").insert(
      items.map((i) => ({
        receipt_id: receipt.id,
        product_id: i.product_id,
        qty: i.qty,
        consignment_price: i.unit_cost,
        expiry_date: i.expiry_date,
      }))
    ),
    "Thêm dòng phiếu nhập"
  );
  if (confirmNow) {
    const { error } = await supabase.rpc("confirm_consignment_receipt", {
      p_receipt_id: receipt.id,
    });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/stock-in");
  revalidatePath("/inventory");
  redirect("/stock-in?tab=consignment&ok=1");
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
  const ownLocs = await mainOwnLocations(
    supabase,
    raw.map((r) => r.batch_id as string)
  );
  const items = [];
  for (const r of raw) {
    const fromLocation = ownLocs.get(r.batch_id as string)?.locationId;
    if (!fromLocation)
      throw new Error("Một lô đã chọn không còn hàng tại Kho TVK.");
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

/**
 * Import phiếu gửi ký gửi (GK) từ Excel. Một file = một phiếu cho một đối
 * tác. Giá chuyển giao tính bằng VNĐ, nhập trực tiếp (không quy đổi).
 * Kiểm soát chặt như import kho: kiểm tra TOÀN BỘ file trước khi ghi bất
 * cứ thứ gì — bất kỳ dòng nào không hợp lệ cũng từ chối cả import.
 */
export async function importConsignmentOutAction(formData: FormData) {
  const supabase = await db();
  let payload: AnyRow;
  try {
    payload = JSON.parse(str(formData, "payload"));
  } catch {
    throw new Error("Dữ liệu import không hợp lệ.");
  }
  const partnerId = String(payload.partnerId ?? "");
  if (!partnerId) throw new Error("Cần chọn đối tác.");
  const confirmNow = !!payload.confirmNow;
  const rawRows: AnyRow[] = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rawRows.length) throw new Error("File không có dòng nào để gửi.");

  const batchCodes = Array.from(new Set(rawRows.map((r) => String(r.batchCode ?? "").trim()))).filter(Boolean);
  const { data: batches } = await supabase
    .from("stock_batches")
    .select("id, batch_code, ownership, supplier_id, unit_cost")
    .in("batch_code", batchCodes);
  const batchByCode = new Map(((batches ?? []) as AnyRow[]).map((b) => [normKey(b.batch_code), b]));
  const batchIds = Array.from(batchByCode.values()).map((b) => b.id as string);
  // Vị trí kho mình giữ nhiều nhất của mỗi lô — đúng vị trí phiếu sẽ trừ.
  const mainOwn = await mainOwnLocations(supabase, batchIds);
  const supplierIds = Array.from(new Set(Array.from(batchByCode.values()).map((b) => b.supplier_id as string))).filter(Boolean);
  const { data: suppliers } = supplierIds.length
    ? await supabase.from("suppliers").select("id, allow_sub_consignment").in("id", supplierIds)
    : { data: [] as AnyRow[] };
  const subOk = new Map(((suppliers ?? []) as AnyRow[]).map((s) => [s.id as string, !!s.allow_sub_consignment]));
  const { data: partner } = await supabase
    .from("partners")
    .select("id, consignment_limit")
    .eq("id", partnerId)
    .single();
  if (!partner) throw new Error("Không tìm thấy đối tác.");

  const invalid: string[] = [];
  const perBatchQty = new Map<string, number>();
  for (const r of rawRows) {
    const code = String(r.batchCode ?? "").trim();
    const qty = Math.trunc(Number(r.qty) || 0);
    const price = Number(r.price) || 0;
    if (!code || qty <= 0 || price < 0) {
      invalid.push(code || "(dòng thiếu mã lô)");
      continue;
    }
    const batch = batchByCode.get(normKey(code));
    if (!batch) {
      invalid.push(code);
      continue;
    }
    if (batch.ownership === "CONSIGNED" && !subOk.get(batch.supplier_id as string)) {
      invalid.push(`${code} (NCC chưa cho ký gửi tiếp)`);
      continue;
    }
    const own = mainOwn.get(batch.id as string);
    if (!own) {
      invalid.push(`${code} (không còn hàng tại Kho TVK)`);
      continue;
    }
    perBatchQty.set(batch.id as string, (perBatchQty.get(batch.id as string) ?? 0) + qty);
    if ((perBatchQty.get(batch.id as string) ?? 0) > own.qty) invalid.push(`${code} (vượt tồn tại Kho TVK)`);
  }
  // Hạn mức ký gửi (cùng công thức RPC xác nhận): giá trị hàng đang nằm
  // tại đối tác + giá trị đợt này (chỉ tính dòng Ký gửi).
  const limit = Number((partner as AnyRow).consignment_limit) || 0;
  if (limit > 0) {
    const { data: partnerLoc } = await supabase
      .from("locations")
      .select("id")
      .eq("partner_id", partnerId)
      .eq("location_kind", "PARTNER_VIRTUAL")
      .maybeSingle();
    let atPartner = 0;
    if (partnerLoc) {
      const { data: held } = await supabase
        .from("batch_locations")
        .select("batch_id, qty")
        .eq("location_id", (partnerLoc as AnyRow).id);
      const { data: allBatches } = await supabase.from("stock_batches").select("id, unit_cost").limit(5000);
      const costById = new Map(((allBatches ?? []) as AnyRow[]).map((b) => [b.id as string, Number(b.unit_cost) || 0]));
      for (const h of (held ?? []) as AnyRow[])
        atPartner += Number(h.qty) * (costById.get(h.batch_id as string) ?? 0);
    }
    let thisValue = 0;
    for (const r of rawRows) {
      if ((r.term === "PURCHASE" ? "PURCHASE" : "CONSIGNMENT") !== "CONSIGNMENT") continue;
      thisValue += Math.trunc(Number(r.qty) || 0) * (Number(r.price) || 0);
    }
    if (atPartner + thisValue > limit)
      invalid.push(`Vượt hạn mức ký gửi của đối tác (đang giữ ${atPartner}, đợt này thêm ${thisValue})`);
  }
  if (invalid.length)
    rejectImport(invalid);

  const me = await userId();
  const slip = must(
    await supabase
      .from("consignment_out_slips")
      .insert({
        partner_id: partnerId,
        slip_date: String(payload.slipDate ?? "").trim() || undefined,
        settlement_due_date: String(payload.settlementDueDate ?? "").trim() || null,
        return_by_date: String(payload.returnByDate ?? "").trim() || null,
        created_by: me,
      })
      .select("id")
      .single(),
    "Tạo phiếu gửi ký gửi"
  );
  done(
    await supabase.from("consignment_out_items").insert(
      rawRows.map((r) => {
        const batch = batchByCode.get(normKey(String(r.batchCode ?? "").trim())) as AnyRow;
        return {
          slip_id: slip.id,
          batch_id: batch.id,
          from_location_id: (mainOwn.get(batch.id as string) as { locationId: string }).locationId,
          qty: Math.trunc(Number(r.qty) || 0),
          term: r.term === "PURCHASE" ? "PURCHASE" : "CONSIGNMENT",
          transfer_price: Number(r.price) || 0,
        };
      })
    ),
    "Thêm dòng phiếu"
  );
  if (confirmNow) {
    const { error } = await supabase.rpc("confirm_consignment_out", { p_slip_id: slip.id });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/consignment-out");
  revalidatePath("/inventory");
  redirect("/consignment-out?ok=1");
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
  // Ngày bán do import Excel truyền vào; form tay không gửi thì mặc định
  // ngày hiện tại của DB. RPC xác nhận dùng doc_date để tính hạn nợ nên
  // ngày này phải xuống cả đơn và chứng từ.
  const saleDate = validDate(optStr(formData, "sale_date") ?? "");
  const order = must(
    await supabase
      .from("sales_orders")
      .insert({
        partner_id: partnerId,
        customer_name: optStr(formData, "customer_name"),
        created_by: await userId(),
        ...(saleDate ? { order_date: saleDate } : {}),
      })
      .select("id")
      .single(),
    "Tạo đơn bán hàng"
  );

  const ownLocs = await mainOwnLocations(
    supabase,
    lines.map((l) => l.batch_id as string)
  );
  const groups: Record<string, AnyRow[]> = { BH: [], KG: [] };
  for (const l of lines) {
    const batch = batchMap.get(l.batch_id);
    if (!batch) throw new Error("Không tìm thấy lô hàng.");
    const fromLocation = ownLocs.get(l.batch_id as string)?.locationId;
    if (!fromLocation) throw new Error("Một lô đã chọn không còn hàng tại Kho TVK.");
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
          ...(saleDate ? { doc_date: saleDate } : {}),
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

/**
 * Import đơn bán đại lý từ Excel. Một file = một đơn, đi đúng luồng bán
 * tại quầy (tạo đơn, tách BH/KG theo tính chất lô, xác nhận ngay, cập
 * nhật tồn + công nợ) vào đúng ngày bán của file. File chỉ ghi MÃ HÀNG —
 * server tự phân bổ FIFO: lô cũ nhất còn hàng tại Kho TVK trước,
 * một dòng có thể tách ra nhiều lô. Giá trống → giá đại lý của sản phẩm,
 * do server tự tra lại — bản xem trước ở client không được tin. Kiểm tra
 * toàn bộ file trước khi ghi — dòng lỗi nào cũng từ chối cả import.
 */
export async function importDealerSaleAction(formData: FormData) {
  const supabase = await db();
  let payload: AnyRow;
  try {
    payload = JSON.parse(str(formData, "payload"));
  } catch {
    throw new Error("Dữ liệu import không hợp lệ.");
  }
  const partnerId = String(payload.partnerId ?? "").trim();
  const saleDate = validDate(String(payload.saleDate ?? "").trim()) ?? todayISO();
  const rawRows: AnyRow[] = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rawRows.length) throw new Error("File không có dòng nào để bán.");

  // Bậc giá theo loại đối tác — tra cứu phía server, không tin client.
  let tier: PriceTier = priceTierForKind(null);
  if (partnerId) {
    const { data: partner } = await supabase
      .from("partners")
      .select("partner_kind")
      .eq("id", partnerId)
      .maybeSingle();
    if (!partner) throw new Error("Không tìm thấy đối tác.");
    tier = priceTierForKind(partner.partner_kind as string);
  }

  // Phân giải hàng: mã hàng (cột MaHang) trước — tên trùng nhau cũng
  // không sao vì mã là chìa khoá; tên + dòng xe chỉ là dự phòng khi
  // dòng nào đó thiếu mã — cùng luật khớp với bản xem trước ở client.
  const { data: allProducts } = await supabase
    .from("products")
    .select("id, name, sku, retail_price, garage_price, wholesale_price")
    .limit(5000);
  const { data: allCodes } = await supabase.from("product_codes").select("code, product_id").limit(10000);
  const { data: allFitments } = await supabase
    .from("product_fitments")
    .select("product_id, vehicles(model)")
    .limit(5000);
  const fitmentsByProduct = new Map<string, string[]>();
  for (const f of (allFitments ?? []) as AnyRow[]) {
    const models = Array.isArray(f.vehicles) ? f.vehicles : [f.vehicles];
    const names = models.map((v: AnyRow) => String(v?.model ?? "")).filter(Boolean);
    if (names.length) fitmentsByProduct.set(f.product_id as string, names);
  }
  const matchables = ((allProducts ?? []) as AnyRow[]).map((p) => ({
    id: p.id as string,
    name: String(p.name ?? ""),
    fitments: fitmentsByProduct.get(p.id as string) ?? [],
  }));
  const bySku = new Map(((allProducts ?? []) as AnyRow[]).map((p) => [normKey(p.sku), p.id as string]));
  const byCode = new Map(((allCodes ?? []) as AnyRow[]).map((c) => [normKey(c.code), c.product_id as string]));
  const tierPriceByProduct = new Map(
    ((allProducts ?? []) as AnyRow[]).map((p) => [
      p.id as string,
      tierPriceOf(
        {
          retailPrice: Number(p.retail_price) || 0,
          garagePrice: Number(p.garage_price) || 0,
          wholesalePrice: Number(p.wholesale_price) || 0,
        },
        tier
      ),
    ])
  );

  // Vòng 1: phân giải từng dòng (tên/mã, số lượng, giá); dòng nào sai
  // thì ghi lại — cả file bị từ chối, không bán một phần.
  const invalid: string[] = [];
  const resolved: { productId: string; label: string; qty: number; unitPrice: number }[] = [];
  for (const r of rawRows) {
    const name = String(r.name ?? "").trim();
    const vehicle = String(r.vehicle ?? "").trim();
    const code = String(r.code ?? "").trim();
    const qty = Math.trunc(Number(r.qty) || 0);
    const label = name || code || "(dòng thiếu tên hàng và mã hàng)";
    const priceRaw =
      r.price === null || r.price === undefined || r.price === "" ? null : Number(r.price);
    let productId: string | undefined;
    if (code) {
      productId = bySku.get(normKey(code)) ?? byCode.get(normKey(code));
      if (!productId) {
        invalid.push(`${code} (mã hàng chưa có trong hệ thống)`);
        continue;
      }
    } else if (name) {
      const matched = matchByNameVehicle(matchables, name, vehicle);
      if ("error" in matched) {
        invalid.push(matched.error === "ambiguous" ? `${name} (trùng tên)` : `${name} (không tìm thấy)`);
        continue;
      }
      productId = matched.productId;
    } else {
      invalid.push("(dòng thiếu tên hàng và mã hàng)");
      continue;
    }
    if (!(qty > 0)) {
      invalid.push(`${label} (số lượng không hợp lệ)`);
      continue;
    }
    if (priceRaw !== null && !(priceRaw >= 0)) {
      invalid.push(`${label} (giá không hợp lệ)`);
      continue;
    }
    resolved.push({
      productId,
      label,
      qty,
      unitPrice: priceRaw ?? (tierPriceByProduct.get(productId) ?? 0),
    });
  }
  if (invalid.length) rejectImport(invalid);
  const productIds = Array.from(new Set(resolved.map((r) => r.productId)));

  // Hàng đợi FIFO theo sản phẩm: lô cũ nhất (received_date, rồi mã lô)
  // trước; nhớt thì FEFO — hạn dùng gần nhất trước, lô không hạn xếp
  // sau cùng rồi mới theo FIFO. Tồn khả dụng của mỗi lô = tồn tại vị
  // trí kho mình giữ nhiều nhất — đúng vị trí phiếu sẽ trừ.
  const { data: batches } = productIds.length
    ? await supabase
        .from("stock_batches")
        .select("id, batch_code, product_id, ownership, received_date, expiry_date")
        .in("product_id", productIds)
    : { data: [] as AnyRow[] };
  const { data: groupRows } = productIds.length
    ? await supabase
        .from("products")
        .select("id, product_group")
        .in("id", productIds)
    : { data: [] as AnyRow[] };
  const oilByProduct = new Map<string, boolean>(
    ((groupRows ?? []) as AnyRow[]).map((p) => [p.id as string, isOilGroup(p.product_group)])
  );
  const batchIds = ((batches ?? []) as AnyRow[]).map((b) => b.id as string);
  const ownLocs = await mainOwnLocations(supabase, batchIds);
  const fifoByProduct = new Map<string, { id: string; qty: number }[]>();
  for (const b of ((batches ?? []) as AnyRow[]).sort((x, y) =>
    compareLotOrder(x, y, oilByProduct.get(x.product_id as string) ?? false)
  )) {
    const q = ownLocs.get(b.id as string)?.qty ?? 0;
    if (q <= 0) continue;
    const list = fifoByProduct.get(b.product_id as string) ?? [];
    list.push({ id: b.id as string, qty: q });
    fifoByProduct.set(b.product_id as string, list);
  }

  // Vòng 2: phân bổ FIFO tuần tự theo thứ tự dòng trong file; tồn còn
  // lại của lô được trừ dần qua các dòng (kể cả khi cùng món lặp lại).
  const remaining = new Map<string, number>();
  for (const list of Array.from(fifoByProduct.values()))
    for (const b of list) remaining.set(b.id, b.qty);
  const lines: { batch_id: string; qty: number; unit_price: number }[] = [];
  for (const r of resolved) {
    let need = r.qty;
    for (const b of fifoByProduct.get(r.productId) ?? []) {
      if (need <= 0) break;
      const avail = remaining.get(b.id) ?? 0;
      const take = Math.min(need, avail);
      if (take > 0) {
        lines.push({ batch_id: b.id, qty: take, unit_price: r.unitPrice });
        remaining.set(b.id, avail - take);
        need -= take;
      }
    }
    if (need > 0)
      invalid.push(`${r.label} (không đủ hàng theo FIFO, còn ${r.qty - need})`);
  }
  if (invalid.length)
    rejectImport(invalid);

  // Ủy quyền cho đúng luồng bán tại quầy: tạo đơn, tách BH/KG theo tính
  // chất lô, xác nhận ngay, cập nhật tồn + công nợ, vào đúng ngày bán.
  const fd = new FormData();
  if (partnerId) fd.set("partner_id", partnerId);
  fd.set("customer_name", String(payload.customerName ?? ""));
  fd.set("discount_amount", String(Number(payload.discountAmount) || 0));
  if (payload.isCredit) fd.set("is_credit", "on");
  fd.set("sale_date", saleDate);
  for (const l of lines) {
    fd.append("batch_id", l.batch_id);
    fd.append("qty", String(l.qty));
    fd.append("unit_price", String(l.unit_price));
  }
  return createCounterSaleAction(fd);
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

/**
 * Import báo cáo tiêu thụ (BT) từ Excel. Một file = một báo cáo cho một
 * đối tác trong một kỳ. Báo cáo chỉ ghi nhận số lượng, không có giá.
 * Kiểm tra toàn bộ file trước khi ghi — dòng lỗi nào cũng từ chối cả import.
 */
export async function importConsumptionReportAction(formData: FormData) {
  const supabase = await db();
  let payload: AnyRow;
  try {
    payload = JSON.parse(str(formData, "payload"));
  } catch {
    throw new Error("Dữ liệu import không hợp lệ.");
  }
  const partnerId = String(payload.partnerId ?? "");
  const periodFrom = String(payload.periodFrom ?? "").trim();
  const periodTo = String(payload.periodTo ?? "").trim();
  if (!partnerId) throw new Error("Cần chọn đối tác.");
  if (!periodFrom || !periodTo) throw new Error("Cần chọn kỳ báo cáo (từ ngày, đến ngày).");
  const confirmNow = !!payload.confirmNow;
  const rawRows: AnyRow[] = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rawRows.length) throw new Error("File không có dòng nào để báo.");

  const { data: allProducts } = await supabase.from("products").select("id, sku").limit(5000);
  const { data: allCodes } = await supabase.from("product_codes").select("code, product_id").limit(10000);
  const bySku = new Map(((allProducts ?? []) as AnyRow[]).map((p) => [normKey(p.sku), p.id as string]));
  const byCode = new Map(((allCodes ?? []) as AnyRow[]).map((c) => [normKey(c.code), c.product_id as string]));

  const invalid: string[] = [];
  const items: { product_id: string; qty_consumed: number }[] = [];
  for (const r of rawRows) {
    const code = String(r.code ?? "").trim();
    const qty = Math.trunc(Number(r.qty) || 0);
    if (!code || qty <= 0) {
      invalid.push(code || "(dòng thiếu mã hàng)");
      continue;
    }
    const productId = bySku.get(normKey(code)) ?? byCode.get(normKey(code));
    if (!productId) {
      invalid.push(code);
      continue;
    }
    items.push({ product_id: productId, qty_consumed: qty });
  }
  if (invalid.length)
    rejectImport(invalid);

  const me = await userId();
  const report = must(
    await supabase
      .from("consumption_reports")
      .insert({
        partner_id: partnerId,
        period_from: periodFrom,
        period_to: periodTo,
        created_by: me,
      })
      .select("id")
      .single(),
    "Tạo báo cáo tiêu thụ"
  );
  done(
    await supabase.from("consumption_report_items").insert(
      items.map((i) => ({ report_id: report.id, ...i }))
    ),
    "Thêm dòng báo cáo"
  );
  if (confirmNow) {
    done(
      await supabase
        .from("consumption_reports")
        .update({ status: "CONFIRMED" })
        .eq("id", report.id),
      "Xác nhận báo cáo"
    );
  }
  revalidatePath("/partner-consumption");
  redirect("/partner-consumption?ok=1");
}

/**
 * Import phiếu phân bổ (PB) từ Excel. Một file = một phiếu cho một đối
 * tác. Đơn giá tính bằng VNĐ, nhập trực tiếp. Kiểm tra trước toàn bộ file,
 * gồm cả 3 chốt của RPC xác nhận (lượng đã báo, hạn mức theo tính chất,
 * tồn tại kho đối tác) — dòng lỗi nào cũng từ chối cả import.
 */
export async function importAllocationAction(formData: FormData) {
  const supabase = await db();
  let payload: AnyRow;
  try {
    payload = JSON.parse(str(formData, "payload"));
  } catch {
    throw new Error("Dữ liệu import không hợp lệ.");
  }
  const partnerId = String(payload.partnerId ?? "");
  if (!partnerId) throw new Error("Cần chọn đối tác.");
  const reportId = String(payload.reportId ?? "").trim() || null;
  const confirmNow = !!payload.confirmNow;
  const rawRows: AnyRow[] = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rawRows.length) throw new Error("File không có dòng nào để phân bổ.");

  if (reportId) {
    const { data: report } = await supabase
      .from("consumption_reports")
      .select("id")
      .eq("id", reportId)
      .maybeSingle();
    if (!report) throw new Error("Không tìm thấy báo cáo tiêu thụ đã chọn.");
  }
  const partnerLoc = await partnerLocationId(supabase, partnerId);
  if (!partnerLoc) throw new Error("Đối tác chưa có kho ảo (chưa từng nhận ký gửi).");

  const { data: allProducts } = await supabase.from("products").select("id, sku").limit(5000);
  const { data: allCodes } = await supabase.from("product_codes").select("code, product_id").limit(10000);
  const bySku = new Map(((allProducts ?? []) as AnyRow[]).map((p) => [normKey(p.sku), p.id as string]));
  const byCode = new Map(((allCodes ?? []) as AnyRow[]).map((c) => [normKey(c.code), c.product_id as string]));
  const batchCodes = Array.from(new Set(rawRows.map((r) => String(r.batchCode ?? "").trim()))).filter(Boolean);
  const { data: batches } = await supabase
    .from("stock_batches")
    .select("id, batch_code, product_id")
    .in("batch_code", batchCodes);
  const batchByCode = new Map(((batches ?? []) as AnyRow[]).map((b) => [normKey(b.batch_code), b]));
  const batchIds = Array.from(batchByCode.values()).map((b) => b.id as string);
  const { data: batchLocs } = batchIds.length
    ? await supabase
        .from("batch_locations")
        .select("batch_id, qty")
        .eq("location_id", partnerLoc)
        .in("batch_id", batchIds)
    : { data: [] as AnyRow[] };
  const qtyAtPartner = new Map(
    ((batchLocs ?? []) as AnyRow[]).map((bl) => [bl.batch_id as string, Number(bl.qty)])
  );

  const invalid: string[] = [];
  const lines: { product_id: string; batch_id: string; nature: string; qty: number; unit_price: number }[] = [];
  const perBatchQty = new Map<string, number>();
  for (const r of rawRows) {
    const code = String(r.code ?? "").trim();
    const batchCode = String(r.batchCode ?? "").trim();
    const qty = Math.trunc(Number(r.qty) || 0);
    const nature = r.nature === "PURCHASED" ? "PURCHASED" : "CONSIGNED";
    const price = Number(r.price) || 0;
    if (!code || !batchCode || qty <= 0 || price < 0) {
      invalid.push(batchCode || code || "(dòng thiếu mã)");
      continue;
    }
    const productId = bySku.get(normKey(code)) ?? byCode.get(normKey(code));
    if (!productId) {
      invalid.push(code);
      continue;
    }
    const batch = batchByCode.get(normKey(batchCode));
    if (!batch) {
      invalid.push(batchCode);
      continue;
    }
    if ((batch.product_id as string) !== productId) {
      invalid.push(`${batchCode} (không thuộc sản phẩm ${code})`);
      continue;
    }
    perBatchQty.set(batch.id as string, (perBatchQty.get(batch.id as string) ?? 0) + qty);
    if ((perBatchQty.get(batch.id as string) ?? 0) > (qtyAtPartner.get(batch.id as string) ?? 0))
      invalid.push(`${batchCode} (vượt tồn tại kho đối tác)`);
    lines.push({ product_id: productId, batch_id: batch.id as string, nature, qty, unit_price: price });
  }
  // Chốt 1 (nếu gắn báo cáo): theo từng sản phẩm, không vượt lượng chưa phân bổ.
  if (reportId) {
    const perProduct = new Map<string, number>();
    for (const l of lines) perProduct.set(l.product_id, (perProduct.get(l.product_id) ?? 0) + l.qty);
    for (const [productId, q] of Array.from(perProduct.entries())) {
      const { data: prog } = await supabase
        .from("v_consumption_progress")
        .select("qty_not_yet_allocated")
        .eq("report_id", reportId)
        .eq("product_id", productId)
        .maybeSingle();
      if (!prog || q > Number((prog as AnyRow).qty_not_yet_allocated))
        invalid.push(`Vượt lượng đã báo tiêu thụ của một sản phẩm`);
    }
  }
  // Chốt 2: theo từng (sản phẩm, tính chất), không vượt hạn mức còn lại.
  {
    const perKey = new Map<string, { product_id: string; nature: string; qty: number }>();
    for (const l of lines) {
      const k = `${l.product_id}|${l.nature}`;
      const prev = perKey.get(k);
      perKey.set(k, { product_id: l.product_id, nature: l.nature, qty: (prev?.qty ?? 0) + l.qty });
    }
    for (const { product_id, nature, qty } of Array.from(perKey.values())) {
      const { data: bal } = await supabase
        .from("v_partner_term_balance")
        .select("qty_remaining_allocatable")
        .eq("partner_id", partnerId)
        .eq("product_id", product_id)
        .eq("nature", nature)
        .maybeSingle();
      if (!bal || qty > Number((bal as AnyRow).qty_remaining_allocatable))
        invalid.push(`Vượt hạn mức ${nature === "PURCHASED" ? "mua đứt" : "ký gửi"} của một sản phẩm`);
    }
  }
  if (invalid.length)
    rejectImport(invalid);

  const me = await userId();
  const slip = must(
    await supabase
      .from("allocation_slips")
      .insert({ report_id: reportId, partner_id: partnerId, created_by: me })
      .select("id")
      .single(),
    "Tạo phiếu phân bổ"
  );
  done(
    await supabase.from("allocation_lines").insert(
      lines.map((l) => ({ allocation_id: slip.id, ...l }))
    ),
    "Thêm dòng phân bổ"
  );
  if (confirmNow) {
    const { error } = await supabase.rpc("confirm_allocation", { p_allocation_id: slip.id });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/partner-consumption");
  redirect(`/partner-consumption/allocations/${slip.id}?ok=1`);
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
  const partnerId = optStr(formData, "partner_id");
  const invoiceDate = str(formData, "invoice_date");
  const provider = optStr(formData, "provider");
  // Ô chọn trên form: có chọn = GỘP 1 hoá đơn; bỏ chọn = TÁCH 2 hoá đơn.
  const combine = str(formData, "combine") === "1";

  const issue = async (ids: string[], invoiceNo: string, symbol: string) => {
    const { error } = await supabase.rpc("create_vat_invoice", {
      p_partner_id: partnerId,
      p_invoice_no: invoiceNo,
      p_symbol: symbol,
      p_invoice_date: invoiceDate,
      p_provider: provider,
      p_line_ids: ids,
    });
    if (error) throw new Error(error.message);
  };

  if (combine) {
    await issue(lineIds, str(formData, "invoice_no"), str(formData, "symbol"));
  } else {
    // Tách theo tính chất: tra doc_kind (BH/KG) của từng dòng qua chứng từ cha.
    const { data: lineRows } = await supabase
      .from("sales_document_lines")
      .select("id, document_id")
      .in("id", lineIds);
    const docIds = Array.from(
      new Set(((lineRows ?? []) as AnyRow[]).map((l) => l.document_id as string))
    );
    const { data: docRows } = await supabase
      .from("sales_documents")
      .select("id, doc_kind")
      .in("id", docIds);
    const kindOf = new Map(
      ((docRows ?? []) as AnyRow[]).map(
        (d): [string, string] => [d.id as string, d.doc_kind as string]
      )
    );
    const docOf = new Map(
      ((lineRows ?? []) as AnyRow[]).map(
        (l): [string, string] => [l.id as string, l.document_id as string]
      )
    );
    const bhIds = lineIds.filter((id) => kindOf.get(docOf.get(id) ?? "") === "BH");
    const kgIds = lineIds.filter((id) => kindOf.get(docOf.get(id) ?? "") === "KG");
    if (!bhIds.length || !kgIds.length) {
      // Các dòng đã chọn chỉ có một tính chất — xuất một hoá đơn như bình thường.
      await issue(lineIds, str(formData, "invoice_no"), str(formData, "symbol"));
    } else {
      const invoiceNoKg = str(formData, "invoice_no_kg");
      const symbolKg = str(formData, "symbol_kg");
      if (!invoiceNoKg || !symbolKg)
        throw new Error(
          "Bạn đã chọn tách hoá đơn: hãy nhập Số hoá đơn và Ký hiệu cho phần ký gửi (KG)."
        );
      await issue(bhIds, str(formData, "invoice_no"), str(formData, "symbol"));
      try {
        await issue(kgIds, invoiceNoKg, symbolKg);
      } catch (e) {
        throw new Error(
          `Đã tạo hoá đơn phần bán thẳng (BH), nhưng phần ký gửi (KG) chưa tạo được: ${
            e instanceof Error ? e.message : String(e)
          }. Các dòng KG vẫn còn ở danh sách chưa xuất hoá đơn — hãy xuất riêng cho chúng.`
        );
      }
    }
  }
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
  const ownLocs =
    kind === "SUPPLIER_RETURN"
      ? await mainOwnLocations(
          supabase,
          raw.map((r) => r.batch_id as string)
        )
      : new Map<string, { locationId: string; qty: number }>();
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
      fromLocation = ownLocs.get(r.batch_id as string)?.locationId ?? null;
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

const APP_ROLES = ["OWNER", "SALES", "WAREHOUSE", "ACCOUNTING", "CEO"];

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

  const ins = await admin.from("profiles").insert({
    id: newUserId,
    email,
    full_name: fullName,
    role,
    username,
    // Tạo bằng mật khẩu tạm: bắt buộc đổi mật khẩu ở lần đăng nhập đầu.
    must_change_password: mode === "password",
  });
  if (ins.error) {
    // Gỡ tài khoản auth vừa tạo để không bỏ lại tài khoản mồ côi.
    await admin.auth.admin.deleteUser(newUserId);
    throw new Error(`Tạo hồ sơ: ${ins.error.message}`);
  }
  revalidatePath("/settings");
}

/** Sửa họ tên + tên đăng nhập của một tài khoản. Chỉ Chủ cửa hàng (kiểm
 * tra phía server). Sửa tên mình cũng được — khác với đổi vai trò/khoá/
 * xoá, những thứ bị cấm tự làm với chính mình. Email không sửa ở đây vì
 * nó là danh tính đăng nhập. Tên đăng nhập để trống = gỡ tên đăng nhập. */
export async function updateUserInfoAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const { admin } = await requireOwnerAdmin();
  const id = str(formData, "profile_id");
  const fullName = str(formData, "full_name");
  const usernameRaw = optStr(formData, "username");
  const username = usernameRaw ? usernameRaw.toLowerCase() : null;
  if (!fullName) return { ok: false, error: "Cần nhập họ tên." };
  if (
    username &&
    !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)
  )
    return {
      ok: false,
      error:
        "Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch dưới, gạch ngang, dài 3–32 ký tự.",
    };
  await getTargetProfile(admin, id);
  if (username) {
    const { data: clash } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .neq("id", id)
      .maybeSingle();
    if (clash) return { ok: false, error: "Tên đăng nhập đã có người dùng." };
  }
  const upd = await admin
    .from("profiles")
    .update({ full_name: fullName, username })
    .eq("id", id);
  if (upd.error) {
    if (upd.error.code === "23505")
      return { ok: false, error: "Tên đăng nhập đã có người dùng." };
    if (upd.error.code === "23514")
      return { ok: false, error: "Tên đăng nhập không đúng định dạng." };
    return { ok: false, error: "Không lưu được, thử lại." };
  }
  revalidatePath("/settings");
  return { ok: true };
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
  const { admin } = await requireOwnerAdmin();
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
  // Sau reset, lần đăng nhập kế tiếp bắt buộc qua trang đổi mật khẩu.
  await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("email", email);
  revalidatePath("/settings");
}

/**
 * Gắn cờ "phải đổi mật khẩu" khi người dùng TỰ yêu cầu đặt lại mật khẩu
 * (trang đăng nhập → Quên mật khẩu). Người yêu cầu chưa đăng nhập nên
 * phải ghi bằng service-role; mọi lỗi đều được bỏ qua để không bao giờ
 * làm hỏng luồng gửi email đặt lại.
 */
export async function flagPasswordResetRequestedAction(emailRaw: string) {
  try {
    const admin = createAdminClient();
    if (!admin) return;
    const email = emailRaw.trim().toLowerCase();
    if (!email) return;
    await admin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("email", email);
  } catch {
    // Bỏ qua: gắn cờ là việc phụ, không chặn luồng quên mật khẩu.
  }
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
