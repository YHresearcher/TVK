"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { todayISO } from "@/lib/format";
import {
  compareLotOrder,
  isExpiredBatch,
  isOilLineCode,
  matchByNameVehicle,
  splitByBusinessLine,
  tierPriceOf,
} from "@/lib/product-match";
import {
  assertBatchesInLine,
  assertGroupMatchesLine,
  assertProductsInLine,
  BUSINESS_LINE_COOKIE,
  getBusinessLineContext,
  getLineByCode,
  getLineLabelById,
  getProductLineMap,
  resolveWriteLine,
} from "@/lib/business-lines";
import { canChangeProductBusinessLine } from "@/lib/business-lines";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AnyRow } from "@/lib/types";
import { priceTierForKind, type PriceTier } from "@/lib/types";

async function db() {
  const supabase = await createClient();
  if (!supabase) throw new Error("Hệ thống chưa cài đặt xong — hãy báo chủ cửa hàng.");
  return supabase;
}

async function userId() {
  const supabase = await db();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Chặn ghi trái quyền ở tầng action (phòng thủ thêm sau RLS + kiểm tra
 *  trong hàm RPC): chỉ các vai trò trong danh sách mới được chạy tiếp. */
async function requireRole(roles: string[], message: string) {
  const supabase = await db();
  const uid = await userId();
  if (!uid) throw new Error("Chưa đăng nhập.");
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (!prof || !roles.includes(prof.role)) throw new Error(message);
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

export interface ShelfLocationStock {
  locationId: string;
  qty: number;
}

export interface BatchOwnStockInfo {
  locationId: string;
  qty: number;
  shelves: ShelfLocationStock[];
}

/**
 * FS-02: Lấy toàn bộ các kệ thuộc Kho TVK (OWN_WAREHOUSE) có tồn của từng lô,
 * sắp xếp kệ nhiều tồn nhất trước. Cho phép tự động tách dòng xuất kho (multi-location split)
 * khi số lượng xuất vượt quá tồn của 1 kệ đơn lẻ.
 */
async function mainOwnLocations(
  supabase: AnyRow,
  batchIds: string[]
): Promise<Map<string, BatchOwnStockInfo>> {
  const uniq = Array.from(new Set(batchIds.filter(Boolean)));
  const map = new Map<string, BatchOwnStockInfo>();
  if (!uniq.length) return map;
  const { data, error } = await supabase
    .from("batch_locations")
    .select("batch_id, location_id, qty, locations(location_kind)")
    .in("batch_id", uniq)
    .gt("qty", 0)
    .order("qty", { ascending: false });
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as AnyRow[]) {
    if ((r.locations as AnyRow)?.location_kind !== "OWN_WAREHOUSE") continue;
    const id = r.batch_id as string;
    const shelfQty = Number(r.qty) || 0;
    const locId = r.location_id as string;
    const cur = map.get(id);
    if (!cur) {
      map.set(id, {
        locationId: locId,
        qty: shelfQty,
        shelves: [{ locationId: locId, qty: shelfQty }],
      });
    } else {
      cur.qty += shelfQty;
      cur.shelves.push({ locationId: locId, qty: shelfQty });
    }
  }
  return map;
}

/**
 * FS-02: Tự động tách số lượng cần xuất qua các kệ kho có tồn của lô (Multi-location split).
 * Trừ dần tồn trên từng kệ theo thứ tự ưu tiên (kệ nhiều tồn nhất trước).
 */
function splitAcrossShelves(
  info: BatchOwnStockInfo | undefined,
  neededQty: number
): { locationId: string; qty: number }[] {
  if (!info || info.qty < neededQty || !info.shelves.length) {
    throw new Error("Một lô đã chọn không còn đủ hàng tồn tại Kho TVK để xuất.");
  }
  let remaining = neededQty;
  const splits: { locationId: string; qty: number }[] = [];
  for (const shelf of info.shelves) {
    if (remaining <= 0) break;
    if (shelf.qty <= 0) continue;
    const take = Math.min(remaining, shelf.qty);
    if (take > 0) {
      splits.push({ locationId: shelf.locationId, qty: take });
      shelf.qty -= take;
      info.qty -= take;
      remaining -= take;
    }
  }
  if (remaining > 0) {
    throw new Error(`Không đủ hàng tồn tại các kệ để xuất đủ số lượng ${neededQty}.`);
  }
  return splits;
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

/**
 * P2 §18.2–§18.3 — Đổi ngữ cảnh ngành hàng của phiên làm việc (bộ chuyển
 * ngành ở sidebar). Giá trị ghi cookie CHỈ là "ý muốn": mọi trang/action
 * đều kiểm tra lại từ DB (getBusinessLineContext), nên chọn ngành không
 * được gán hoặc ALL khi không đủ quyền sẽ rơi về mặc định an toàn.
 * Chỉ OWNER/CEO được chọn "ALL" (toàn doanh nghiệp).
 */
export async function setBusinessLineContextAction(formData: FormData) {
  const supabase = await db();
  const uid = await userId();
  if (!uid) throw new Error("Chưa đăng nhập.");
  const { data: prof } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", uid)
    .maybeSingle();
  if (!prof || !prof.is_active) throw new Error("Tài khoản chưa sẵn sàng.");
  const wanted = str(formData, "business_line");
  const canSeeAll = prof.role === "OWNER" || prof.role === "CEO";
  if (wanted === "ALL") {
    if (!canSeeAll) throw new Error("Chỉ Chủ cửa hàng và CEO mới xem được toàn doanh nghiệp.");
  } else {
    const line = await getLineByCode(supabase, wanted);
    if (!line) throw new Error("Ngành hàng không tồn tại hoặc đang tắt.");
    const { data: assigned } = await supabase
      .from("user_business_lines")
      .select("business_line_id")
      .eq("user_id", uid)
      .eq("business_line_id", line.id)
      .maybeSingle();
    if (!assigned && !canSeeAll) {
      throw new Error("Tài khoản chưa được gán ngành hàng này — nhờ chủ cửa hàng gán.");
    }
  }
  (await cookies()).set(BUSINESS_LINE_COOKIE, wanted, {
    path: "/",
    sameSite: "lax",
  });
  revalidatePath("/dashboard", "layout");
}

// -------------------------------------------------------------- catalog
export async function createProductAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","SALES","WAREHOUSE"], "Chỉ Chủ cửa hàng, Bán hàng và Thủ kho mới được tạo sản phẩm.");
  // P2: sản phẩm mới thuộc ngành đang làm việc (ALL thì chọn rõ trên form).
  const line = await resolveWriteLine(supabase, optStr(formData, "business_line"));
  const productGroup = optStr(formData, "product_group");
  await assertGroupMatchesLine(supabase, productGroup, line.id);
  const product = must(
    await supabase
      .from("products")
      .insert({
        sku: str(formData, "sku"),
        name: str(formData, "name"),
        brand: optStr(formData, "brand"),
        product_group: productGroup,
        sae_viscosity: optStr(formData, "sae_viscosity"),
        api_standard: optStr(formData, "api_standard"),
        unit: str(formData, "unit") || "cái",
        retail_price: num(formData, "retail_price"),
        garage_price: num(formData, "garage_price"),
        wholesale_price: num(formData, "wholesale_price"),
        min_stock: Math.trunc(num(formData, "min_stock")),
        business_line_id: line.id,
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
  await requireRole(["OWNER","SALES","WAREHOUSE"], "Chỉ Chủ cửa hàng, Bán hàng và Thủ kho mới được thêm mã sản phẩm.");
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
  await requireRole(["OWNER","SALES","WAREHOUSE"], "Chỉ Chủ cửa hàng, Bán hàng và Thủ kho mới được gán dòng xe phù hợp.");
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
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới sửa được thông tin hàng hoá.");
  const name = str(formData, "name");
  const unit = str(formData, "unit");
  if (!name) throw new Error("Cần nhập tên hàng.");
  if (!unit) throw new Error("Cần nhập đơn vị tính.");
  const productGroup = optStr(formData, "product_group");
  // P2: đổi nhóm hàng sang nhóm đã mapping sang ngành khác -> từ chối
  // (đổi ngành phải dùng quy trình đổi ngành riêng, có kiểm tra giao dịch).
  const { data: product } = await supabase
    .from("products")
    .select("business_line_id")
    .eq("id", productId)
    .maybeSingle();
  if (product?.business_line_id) {
    await assertGroupMatchesLine(supabase, productGroup, String(product.business_line_id));
  }
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
  await requireRole(["OWNER","SALES"], "Chỉ Chủ cửa hàng và Bán hàng mới được sửa giá sản phẩm.");
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
  await requireRole(["OWNER","ACCOUNTING","WAREHOUSE"], "Chỉ Chủ cửa hàng, Kế toán và Thủ kho mới được tạo nhà cung cấp.");
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
      purchase_pay_days: Math.trunc(num(formData, "purchase_pay_days") || 30),
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
  await requireRole(["OWNER","SALES","ACCOUNTING"], "Chỉ Chủ cửa hàng, Bán hàng và Kế toán mới được tạo đối tác.");
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
      purchase_pay_days: Math.trunc(num(formData, "purchase_pay_days") || 30),
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
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được tạo kho.");
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
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được tạo phiếu nhập mua.");
  // P2: phiếu thuộc một ngành; kiểm tra dòng trước khi ghi phiếu để
  // phiếu bị từ chối không để lại phiếu nháp trống.
  const line = await resolveWriteLine(supabase, optStr(formData, "business_line"));
  const rawItems = zipItems(formData, ["product_id", "qty", "unit_cost", "expiry_date"])
    .filter((r) => r.product_id && Number(r.qty) > 0);
  if (!rawItems.length) throw new Error("Phiếu nhập cần ít nhất một dòng hàng.");
  await assertProductsInLine(supabase, rawItems.map((r) => String(r.product_id)), line.id);
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
        business_line_id: line.id,
      })
      .select("id")
      .single(),
    "Tạo phiếu nhập mua"
  );
  const items = rawItems
    .map((r) => ({
      receipt_id: receipt.id,
      product_id: r.product_id,
      qty: Math.trunc(Number(r.qty)),
      unit_cost: Number(r.unit_cost),
      expiry_date: validDate(String(r.expiry_date ?? "")),
    }));
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

/**
 * P2: chứng từ xác nhận phải có ngành hàng. Chứng từ lịch sử còn NULL
 * ngành (hỗn hợp từ P1, chưa phân loại) không được xác nhận tiếp khi
 * chưa phân loại xong — tránh phát sinh tồn/công nợ không thuộc ngành nào.
 * Chứng từ đã xác nhận trên live đều đã có ngành sau backfill P1 nên
 * kiểm tra này không chặn luồng thường.
 */
async function requireHeaderBusinessLine(
  supabase: AnyRow,
  table: string,
  id: string,
  label: string,
): Promise<void> {
  const { data } = await supabase
    .from(table)
    .select("business_line_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new Error(`Không tìm thấy ${label}.`);
  if (!data.business_line_id) {
    throw new Error(
      `${label} chưa có ngành hàng (chứng từ cũ chưa phân loại) — hãy phân loại ngành trước khi xác nhận.`,
    );
  }
}

export async function confirmPurchaseReceiptAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được xác nhận phiếu nhập.");
  await requireHeaderBusinessLine(supabase, "purchase_receipts", str(formData, "id"), "Phiếu nhập");
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
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được tạo phiếu nhận ký gửi.");
  // P2: như phiếu nhập mua — kiểm tra dòng trước khi ghi phiếu.
  const line = await resolveWriteLine(supabase, optStr(formData, "business_line"));
  const rawItems = zipItems(formData, ["product_id", "qty", "consignment_price", "expiry_date"])
    .filter((r) => r.product_id && Number(r.qty) > 0);
  if (!rawItems.length) throw new Error("Phiếu nhập cần ít nhất một dòng hàng.");
  await assertProductsInLine(supabase, rawItems.map((r) => String(r.product_id)), line.id);
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
        business_line_id: line.id,
      })
      .select("id")
      .single(),
    "Tạo phiếu nhận ký gửi"
  );
  const items = rawItems
    .map((r) => ({
      receipt_id: receipt.id,
      product_id: r.product_id,
      qty: Math.trunc(Number(r.qty)),
      consignment_price: Number(r.consignment_price),
      expiry_date: validDate(String(r.expiry_date ?? "")),
    }));
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
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được xác nhận phiếu nhận ký gửi.");
  await requireHeaderBusinessLine(supabase, "consignment_receipts", str(formData, "id"), "Phiếu nhận ký gửi");
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
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được nhập kho.");
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
  // P2: toàn bộ file thuộc một ngành (ngữ cảnh phiên làm việc; ALL thì
  // chọn rõ trên form). Nhóm hàng cho sản phẩm mới đã mapping sang ngành
  // khác -> từ chối cả file.
  const line = await resolveWriteLine(supabase, String(payload.businessLine ?? "").trim() || null);
  await assertGroupMatchesLine(supabase, productGroup, line.id);

  // FS-05: Truy vấn mục tiêu theo danh sách mã trong file, loại bỏ giới hạn cứng .limit(5000), tránh duplicate SKU
  const candidateCodesSet = new Set<string>();
  for (const r of rawRows) {
    const c = storeCode(String(r.code ?? ""));
    if (c) {
      candidateCodesSet.add(c);
      candidateCodesSet.add(c.trim());
      candidateCodesSet.add(c.toUpperCase());
      candidateCodesSet.add(c.toLowerCase());
    }
    const altCodes = (Array.isArray(r.altCodes) ? r.altCodes : [])
      .map((a) => storeCode(String(a ?? "")))
      .filter(Boolean);
    for (const a of altCodes) {
      candidateCodesSet.add(a);
      candidateCodesSet.add(a.trim());
      candidateCodesSet.add(a.toUpperCase());
      candidateCodesSet.add(a.toLowerCase());
    }
  }
  const candidateCodes = Array.from(candidateCodesSet);

  const bySku = new Map<string, string>();
  const byCode = new Map<string, string>();
  // P2: ngành của từng sản phẩm đã có (để từ chối dòng sai ngành / chưa
  // phân loại trước khi ghi bất cứ thứ gì).
  const lineByProduct = new Map<string, string | null>();

  const CHUNK_SIZE = 500;
  for (let i = 0; i < candidateCodes.length; i += CHUNK_SIZE) {
    const chunk = candidateCodes.slice(i, i + CHUNK_SIZE);
    const [pRes, cRes] = await Promise.all([
      supabase.from("products").select("id, sku, business_line_id").in("sku", chunk),
      supabase.from("product_codes").select("code, product_id").in("code", chunk),
    ]);
    for (const p of ((pRes.data ?? []) as AnyRow[])) {
      if (p.sku && p.id) bySku.set(normKey(p.sku), p.id as string);
      if (p.id) lineByProduct.set(p.id as string, (p.business_line_id as string | null) ?? null);
    }
    for (const c of ((cRes.data ?? []) as AnyRow[])) {
      if (c.code && c.product_id) byCode.set(normKey(c.code), c.product_id as string);
    }
  }

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
    // P2: sản phẩm đã có phải thuộc đúng ngành của file (chưa phân loại
    // hoặc lệch ngành đều từ chối cả file — không nhập một phần).
    if (found) {
      const pLine = lineByProduct.get(found);
      if (!pLine) {
        invalid.push(`${code} (chưa phân loại ngành hàng)`);
      } else if (pLine !== line.id) {
        const other = await getLineLabelById(supabase, pLine);
        const want = await getLineLabelById(supabase, line.id);
        invalid.push(`${code} (thuộc ngành ${other}, file đang nhập ngành ${want})`);
      }
    }
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
    business_line_id: string;
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
          // P2: sản phẩm mới thuộc ngành của file import.
          business_line_id: line.id,
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
          business_line_id: line.id,
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
        business_line_id: line.id,
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
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được tạo phiếu gửi ký gửi.");
  // P2: phiếu thuộc một ngành; kiểm tra lô trước khi ghi phiếu.
  const line = await resolveWriteLine(supabase, optStr(formData, "business_line"));
  const raw = zipItems(formData, ["batch_id", "qty", "term", "transfer_price"]).filter(
    (r) => r.batch_id && Number(r.qty) > 0
  );
  if (!raw.length) throw new Error("Phiếu cần ít nhất một dòng lô hàng.");
  await assertBatchesInLine(supabase, raw.map((r) => String(r.batch_id)), line.id);
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
        business_line_id: line.id,
      })
      .select("id")
      .single(),
    "Tạo phiếu gửi ký gửi"
  );
  const batchIds = raw.map((r) => r.batch_id as string);
  const { data: batchInfos } = await supabase
    .from("stock_batches")
    .select("id, batch_code, ownership, unit_cost")
    .in("id", batchIds);
  const batchMap = new Map(((batchInfos ?? []) as AnyRow[]).map((b) => [b.id as string, b]));

  for (const r of raw) {
    const b = batchMap.get(r.batch_id as string);
    if (b && b.ownership === "CONSIGNED" && Number(r.transfer_price) < Number(b.unit_cost)) {
      throw new Error(
        `Không được gửi ký gửi lỗ ở Ô D (lô ${b.batch_code}: giá chuyển giao ${r.transfer_price} < giá vốn ${b.unit_cost}).`
      );
    }
  }

  const ownLocs = await mainOwnLocations(supabase, batchIds);
  const items = [];
  for (const r of raw) {
    const splits = splitAcrossShelves(
      ownLocs.get(r.batch_id as string),
      Math.trunc(Number(r.qty))
    );
    for (const s of splits) {
      items.push({
        slip_id: slip.id,
        batch_id: r.batch_id,
        from_location_id: s.locationId,
        qty: s.qty,
        term: r.term || "CONSIGNMENT",
        transfer_price: Number(r.transfer_price),
      });
    }
  }
  done(await supabase.from("consignment_out_items").insert(items), "Thêm dòng phiếu");
  revalidatePath("/consignment-out");
  redirect("/consignment-out?ok=1");
}

export async function confirmConsignmentOutAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được xác nhận phiếu gửi ký gửi.");
  await requireHeaderBusinessLine(supabase, "consignment_out_slips", str(formData, "id"), "Phiếu gửi ký gửi");
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
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được gửi ký gửi.");
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
  // P2: toàn bộ file thuộc một ngành — lô sai ngành / chưa phân loại đều
  // từ chối cả file (một phiếu GK chỉ thuộc một ngành, §10.2).
  const line = await resolveWriteLine(supabase, String(payload.businessLine ?? "").trim() || null);

  const batchCodes = Array.from(new Set(rawRows.map((r) => String(r.batchCode ?? "").trim()))).filter(Boolean);
  const { data: batches } = await supabase
    .from("stock_batches")
    .select("id, batch_code, ownership, supplier_id, unit_cost, product_id")
    .in("batch_code", batchCodes);
  const batchByCode = new Map(((batches ?? []) as AnyRow[]).map((b) => [normKey(b.batch_code), b]));
  const batchLineMap = await getProductLineMap(
    supabase,
    Array.from(batchByCode.values()).map((b) => String(b.product_id)),
  );
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
    // P2: lô phải thuộc ngành của file.
    const bLine = batchLineMap.get(String(batch.product_id));
    if (!bLine?.lineId) {
      invalid.push(`${code} (lô thuộc sản phẩm chưa phân loại ngành hàng)`);
      continue;
    }
    if (bLine.lineId !== line.id) {
      const other = await getLineLabelById(supabase, bLine.lineId);
      const want = await getLineLabelById(supabase, line.id);
      invalid.push(`${code} (lô thuộc ngành ${other}, file đang gửi ngành ${want})`);
      continue;
    }
    if (batch.ownership === "CONSIGNED" && !subOk.get(batch.supplier_id as string)) {
      invalid.push(`${code} (NCC chưa cho ký gửi tiếp)`);
      continue;
    }
    if (batch.ownership === "CONSIGNED" && price < Number(batch.unit_cost)) {
      invalid.push(`${code} (giá chuyển giao ${price} < giá vốn ${Number(batch.unit_cost)}, không được gửi lỗ ở Ô D)`);
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
      const heldBatchIds = Array.from(new Set(((held ?? []) as AnyRow[]).map((h) => h.batch_id as string)));
      const { data: allBatches } = heldBatchIds.length
        ? await supabase.from("stock_batches").select("id, unit_cost").in("id", heldBatchIds)
        : { data: [] as AnyRow[] };
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
        business_line_id: line.id,
      })
      .select("id")
      .single(),
    "Tạo phiếu gửi ký gửi"
  );
  const itemsToInsert: AnyRow[] = [];
  for (const r of rawRows) {
    const batch = batchByCode.get(normKey(String(r.batchCode ?? "").trim())) as AnyRow;
    const splits = splitAcrossShelves(
      mainOwn.get(batch.id as string),
      Math.trunc(Number(r.qty) || 0)
    );
    for (const s of splits) {
      itemsToInsert.push({
        slip_id: slip.id,
        batch_id: batch.id,
        from_location_id: s.locationId,
        qty: s.qty,
        term: r.term === "PURCHASE" ? "PURCHASE" : "CONSIGNMENT",
        transfer_price: Number(r.price) || 0,
      });
    }
  }
  done(
    await supabase.from("consignment_out_items").insert(itemsToInsert),
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
/**
 * Lõi tạo đơn bán từ FormData: tạo đơn + tách chứng từ BH/KG theo tính
 * chất lô + xác nhận ngay (trừ kho, cập nhật công nợ). Dùng chung cho
 * nhập đơn bán từ Excel (đường ghi nhận thông tin vẫn mở). Quầy bán lẻ
 * tại quầy KHÔNG gọi lõi này nữa — xem createCounterSaleAction.
 */
async function createSaleFromForm(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","SALES"], "Chỉ Chủ cửa hàng và Bán hàng mới được bán hàng.");
  const lines = zipItems(formData, ["batch_id", "qty", "unit_price"]).filter(
    (r) => r.batch_id && Number(r.qty) > 0
  );
  if (!lines.length) throw new Error("Đơn bán cần ít nhất một dòng lô hàng.");

  const batchIds = lines.map((l) => l.batch_id);
  const { data: batchRows, error } = await supabase
    .from("v_batches_for_sales")
    .select("batch_id, batch_code, product_id, ownership, business_line_id, business_line_code, expiry_date")
    .in("batch_id", batchIds);
  const batches = ((batchRows ?? []) as AnyRow[]).map((b) => ({ ...b, id: b.batch_id }));
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
  const { data: batchCosts } = await supabase
    .from("stock_batches")
    .select("id, unit_cost")
    .in("id", batchIds);
  const costMap = new Map(((batchCosts ?? []) as AnyRow[]).map((b) => [b.id as string, Number(b.unit_cost) || 0]));

  // P2 §9.3/E11 — checkout chung tách thành chứng từ riêng theo
  // (tính chất lô, ngành): tối đa 4 chứng từ (2 ngành × BH/KG). Mã
  // chứng từ vẫn BH/KG như cũ; ngành phân biệt bằng business_line_id.
  interface SaleGroup {
    kind: "BH" | "KG";
    lineId: string;
    lineCode: string;
    lines: AnyRow[];
  }
  const groups = new Map<string, SaleGroup>();
  // Ngày nghiệp vụ để xét hạn dùng: ngày bán trên chứng từ (file import
  // có thể ghi lùi ngày); không có thì ngày hiện tại.
  const businessDate = saleDate || todayISO();
  for (const l of lines) {
    const batch = batchMap.get(l.batch_id);
    if (!batch) throw new Error("Không tìm thấy lô hàng.");
    // P2: lô của sản phẩm chưa phân loại thì chưa bán được (chứng từ có
    // ngành chỉ nhận dòng cùng ngành; DB guard cũng chặn, đây báo sớm).
    if (!batch.business_line_id) {
      throw new Error(
        `Lô ${batch.batch_code} thuộc sản phẩm chưa phân loại ngành hàng — hãy phân loại trước khi bán.`,
      );
    }
    // P2 BL-006: lô dầu đã hết hạn thì không được bán (chặn ở đây cho
    // cả bán tay lẫn import; FEFO đã loại lô hết hạn từ bước phân bổ).
    if (
      isOilLineCode(batch.business_line_code) &&
      isExpiredBatch(batch.expiry_date, businessDate)
    ) {
      throw new Error(
        `Lô ${batch.batch_code} đã hết hạn ngày ${String(batch.expiry_date).slice(0, 10)} — không được bán. Kiểm tra lại lô dầu trước khi bán.`,
      );
    }
    const cost = costMap.get(l.batch_id as string) ?? 0;
    if (batch.ownership === "CONSIGNED" && cost > 0 && Number(l.unit_price) < cost) {
      throw new Error(`Không thể bán hàng ký gửi dưới giá vốn (giá bán ${Number(l.unit_price)} < giá vốn ${cost}).`);
    }
    const kind = batch.ownership === "OWNED" ? "BH" : "KG";
    const lineCode = String(batch.business_line_code ?? "");
    const key = `${kind}:${lineCode}`;
    let group = groups.get(key);
    if (!group) {
      group = { kind, lineId: String(batch.business_line_id ?? ""), lineCode, lines: [] };
      groups.set(key, group);
    }
    const splits = splitAcrossShelves(
      ownLocs.get(l.batch_id as string),
      Math.trunc(Number(l.qty))
    );
    for (const s of splits) {
      group.lines.push({
        product_id: batch.product_id,
        batch_id: l.batch_id,
        from_location_id: s.locationId,
        qty: s.qty,
        unit_price: Number(l.unit_price),
      });
    }
  }

  const discountRequested = num(formData, "discount_amount");
  // Giảm giá chỉ áp cho BH (như cũ); khi tách thành 2 chứng từ BH thì
  // chia theo tỷ lệ tiền hàng từng chứng từ, đồng cuối cùng dồn vào
  // chứng từ BH lớn nhất — tổng giảm giá không đổi.
  const bhGroups = Array.from(groups.values()).filter((g) => g.kind === "BH");
  const bhSubtotals = bhGroups.map((g) =>
    g.lines.reduce((a, l) => a + l.qty * l.unit_price, 0),
  );
  const bhTotal = bhSubtotals.reduce((a, b) => a + b, 0);
  const totalDiscount = Math.min(discountRequested, bhTotal);
  const discountByKey = new Map<string, number>();
  {
    let allocated = 0;
    bhGroups.forEach((g, i) => {
      const d =
        i === bhGroups.length - 1
          ? totalDiscount - allocated
          : Math.floor((totalDiscount * bhSubtotals[i]) / (bhTotal || 1));
      allocated += d;
      discountByKey.set(`${g.kind}:${g.lineCode}`, d);
    });
  }
  let orderTotal = 0;
  for (const [key, group] of Array.from(groups.entries())) {
    const docLines = group.lines;
    if (!docLines.length) continue;
    const subtotal = docLines.reduce((a, l) => a + l.qty * l.unit_price, 0);
    const discount = group.kind === "BH" ? discountByKey.get(key) ?? 0 : 0;
    const doc = must(
      await supabase
        .from("sales_documents")
        .insert({
          doc_kind: group.kind,
          sales_order_id: order.id,
          partner_id: partnerId,
          customer_name: optStr(formData, "customer_name"),
          is_credit: formData.get("is_credit") === "on",
          discount_amount: discount,
          created_by: await userId(),
          business_line_id: group.lineId,
          ...(saleDate ? { doc_date: saleDate } : {}),
        })
        .select("id")
        .single(),
      `Tạo chứng từ ${group.kind}`
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
 * Bán lẻ tại quầy (POS) — TẠM DỪNG theo quyết định 2026-10-30: chỉ tắt
 * đường bán lẻ trực tiếp, còn ghi nhận đơn bán qua Excel vẫn mở (đi qua
 * createSaleFromForm). Giữ action này để mọi form POST cũ/giả mạo đều bị
 * chặn ở server, không chỉ ẩn trên giao diện. Mở lại: cho PosSaleForm
 * gọi lại createSaleFromForm và gỡ dòng throw này.
 */
export async function createCounterSaleAction() {
  throw new Error("Bán lẻ tại quầy đang tạm dừng — ghi nhận đơn bán bằng “Nhập từ Excel (Bán hàng)” ở trang Bán hàng.");
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
  await requireRole(["OWNER","SALES"], "Chỉ Chủ cửa hàng và Bán hàng mới được bán hàng.");
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
    .select("id, name, sku, retail_price, garage_price, wholesale_price, business_line_id")
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

  // P2: mọi sản phẩm trong file phải thuộc ngành user được làm việc.
  // Ngữ cảnh LINE -> chỉ đúng ngành đó; ALL -> cả hai ngành đều được
  // (checkout tách ở createSaleFromForm); chưa phân loại -> từ chối.
  const ctx = await getBusinessLineContext();
  if (ctx.mode === "NONE") {
    throw new Error("Tài khoản chưa được gán ngành hàng — nhờ chủ cửa hàng gán ngành trước khi bán hàng.");
  }
  const lineByProduct = new Map(
    ((allProducts ?? []) as AnyRow[]).map((p) => [
      p.id as string,
      (p.business_line_id as string | null) ?? null,
    ]),
  );
  const lineInvalid: string[] = [];
  for (const r of resolved) {
    const pLine = lineByProduct.get(r.productId);
    if (!pLine) {
      lineInvalid.push(`${r.label} (chưa phân loại ngành hàng)`);
    } else if (ctx.mode === "LINE" && pLine !== ctx.lineId) {
      lineInvalid.push(`${r.label} (không thuộc ngành đang làm việc)`);
    }
  }
  if (lineInvalid.length) rejectImport(lineInvalid);

  // Hàng đợi FIFO theo sản phẩm: lô cũ nhất (received_date, rồi mã lô)
  // trước; nhớt thì FEFO — hạn dùng gần nhất trước, lô không hạn xếp
  // sau cùng rồi mới theo FIFO. Lô dầu HẾT HẠN (tính theo ngày bán của
  // file) bị loại khỏi hàng đợi bán thường (BL-006). Tồn khả dụng của
  // mỗi lô = tồn tại vị trí kho mình giữ nhiều nhất — đúng vị trí phiếu
  // sẽ trừ.
  const { data: batchRows } = productIds.length
    ? await supabase
        .from("v_batches_for_sales")
        .select("batch_id, batch_code, product_id, ownership, received_date, expiry_date, business_line_code")
        .in("product_id", productIds)
    : { data: [] as AnyRow[] };
  const batches = ((batchRows ?? []) as AnyRow[]).map((b) => ({ ...b, id: b.batch_id }));
  const batchIds = ((batches ?? []) as AnyRow[]).map((b) => b.id as string);
  const ownLocs = await mainOwnLocations(supabase, batchIds);
  const fifoByProduct = new Map<string, { id: string; qty: number }[]>();
  // P2: FEFO theo ngành chuẩn business_line_code (không theo tên nhóm);
  // lô dầu hết hạn loại khỏi hàng đợi (createSaleFromForm chặn lại lần nữa).
  for (const b of ((batches ?? []) as AnyRow[]).sort((x, y) =>
    compareLotOrder(x, y, isOilLineCode(x.business_line_code))
  )) {
    if (isOilLineCode(b.business_line_code) && isExpiredBatch(b.expiry_date, saleDate)) continue;
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
      invalid.push(`${r.label} (không đủ hàng, còn ${r.qty - need})`);
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
  return createSaleFromForm(fd);
}

// ------------------------------------------------- partner consumption
export async function createConsumptionReportAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","SALES","ACCOUNTING"], "Chỉ Chủ cửa hàng, Bán hàng và Kế toán mới được tạo báo cáo tiêu thụ.");
  // P2: báo cáo thuộc một ngành; kiểm tra dòng trước khi ghi báo cáo.
  const line = await resolveWriteLine(supabase, optStr(formData, "business_line"));
  const rawItems = zipItems(formData, ["product_id", "qty_consumed"])
    .filter((r) => r.product_id && Number(r.qty_consumed) > 0);
  if (!rawItems.length) throw new Error("Báo cáo cần ít nhất một dòng hàng.");
  await assertProductsInLine(supabase, rawItems.map((r) => String(r.product_id)), line.id);
  const report = must(
    await supabase
      .from("consumption_reports")
      .insert({
        partner_id: str(formData, "partner_id"),
        period_from: str(formData, "period_from"),
        period_to: str(formData, "period_to"),
        note: optStr(formData, "note"),
        created_by: await userId(),
        business_line_id: line.id,
      })
      .select("id")
      .single(),
    "Tạo báo cáo tiêu thụ"
  );
  const items = rawItems
    .map((r) => ({
      report_id: report.id,
      product_id: r.product_id,
      qty_consumed: Math.trunc(Number(r.qty_consumed)),
    }));
  done(await supabase.from("consumption_report_items").insert(items), "Thêm dòng báo cáo");
  revalidatePath("/partner-consumption");
  redirect("/partner-consumption?ok=1");
}

export async function setConsumptionReportStatusAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","SALES","ACCOUNTING"], "Chỉ Chủ cửa hàng, Bán hàng và Kế toán mới được đổi trạng thái báo cáo.");
  // P2: chỉ xác nhận báo cáo đã có ngành.
  if (str(formData, "status") === "CONFIRMED") {
    await requireHeaderBusinessLine(supabase, "consumption_reports", str(formData, "id"), "Báo cáo tiêu thụ");
  }
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
  await requireRole(["OWNER","SALES","ACCOUNTING"], "Chỉ Chủ cửa hàng, Bán hàng và Kế toán mới được tạo phiếu phân bổ.");
  // P2: phiếu thuộc một ngành; kiểm tra dòng (sản phẩm + lô) trước khi ghi.
  const line = await resolveWriteLine(supabase, optStr(formData, "business_line"));
  const rawLines = zipItems(formData, ["product_id", "batch_id", "nature", "qty", "unit_price"])
    .filter((r) => r.batch_id && r.product_id && Number(r.qty) > 0);
  if (!rawLines.length) throw new Error("Phiếu phân bổ cần ít nhất một dòng.");
  await assertProductsInLine(supabase, rawLines.map((r) => String(r.product_id)), line.id);
  await assertBatchesInLine(supabase, rawLines.map((r) => String(r.batch_id)), line.id);
  const slip = must(
    await supabase
      .from("allocation_slips")
      .insert({
        report_id: optStr(formData, "report_id"),
        partner_id: str(formData, "partner_id"),
        note: optStr(formData, "note"),
        created_by: await userId(),
        business_line_id: line.id,
      })
      .select("id")
      .single(),
    "Tạo phiếu phân bổ"
  );
  const lines = rawLines
    .map((r) => ({
      allocation_id: slip.id,
      product_id: r.product_id,
      batch_id: r.batch_id,
      nature: r.nature || "CONSIGNED",
      qty: Math.trunc(Number(r.qty)),
      unit_price: Number(r.unit_price),
    }));
  done(await supabase.from("allocation_lines").insert(lines), "Thêm dòng phân bổ");
  revalidatePath("/partner-consumption");
  redirect(`/partner-consumption/allocations/${slip.id}?ok=1`);
}

export async function confirmAllocationAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","SALES","ACCOUNTING"], "Chỉ Chủ cửa hàng, Bán hàng và Kế toán mới được xác nhận phân bổ.");
  await requireHeaderBusinessLine(supabase, "allocation_slips", str(formData, "id"), "Phiếu phân bổ");
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
  await requireRole(["OWNER","SALES","ACCOUNTING"], "Chỉ Chủ cửa hàng, Bán hàng và Kế toán mới được nhập báo cáo tiêu thụ.");
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

  // P2 §10.4: một file BT có thể chứa cả hai ngành — tách thành báo cáo
  // riêng theo ngành, giữ nguyên đối tác + kỳ. Ngữ cảnh LINE thì chỉ
  // nhận đúng ngành đó (dòng ngành khác -> từ chối cả file); chưa phân
  // loại -> từ chối (không lặng lẽ bỏ dòng).
  const ctx = await getBusinessLineContext();
  if (ctx.mode === "NONE") {
    throw new Error("Tài khoản chưa được gán ngành hàng — nhờ chủ cửa hàng gán ngành trước khi nhập báo cáo.");
  }
  const lineMap = await getProductLineMap(supabase, items.map((i) => i.product_id));
  const codeByProduct = new Map<string, string>();
  for (const r of rawRows) {
    const pid = bySku.get(normKey(String(r.code ?? "").trim())) ?? byCode.get(normKey(String(r.code ?? "").trim()));
    if (pid) codeByProduct.set(pid, String(r.code ?? "").trim());
  }
  const groups = splitByBusinessLine(items, (i) => lineMap.get(i.product_id)?.lineId ?? null);
  const unclassified = groups.get("") ?? [];
  if (unclassified.length) {
    rejectImport(unclassified.map((i) => `${codeByProduct.get(i.product_id) ?? i.product_id} (chưa phân loại ngành hàng)`));
  }
  if (ctx.mode === "LINE") {
    const foreign = Array.from(groups.keys()).filter((k) => k !== ctx.lineId);
    if (foreign.length) {
      const want = await getLineLabelById(supabase, ctx.lineId);
      throw new Error(
        `File có dòng thuộc ngành khác — đang ở ngữ cảnh ${want}. Chuyển ngữ cảnh sang Toàn doanh nghiệp để tách thành 2 báo cáo, hoặc tách file theo ngành rồi nhập lại.`,
      );
    }
  }

  const me = await userId();
  for (const [lineId, gItems] of Array.from(groups.entries())) {
    const report = must(
      await supabase
        .from("consumption_reports")
        .insert({
          partner_id: partnerId,
          period_from: periodFrom,
          period_to: periodTo,
          created_by: me,
          business_line_id: lineId,
        })
        .select("id")
        .single(),
      "Tạo báo cáo tiêu thụ",
    );
    done(
      await supabase.from("consumption_report_items").insert(
        gItems.map((i) => ({ report_id: report.id, ...i })),
      ),
      "Thêm dòng báo cáo",
    );
    if (confirmNow) {
      done(
        await supabase
          .from("consumption_reports")
          .update({ status: "CONFIRMED" })
          .eq("id", report.id),
        "Xác nhận báo cáo",
      );
    }
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
  await requireRole(["OWNER","SALES","ACCOUNTING"], "Chỉ Chủ cửa hàng, Bán hàng và Kế toán mới được nhập phân bổ.");
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
  if (!partnerLoc) throw new Error("Đối tác chưa có kho riêng trên hệ thống (chưa từng nhận ký gửi).");

  const { data: allProducts } = await supabase.from("products").select("id, sku").limit(5000);
  const { data: allCodes } = await supabase.from("product_codes").select("code, product_id").limit(10000);
  const bySku = new Map(((allProducts ?? []) as AnyRow[]).map((p) => [normKey(p.sku), p.id as string]));
  const byCode = new Map(((allCodes ?? []) as AnyRow[]).map((c) => [normKey(c.code), c.product_id as string]));
  const batchCodes = Array.from(new Set(rawRows.map((r) => String(r.batchCode ?? "").trim()))).filter(Boolean);
  const { data: batchRows } = await supabase
    .from("v_batches_for_sales")
    .select("batch_id, batch_code, product_id")
    .in("batch_code", batchCodes);
  const batches = ((batchRows ?? []) as AnyRow[]).map((b) => ({ ...b, id: b.batch_id }));
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

  // P2 §10.4: tách file PB theo ngành như BT (một phiếu PB chỉ thuộc
  // một ngành). Ngữ cảnh LINE thì chỉ nhận đúng ngành đó; chưa phân
  // loại -> từ chối cả file.
  const ctx = await getBusinessLineContext();
  if (ctx.mode === "NONE") {
    throw new Error("Tài khoản chưa được gán ngành hàng — nhờ chủ cửa hàng gán ngành trước khi nhập phân bổ.");
  }
  const pbLineMap = await getProductLineMap(supabase, lines.map((l) => l.product_id));
  const pbCodeByBatch = new Map(
    Array.from(batchByCode.values()).map((b) => [String(b.id), String(b.batch_code)]),
  );
  const pbGroups = splitByBusinessLine(lines, (l) => pbLineMap.get(l.product_id)?.lineId ?? null);
  const pbUnclassified = pbGroups.get("") ?? [];
  if (pbUnclassified.length) {
    rejectImport(pbUnclassified.map((l) => `${pbCodeByBatch.get(l.batch_id) ?? l.batch_id} (chưa phân loại ngành hàng)`));
  }
  if (ctx.mode === "LINE") {
    const foreign = Array.from(pbGroups.keys()).filter((k) => k !== ctx.lineId);
    if (foreign.length) {
      const want = await getLineLabelById(supabase, ctx.lineId);
      throw new Error(
        `File có dòng thuộc ngành khác — đang ở ngữ cảnh ${want}. Chuyển ngữ cảnh sang Toàn doanh nghiệp để tách thành 2 phiếu, hoặc tách file theo ngành rồi nhập lại.`,
      );
    }
  }

  const me = await userId();
  const createdSlips: string[] = [];
  for (const [lineId, gLines] of Array.from(pbGroups.entries())) {
    const slip = must(
      await supabase
        .from("allocation_slips")
        .insert({ report_id: reportId, partner_id: partnerId, created_by: me, business_line_id: lineId })
        .select("id")
        .single(),
      "Tạo phiếu phân bổ",
    );
    done(
      await supabase.from("allocation_lines").insert(
        gLines.map((l) => ({ allocation_id: slip.id, ...l })),
      ),
      "Thêm dòng phân bổ",
    );
    if (confirmNow) {
      const { error } = await supabase.rpc("confirm_allocation", { p_allocation_id: slip.id });
      if (error) throw new Error(error.message);
    }
    createdSlips.push(slip.id as string);
  }
  revalidatePath("/partner-consumption");
  if (createdSlips.length === 1) redirect(`/partner-consumption/allocations/${createdSlips[0]}?ok=1`);
  redirect("/partner-consumption?ok=1");
}

/** Turn a CONFIRMED allocation into BH/KG documents (one per nature), then confirm them. */
export async function createAllocationDocumentsAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","SALES"], "Chỉ Chủ cửa hàng và Bán hàng mới được lập chứng từ từ phân bổ.");
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
  if (!pending.length) throw new Error("Mọi dòng đã chia đều đã có phiếu bán rồi.");

  const fromLocation = await partnerLocationId(supabase, slip.partner_id);
  if (!fromLocation) throw new Error("Không tìm thấy kho của đối tác trên hệ thống.");

  // P2 §9.3/E11: một lần chia có thể tạo tối đa 4 chứng từ (2 ngành ×
  // BH/KG). Dòng chưa phân loại -> từ chối (không đoán ngành); lô dầu
  // hết hạn -> chặn bán (BL-006, tính theo ngày hôm nay vì chứng từ
  // phân bổ không có ngày lùi).
  const allocLineMap = await getProductLineMap(
    supabase,
    pending.map((l: AnyRow) => String(l.product_id)),
  );
  const allocBatchIds = Array.from(new Set(pending.map((l: AnyRow) => String(l.batch_id)).filter(Boolean)));
  const { data: allocBatches } = allocBatchIds.length
    ? await supabase.from("stock_batches").select("id, batch_code, expiry_date").in("id", allocBatchIds)
    : { data: [] as AnyRow[] };
  const allocBatchById = new Map(((allocBatches ?? []) as AnyRow[]).map((b) => [String(b.id), b]));
  const allocToday = todayISO();
  for (const l of pending as AnyRow[]) {
    const entry = allocLineMap.get(String(l.product_id));
    if (!entry?.lineId) {
      throw new Error("Một dòng phân bổ thuộc sản phẩm chưa phân loại ngành hàng — hãy phân loại trước khi lập chứng từ.");
    }
    if (isOilLineCode(entry.code)) {
      const b = allocBatchById.get(String(l.batch_id));
      if (b && isExpiredBatch(b.expiry_date, allocToday)) {
        throw new Error(
          `Lô ${b.batch_code} đã hết hạn ngày ${String(b.expiry_date).slice(0, 10)} — không được bán. Kiểm tra lại lô dầu trước khi lập chứng từ.`,
        );
      }
    }
  }
  const groups = new Map<string, { kind: "BH" | "KG"; lineId: string; lines: AnyRow[] }>();
  for (const l of pending as AnyRow[]) {
    const kind = l.nature === "PURCHASED" ? "BH" : "KG";
    const lineId = allocLineMap.get(String(l.product_id))?.lineId as string;
    const key = `${kind}:${lineId}`;
    let group = groups.get(key);
    if (!group) {
      group = { kind, lineId, lines: [] };
      groups.set(key, group);
    }
    group.lines.push(l);
  }
  for (const group of Array.from(groups.values())) {
    const doc = must(
      await supabase
        .from("sales_documents")
        .insert({
          doc_kind: group.kind,
          allocation_id: allocationId,
          partner_id: slip.partner_id,
          is_credit: true,
          created_by: await userId(),
          business_line_id: group.lineId,
        })
        .select("id")
        .single(),
      `Tạo chứng từ ${group.kind}`
    );
    done(
      await supabase.from("sales_document_lines").insert(
        group.lines.map((l: AnyRow) => ({
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
  await requireRole(["OWNER","ACCOUNTING"], "Chỉ Chủ cửa hàng và Kế toán mới được xuất hoá đơn GTGT.");
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
  await requireRole(["OWNER","ACCOUNTING"], "Chỉ Chủ cửa hàng và Kế toán mới được huỷ hoá đơn GTGT.");
  const { error } = await supabase.rpc("cancel_vat_invoice", {
    p_invoice_id: str(formData, "id"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/invoices");
  revalidatePath("/partner-consumption");
}

/**
 * FE-04: Luồng 1-click "Xác nhận & Xuất Hoá đơn GTGT" ngay tại trang chi tiết phân bổ.
 * Thực hiện chuỗi tuần tự:
 * 1. Nếu phiếu phân bổ là DRAFT -> RPC confirm_allocation
 * 2. Tạo chứng từ BH/KG cho các dòng phân bổ chưa có chứng từ -> RPC confirm_sales_document
 * 3. Tạo Hoá đơn GTGT cho các dòng chứng từ chưa xuất hoá đơn -> RPC create_vat_invoice
 */
export async function confirmAndIssueVatInvoiceAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","ACCOUNTING"], "Chỉ Chủ cửa hàng và Kế toán mới được xác nhận và xuất hoá đơn.");
  const allocationId = str(formData, "id");
  const invoiceNo = optStr(formData, "invoice_no") || `HD-${Date.now().toString().slice(-6)}`;
  const symbol = optStr(formData, "symbol") || "1C26TBB";
  const invoiceDate = optDate(formData, "invoice_date") ?? todayISO();
  const provider = optStr(formData, "provider") || "Nội bộ";

  // 1. Kiểm tra phiếu phân bổ
  const { data: slip } = await supabase
    .from("allocation_slips")
    .select("id, doc_code, partner_id, status")
    .eq("id", allocationId)
    .single();
  if (!slip) throw new Error("Không tìm thấy phiếu phân bổ.");

  // Nếu phiếu còn DRAFT, gọi confirm_allocation
  if (slip.status === "DRAFT") {
    const { error: confErr } = await supabase.rpc("confirm_allocation", {
      p_allocation_id: slip.id,
    });
    if (confErr) throw new Error(confErr.message);
  }

  // 2. Tạo chứng từ BH/KG cho các dòng chưa có chứng từ (nếu có)
  const { data: lines } = await supabase
    .from("allocation_lines")
    .select("id, product_id, batch_id, nature, qty, unit_price")
    .eq("allocation_id", allocationId);

  const lineIds = (lines ?? []).map((l: AnyRow) => l.id as string);
  const { data: existingLines } = lineIds.length
    ? await supabase
        .from("sales_document_lines")
        .select("allocation_line_id")
        .in("allocation_line_id", lineIds)
    : { data: [] as AnyRow[] };
  const doneSet = new Set(
    ((existingLines ?? []) as AnyRow[]).map((r) => r.allocation_line_id as string)
  );

  const pending = (lines ?? []).filter((l: AnyRow) => !doneSet.has(l.id));
  if (pending.length > 0) {
    const fromLocation = await partnerLocationId(supabase, slip.partner_id);
    if (!fromLocation) throw new Error("Không tìm thấy kho của đối tác trên hệ thống.");

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
  }

  // 3. Lấy tất cả sales_document_lines chưa xuất hoá đơn của phiếu phân bổ này
  const { data: docLineRows } = lineIds.length
    ? await supabase
        .from("sales_document_lines")
        .select("id, allocation_line_id")
        .in("allocation_line_id", lineIds)
    : { data: [] as AnyRow[] };

  const candidateDocLineIds = ((docLineRows ?? []) as AnyRow[]).map(
    (l) => l.id as string
  );

  // Lọc ra các dòng chưa có vat_invoice_lines active
  const { data: invoicedLines } = candidateDocLineIds.length
    ? await supabase
        .from("vat_invoice_lines")
        .select("sales_document_line_id")
        .in("sales_document_line_id", candidateDocLineIds)
        .eq("is_active", true)
    : { data: [] as AnyRow[] };

  const invoicedLineSet = new Set(
    ((invoicedLines ?? []) as AnyRow[]).map((r) => r.sales_document_line_id as string)
  );
  const linesToInvoice = candidateDocLineIds.filter((id) => !invoicedLineSet.has(id));

  if (linesToInvoice.length > 0) {
    const { error: invErr } = await supabase.rpc("create_vat_invoice", {
      p_partner_id: slip.partner_id,
      p_invoice_no: invoiceNo,
      p_symbol: symbol,
      p_invoice_date: invoiceDate,
      p_provider: provider,
      p_line_ids: linesToInvoice,
    });
    if (invErr) throw new Error(invErr.message);
  }

  revalidatePath("/partner-consumption");
  revalidatePath(`/partner-consumption/allocations/${allocationId}`);
  revalidatePath("/invoices");
  revalidatePath("/receivables");
  redirect(`/partner-consumption/allocations/${allocationId}?ok=1`);
}

// ----------------------------------------------------------------- returns
export async function createReturnAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được tạo phiếu trả hàng.");
  const kind = str(formData, "return_kind");
  const partnerId = optStr(formData, "partner_id");
  // P2: phiếu trả thuộc một ngành; kiểm tra lô trước khi ghi phiếu.
  const line = await resolveWriteLine(supabase, optStr(formData, "business_line"));
  const raw = zipItems(formData, ["batch_id", "qty", "reason"]).filter(
    (r) => r.batch_id && Number(r.qty) > 0
  );
  if (!raw.length) throw new Error("Phiếu trả cần ít nhất một dòng lô hàng.");
  await assertBatchesInLine(supabase, raw.map((r) => String(r.batch_id)), line.id);
  const doc = must(
    await supabase
      .from("return_documents")
      .insert({
        return_kind: kind,
        partner_id: partnerId,
        supplier_id: optStr(formData, "supplier_id"),
        note: optStr(formData, "note"),
        created_by: await userId(),
        business_line_id: line.id,
      })
      .select("id")
      .single(),
    "Tạo phiếu trả hàng"
  );
  const defaultWh = await defaultWarehouseId(supabase);
  const ownLocs =
    kind === "SUPPLIER_RETURN"
      ? await mainOwnLocations(
          supabase,
          raw.map((r) => r.batch_id as string)
        )
      : new Map<string, BatchOwnStockInfo>();
  const items = [];
  for (const r of raw) {
    if (kind === "CUSTOMER_RETURN") {
      items.push({
        return_id: doc.id,
        batch_id: r.batch_id,
        from_location_id: null,
        to_location_id: defaultWh ?? null,
        qty: Math.trunc(Number(r.qty)),
        reason: r.reason || "OTHER",
      });
    } else if (kind === "PARTNER_RETURN") {
      if (!partnerId) throw new Error("Trả hàng từ đối tác cần chọn đối tác.");
      const fromLoc = (await partnerLocationId(supabase, partnerId)) ?? null;
      items.push({
        return_id: doc.id,
        batch_id: r.batch_id,
        from_location_id: fromLoc,
        to_location_id: defaultWh ?? null,
        qty: Math.trunc(Number(r.qty)),
        reason: r.reason || "OTHER",
      });
    } else if (kind === "SUPPLIER_RETURN") {
      const splits = splitAcrossShelves(
        ownLocs.get(r.batch_id as string),
        Math.trunc(Number(r.qty))
      );
      for (const s of splits) {
        items.push({
          return_id: doc.id,
          batch_id: r.batch_id,
          from_location_id: s.locationId,
          to_location_id: null,
          qty: s.qty,
          reason: r.reason || "OTHER",
        });
      }
    }
  }
  done(await supabase.from("return_items").insert(items), "Thêm dòng trả hàng");
  revalidatePath("/returns");
  redirect("/returns?ok=1");
}

export async function confirmReturnAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được xác nhận phiếu trả hàng.");
  await requireHeaderBusinessLine(supabase, "return_documents", str(formData, "id"), "Phiếu trả hàng");
  const { error } = await supabase.rpc("confirm_return_document", {
    p_return_id: str(formData, "id"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/returns");
  revalidatePath("/inventory");
}

// ------------------------------------------------------- payables / money
/** Quỹ tiền phải khớp phương thức: tiền mặt -> két tiền mặt, chuyển khoản -> tài khoản ngân hàng. */
async function validateFundForMethod(
  supabase: Awaited<ReturnType<typeof db>>,
  fundId: string,
  method: string
) {
  if (!fundId) throw new Error("Chọn quỹ tiền cho lần thu/chi này.");
  const { data: fund } = await supabase
    .from("cash_funds")
    .select("id, kind, is_active")
    .eq("id", fundId)
    .maybeSingle();
  if (!fund) throw new Error("Không tìm thấy quỹ tiền đã chọn.");
  if (!fund.is_active) throw new Error("Quỹ tiền đã chọn đang tắt — chọn quỹ khác hoặc bật lại ở Cài đặt.");
  if (method === "CASH" && fund.kind !== "CASH")
    throw new Error("Quỹ đã chọn là tài khoản ngân hàng — thanh toán tiền mặt phải chọn két tiền mặt.");
  if (method !== "CASH" && fund.kind !== "BANK")
    throw new Error("Quỹ đã chọn là két tiền mặt — chuyển khoản phải chọn tài khoản ngân hàng.");
}

export async function recordPayablePaymentAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","ACCOUNTING"], "Chỉ Chủ cửa hàng và Kế toán mới được ghi nhận thanh toán.");
  const method = str(formData, "method") || "BANK";
  const fundId = str(formData, "fund_id");
  await validateFundForMethod(supabase, fundId, method);
  done(
    await supabase.from("payments").insert({
      payment_kind: "OUT",
      payable_id: str(formData, "payable_id"),
      amount: num(formData, "amount"),
      method,
      fund_id: fundId,
      payment_date: optDate(formData, "payment_date") ?? undefined,
      note: optStr(formData, "note"),
      created_by: await userId(),
    }),
    "Ghi nhận thanh toán"
  );
  revalidatePath("/payables");
  revalidatePath("/dashboard");
  redirect("/payables?ok=1");
}

export async function recordReceivablePaymentAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","ACCOUNTING"], "Chỉ Chủ cửa hàng và Kế toán mới được ghi nhận thu tiền.");
  const method = str(formData, "method") || "BANK";
  const fundId = str(formData, "fund_id");
  await validateFundForMethod(supabase, fundId, method);
  done(
    await supabase.from("payments").insert({
      payment_kind: "IN",
      receivable_id: str(formData, "receivable_id"),
      amount: num(formData, "amount"),
      method,
      fund_id: fundId,
      payment_date: optDate(formData, "payment_date") ?? undefined,
      note: optStr(formData, "note"),
      created_by: await userId(),
    }),
    "Ghi nhận thu tiền"
  );
  revalidatePath("/receivables");
  revalidatePath("/dashboard");
  redirect("/receivables?ok=1");
}

export async function createSettlementAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","ACCOUNTING"], "Chỉ Chủ cửa hàng và Kế toán mới được tạo đợt chốt sổ.");
  const partyKind = str(formData, "party_kind");
  const isSupplier = partyKind === "SUPPLIER";
  const selectedIds = formData
    .getAll(isSupplier ? "payable_id" : "receivable_id")
    .map((v) => String(v));
  if (!selectedIds.length) throw new Error("Chọn ít nhất một khoản nợ chưa trả hết.");

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
    "Tạo đợt chốt sổ"
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
    "Thêm dòng chốt sổ"
  );
  revalidatePath(isSupplier ? "/payables" : "/receivables");
  redirect(`${isSupplier ? "/payables" : "/receivables"}?ok=1`);
}

// ---------------------------------------------------------------- settings
export async function updateVatModeAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","ACCOUNTING"], "Chỉ Chủ cửa hàng và Kế toán mới được thay đổi chế độ hoá đơn GTGT.");
  done(
    await supabase.from("app_settings").upsert({
      key: "vat_invoice_mode",
      value: str(formData, "vat_invoice_mode") || "COMBINED",
    }),
    "Lưu cài đặt"
  );
  revalidatePath("/settings");
}

// ------------------------------------------------------------- quỹ tiền
export async function createCashFundAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được thêm quỹ tiền.");
  const name = str(formData, "name");
  if (!name) throw new Error("Thiếu tên quỹ tiền.");
  const opening = num(formData, "opening_balance");
  if (opening < 0) throw new Error("Số dư đầu kỳ không được âm.");
  const openingDate = str(formData, "opening_balance_date") || "2026-01-01";
  done(
    await supabase.from("cash_funds").insert({
      name,
      kind: str(formData, "kind") === "BANK" ? "BANK" : "CASH",
      opening_balance: opening,
      opening_balance_date: openingDate,
    }),
    "Thêm quỹ tiền"
  );
  revalidatePath("/settings");
  revalidatePath("/cashflow");
  const returnTo = optStr(formData, "return_to");
  if (returnTo) redirect(returnTo);
  redirect("/settings?ok=1");
}

export async function updateCashFundAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được sửa quỹ tiền.");
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!id || !name) throw new Error("Thiếu tên quỹ tiền.");
  const opening = num(formData, "opening_balance");
  if (opening < 0) throw new Error("Số dư đầu kỳ không được âm.");
  const openingDate = optStr(formData, "opening_balance_date");
  const updateData: AnyRow = {
    name,
    opening_balance: opening,
    is_active: formData.get("is_active") === "on",
  };
  if (openingDate) {
    updateData.opening_balance_date = openingDate;
  }
  done(
    await supabase.from("cash_funds").update(updateData).eq("id", id),
    "Cập nhật quỹ tiền"
  );
  revalidatePath("/settings");
  revalidatePath("/cashflow");
  const returnTo = optStr(formData, "return_to");
  if (returnTo) redirect(returnTo);
  redirect("/settings?ok=1");
}

export async function createStockAdjustmentAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER","WAREHOUSE"], "Chỉ Chủ cửa hàng và Thủ kho mới được điều chỉnh kho.");
  // P2: chỉ điều chỉnh lô thuộc ngành mình được làm việc (danh sách lô
  // trên giao diện đã lọc theo ngành; đây là kiểm tra lại phía server).
  const ctx = await getBusinessLineContext();
  if (ctx.mode === "NONE") {
    throw new Error("Tài khoản chưa được gán ngành hàng — nhờ chủ cửa hàng gán ngành trước khi điều chỉnh kho.");
  }
  if (ctx.mode === "LINE") {
    const batchId = str(formData, "batch_id");
    const { data: batch } = await supabase
      .from("stock_batches")
      .select("product_id")
      .eq("id", batchId)
      .maybeSingle();
    if (batch) {
      const lineMap = await getProductLineMap(supabase, [String(batch.product_id)]);
      const entry = lineMap.get(String(batch.product_id));
      if (!entry?.lineId || entry.lineId !== ctx.lineId) {
        throw new Error("Lô hàng này không thuộc ngành đang làm việc — đổi ngữ cảnh ngành rồi thử lại.");
      }
    }
  }
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
 * Đã siết chặt: cấm gọi unauthenticated (chống DoS đổi mật khẩu — FS-01).
 * Chỉ Chủ cửa hàng mới được chủ động gắn cờ bắt buộc đổi mật khẩu cho tài khoản.
 */
export async function flagPasswordResetRequestedAction(emailRaw: string) {
  const { admin } = await requireOwnerAdmin();
  const email = emailRaw.trim().toLowerCase();
  if (!email) return;
  await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("email", email);
  revalidatePath("/settings");
}

/**
 * Gỡ cờ "phải đổi mật khẩu" sau khi người dùng đăng nhập và đổi mật khẩu thành công.
 * Thực thi an toàn trên máy chủ cho chính tài khoản đang đăng nhập.
 */
export async function completePasswordChangeAction() {
  const supabase = await db();
  const uid = await userId();
  if (!uid) throw new Error("Chưa đăng nhập.");
  const admin = createAdminClient();
  if (admin) {
    await admin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", uid);
  } else {
    const { error: rpcErr } = await supabase.rpc("complete_password_change");
    if (rpcErr) {
      await supabase
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", uid);
    }
  }
  revalidatePath("/dashboard");
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

// ------------------------------------------------------------- Sổ Quản Trị & Khoản Mục Thu Chi
export async function createCashCategoryAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được tạo khoản mục thu/chi.");
  const uid = await userId();

  const rawCode = str(formData, "code");
  const name = str(formData, "name");
  const kind = str(formData, "kind") === "IN" ? "IN" : "OUT";
  const rawGroup = str(formData, "group_key").toUpperCase();
  const groupKey = ["SALARY", "RENT", "TRANSPORT", "TAX", "OTHER"].includes(rawGroup)
    ? rawGroup
    : "OTHER";
  const isFixed = formData.get("is_fixed") === "on" || formData.get("is_fixed") === "true";
  const monthlyBudget = Math.max(0, num(formData, "monthly_budget"));

  if (!rawCode) throw new Error("Mã khoản mục không được để trống.");
  if (!name) throw new Error("Tên khoản mục không được để trống.");

  const code = storeCode(rawCode.toUpperCase());

  done(
    await supabase.from("cash_categories").insert({
      code,
      name,
      kind,
      group_key: groupKey,
      is_fixed: isFixed,
      monthly_budget: monthlyBudget,
      is_active: true,
      is_system: false,
      created_by: uid,
    }),
    "Tạo khoản mục thu chi"
  );

  revalidatePath("/settings");
  revalidatePath("/cashflow");
  const returnTo = optStr(formData, "return_to");
  if (returnTo) redirect(returnTo);
  return { ok: true };
}

export async function updateCashCategoryAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được cập nhật khoản mục thu/chi.");

  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!id) throw new Error("Thiếu ID khoản mục.");
  if (!name) throw new Error("Tên khoản mục không được để trống.");

  const updateData: AnyRow = {
    name,
  };

  const rawGroup = str(formData, "group_key").toUpperCase();
  if (rawGroup && ["SALARY", "RENT", "TRANSPORT", "TAX", "OTHER"].includes(rawGroup)) {
    updateData.group_key = rawGroup;
  }

  if (formData.has("is_fixed")) {
    updateData.is_fixed = formData.get("is_fixed") === "on" || formData.get("is_fixed") === "true";
  }

  if (formData.has("monthly_budget")) {
    updateData.monthly_budget = Math.max(0, num(formData, "monthly_budget"));
  }

  if (formData.has("is_active")) {
    updateData.is_active = formData.get("is_active") === "on" || formData.get("is_active") === "true";
  }

  done(
    await supabase.from("cash_categories").update(updateData).eq("id", id),
    "Cập nhật khoản mục thu chi"
  );

  revalidatePath("/settings");
  revalidatePath("/cashflow");
  const returnTo = optStr(formData, "return_to");
  if (returnTo) redirect(returnTo);
  return { ok: true };
}

export async function toggleCashCategoryAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được bật/tắt khoản mục.");

  const id = str(formData, "id");
  if (!id) throw new Error("Thiếu ID khoản mục.");

  let nextActive: boolean;
  if (formData.has("is_active")) {
    nextActive = formData.get("is_active") === "on" || formData.get("is_active") === "true";
  } else {
    const { data: cat } = await supabase
      .from("cash_categories")
      .select("is_active")
      .eq("id", id)
      .single();
    if (!cat) throw new Error("Khoản mục không tồn tại.");
    nextActive = !cat.is_active;
  }

  done(
    await supabase.from("cash_categories").update({ is_active: nextActive }).eq("id", id),
    "Đổi trạng thái khoản mục"
  );

  revalidatePath("/settings");
  revalidatePath("/cashflow");
  const returnTo = optStr(formData, "return_to");
  if (returnTo) redirect(returnTo);
  return { ok: true, is_active: nextActive };
}

// ------------------------------------------------------------- Sổ Quỹ & Giao Dịch Dòng Tiền
export async function createOperatingCashMovementAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được ghi nhận thu/chi vận hành.");
  const uid = await userId();

  const fundId = str(formData, "fund_id");
  const categoryId = str(formData, "category_id");
  const amount = num(formData, "amount");
  const movementDate = str(formData, "movement_date") || todayISO();
  const note = optStr(formData, "note");

  if (!fundId) throw new Error("Chưa chọn quỹ tiền thực hiện.");
  if (!categoryId) throw new Error("Chưa chọn khoản mục thu/chi.");
  if (amount <= 0) throw new Error("Số tiền thu/chi phải lớn hơn 0.");

  const { data: fund, error: fundErr } = await supabase
    .from("cash_funds")
    .select("id, is_active")
    .eq("id", fundId)
    .single();
  if (fundErr || !fund) throw new Error("Không tìm thấy quỹ tiền.");
  if (!fund.is_active) throw new Error("Quỹ tiền đã chọn đang tắt.");

  const { data: category, error: catErr } = await supabase
    .from("cash_categories")
    .select("name, kind")
    .eq("id", categoryId)
    .single();
  if (catErr || !category) throw new Error("Không tìm thấy thông tin khoản mục.");

  const finalAmount = category.kind === "IN" ? Math.abs(amount) : -Math.abs(amount);
  const finalNote = note || (category.kind === "IN" ? `Thu vận hành: ${category.name}` : `Chi vận hành: ${category.name}`);

  done(
    await supabase.from("cash_movements").insert({
      fund_id: fundId,
      movement_kind: "OPERATING",
      category_id: categoryId,
      amount: finalAmount,
      movement_date: movementDate,
      note: finalNote,
      created_by: uid,
    }),
    "Ghi nhận thu chi vận hành"
  );

  revalidatePath("/cashflow");
  revalidatePath("/executive");
  const returnTo = optStr(formData, "return_to");
  if (returnTo) redirect(returnTo);
  return { ok: true };
}

export async function transferInternalCashFundsAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được chuyển quỹ nội bộ.");

  const sourceFundId = str(formData, "source_fund_id");
  const destFundId = str(formData, "dest_fund_id");
  const amount = num(formData, "amount");
  const transferDate = str(formData, "transfer_date") || todayISO();
  const note = optStr(formData, "note");

  if (!sourceFundId || !destFundId) throw new Error("Chưa chọn đầy đủ quỹ nguồn và quỹ đích.");
  if (sourceFundId === destFundId) throw new Error("Quỹ nguồn và quỹ đích không được trùng nhau.");
  if (amount <= 0) throw new Error("Số tiền chuyển quỹ phải lớn hơn 0.");

  const { data, error } = await supabase.rpc("transfer_internal_cash_funds", {
    p_source_fund_id: sourceFundId,
    p_dest_fund_id: destFundId,
    p_amount: amount,
    p_transfer_date: transferDate,
    p_note: note || "Chuyển quỹ nội bộ",
  });

  if (error) throw new Error(`Chuyển quỹ nội bộ: ${error.message}`);

  revalidatePath("/cashflow");
  revalidatePath("/executive");
  const returnTo = optStr(formData, "return_to");
  if (returnTo) redirect(returnTo);
  return { ok: true, transfer_id: data };
}

export async function cancelCashMovementAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được huỷ phiếu dòng tiền.");

  const movementId = str(formData, "movement_id");
  const reason = str(formData, "reason").trim();

  if (!movementId) throw new Error("Thiếu ID giao dịch quỹ cần huỷ.");
  if (!reason) throw new Error("Bắt buộc phải nhập lý do huỷ phiếu.");

  const { data, error } = await supabase.rpc("cancel_cash_movement_reversal", {
    p_movement_id: movementId,
    p_reason: reason,
  });

  if (error) throw new Error(`Huỷ phiếu dòng tiền: ${error.message}`);

  revalidatePath("/cashflow");
  revalidatePath("/receivables");
  revalidatePath("/payables");
  revalidatePath("/executive");
  const returnTo = optStr(formData, "return_to");
  if (returnTo) redirect(returnTo);
  return { ok: true, reversal_id: data };
}

// ------------------------------------------------------------- Đối Chiếu Kế Toán 2 Tầng
export async function createReconciliationPeriodAction(formData: FormData) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được tạo kỳ đối chiếu.");
  const uid = await userId();

  const periodType = str(formData, "period_type") || "MONTH";
  const name = str(formData, "name");
  const fromDate = str(formData, "from_date");
  const toDate = str(formData, "to_date");
  const note = optStr(formData, "note");

  if (!name) throw new Error("Thiếu tên kỳ đối chiếu.");
  if (!fromDate || !toDate) throw new Error("Thiếu khoảng thời gian đối chiếu (từ ngày - đến ngày).");
  if (toDate < fromDate) throw new Error("Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.");

  const { data, error } = await supabase
    .from("reconciliation_periods")
    .insert({
      period_type: periodType as "MONTH" | "WEEK" | "CUSTOM",
      name,
      from_date: fromDate,
      to_date: toDate,
      status: "OPEN",
      note,
      created_by: uid,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Tạo kỳ đối chiếu: ${error.message}`);

  revalidatePath("/reconciliation");
  const returnTo = optStr(formData, "return_to");
  if (returnTo) redirect(returnTo);
  return { ok: true, period_id: data?.id };
}

export async function updateReconciliationEntryAction(
  input:
    | FormData
    | {
        entryId: string;
        accountingAmount?: number;
        discrepancyStatus?: string;
        explanationNote?: string | null;
      }
) {
  const supabase = await db();
  await requireRole(
    ["OWNER", "ACCOUNTING"],
    "Chỉ Chủ cửa hàng và Kế toán mới được cập nhật số liệu đối chiếu."
  );

  let id: string;
  const updateData: AnyRow = { updated_at: new Date().toISOString() };
  let returnTo: string | null = null;

  if (input instanceof FormData) {
    id = str(input, "id");
    if (input.has("accounting_amount")) {
      updateData.accounting_amount = num(input, "accounting_amount");
    }
    const discrepancyStatus = optStr(input, "discrepancy_status");
    if (
      discrepancyStatus &&
      ["MATCHED", "PENDING", "VALID_TAX_TIMING", "ACCOUNTING_ERROR", "TVK_ERROR"].includes(
        discrepancyStatus
      )
    ) {
      updateData.discrepancy_status = discrepancyStatus;
    }
    if (input.has("explanation_note")) {
      updateData.explanation_note = optStr(input, "explanation_note");
    }
    returnTo = optStr(input, "return_to");
  } else {
    id = input.entryId;
    if (input.accountingAmount !== undefined) {
      updateData.accounting_amount = input.accountingAmount;
    }
    if (input.discrepancyStatus) {
      updateData.discrepancy_status = input.discrepancyStatus;
    }
    if (input.explanationNote !== undefined) {
      updateData.explanation_note = input.explanationNote;
    }
  }

  if (!id) throw new Error("Thiếu ID dòng đối chiếu.");

  const { data, error } = await supabase
    .from("reconciliation_entries")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(`Cập nhật dòng đối chiếu: ${error.message}`);

  revalidatePath("/reconciliation");
  if (returnTo) redirect(returnTo);
  return { ok: true, data };
}

export async function createReconciliationSnapshotAction(
  input:
    | FormData
    | {
        periodId: string;
        name?: string;
        note?: string;
      }
) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được chốt kỳ đối chiếu.");

  let periodId: string;
  let name: string | null = null;
  let note: string | null = null;
  let returnTo: string | null = null;

  if (input instanceof FormData) {
    periodId = str(input, "period_id");
    name = optStr(input, "name");
    note = optStr(input, "note");
    returnTo = optStr(input, "return_to");
  } else {
    periodId = input.periodId;
    name = input.name || null;
    note = input.note || null;
  }

  if (!periodId) throw new Error("Thiếu ID kỳ đối chiếu.");

  const { data, error } = await supabase.rpc("create_reconciliation_snapshot", {
    p_period_id: periodId,
    p_name: name,
    p_note: note,
  });

  if (error) throw new Error(`Chốt kỳ đối chiếu: ${error.message}`);

  revalidatePath("/reconciliation");
  if (returnTo) redirect(returnTo);
  return { ok: true, snapshot_id: data };
}


// ------------------------------------------------------------- TVK V2.0 P1 — ngành hàng
// Gán/thu hồi phân quyền ngành + đổi ngành sản phẩm (chỉ OWNER).
// RLS ở database là cửa chặn chính; requireRole là phòng thủ thêm ở tầng action.
// UI quản lý phân quyền thuộc P2 — các action này là nền tảng server-side.

/** Gán một user vào một ngành hàng (OWNER duy nhất). */
export async function assignUserBusinessLineAction(userId: string, businessLineId: string) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được gán ngành hàng cho tài khoản.");
  if (!userId || !businessLineId) throw new Error("Thiếu tài khoản hoặc ngành hàng.");
  done(
    await supabase
      .from("user_business_lines")
      .insert({ user_id: userId, business_line_id: businessLineId }),
    "Gán ngành hàng",
  );
  revalidatePath("/settings");
}

/** Thu hồi một ngành hàng của một user (OWNER duy nhất). */
export async function revokeUserBusinessLineAction(userId: string, businessLineId: string) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được thu hồi ngành hàng của tài khoản.");
  if (!userId || !businessLineId) throw new Error("Thiếu tài khoản hoặc ngành hàng.");
  done(
    await supabase
      .from("user_business_lines")
      .delete()
      .eq("user_id", userId)
      .eq("business_line_id", businessLineId),
    "Thu hồi ngành hàng",
  );
  revalidatePath("/settings");
}

/**
 * Đổi ngành hàng của một sản phẩm (OWNER duy nhất).
 * - Sản phẩm chưa phân loại: phân loại lần đầu luôn được.
 * - Sản phẩm đã có giao dịch/tồn kho: bị chặn (kiểm tra sớm ở đây để báo lỗi
 *   thân thiện; trigger trg_products_business_line_guard ở database chặn lại
 *   lần nữa và ghi dòng kiểm toán cho mọi thay đổi được phép).
 * - businessLineId = null: xoá phân loại (chỉ khi sản phẩm chưa có giao dịch).
 */
export async function updateProductBusinessLineAction(
  productId: string,
  businessLineId: string | null,
) {
  const supabase = await db();
  await requireRole(["OWNER"], "Chỉ Chủ cửa hàng mới được đổi ngành hàng của sản phẩm.");
  if (!productId) throw new Error("Thiếu sản phẩm.");
  const check = await canChangeProductBusinessLine(productId);
  if (!check.ok) throw new Error(check.reason ?? "Không được đổi ngành hàng của sản phẩm này.");
  done(
    await supabase
      .from("products")
      .update({ business_line_id: businessLineId })
      .eq("id", productId),
    "Đổi ngành hàng",
  );
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
}
