import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { AnyRow, AppRole, BusinessLine, BusinessLineCode } from "@/lib/types";
import { BUSINESS_LINE_LABELS } from "@/lib/types";

/** Tên cookie lưu ngữ cảnh ngành hàng của phiên làm việc (§18.3). */
export const BUSINESS_LINE_COOKIE = "tvk-business-line";

/** Ngữ cảnh ngành hàng của phiên làm việc (P2 §18.2–§18.3):
 *  - ALL: toàn doanh nghiệp (chỉ OWNER/CEO).
 *  - LINE: một ngành cụ thể (ngành user đang làm việc).
 *  - NONE: tài khoản chưa được gán ngành nào (fail-closed P2) — không
 *    thấy dữ liệu ngành nào, không tạo được chứng từ. */
export type BusinessLineContextMode = "ALL" | "LINE" | "NONE";

export interface BusinessLineContext {
  mode: BusinessLineContextMode;
  /** Mã ngành đang chọn (null khi ALL/NONE). */
  code: BusinessLineCode | null;
  /** ID ngành đang chọn (null khi ALL/NONE). */
  lineId: string | null;
  /** Các ngành user được gán (đang hoạt động), xếp theo mã. */
  lines: BusinessLine[];
  /** OWNER/CEO được xem tất cả (kể cả khi chỉ gán 1 ngành). */
  canSeeAll: boolean;
  role: AppRole | null;
  userId: string | null;
}

const NONE_CONTEXT: BusinessLineContext = {
  mode: "NONE",
  code: null,
  lineId: null,
  lines: [],
  canSeeAll: false,
  role: null,
  userId: null,
};

/**
 * Ngữ cảnh ngành hàng của user đang đăng nhập: đọc từ DATABASE
 * (profiles + user_business_lines) rồi áp cookie phiên làm việc.
 * Cookie chỉ là "ý muốn" của user — giá trị không hợp lệ (ngành không
 * được gán, ALL khi không đủ quyền) sẽ rơi về mặc định an toàn:
 * ALL nếu OWNER/CEO, không thì ngành đầu tiên đã gán, không thì NONE.
 */
export async function getBusinessLineContext(): Promise<BusinessLineContext> {
  const supabase = await client();
  if (!supabase) return NONE_CONTEXT;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NONE_CONTEXT;
  const { data: prof } = await supabase
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof || !prof.is_active) return { ...NONE_CONTEXT, userId: user.id };
  const role = (prof as AnyRow).role as AppRole;
  const canSeeAll = role === "OWNER" || role === "CEO";
  const { data: rows } = await supabase
    .from("user_business_lines")
    .select("business_line_id, business_lines(id, code, name, is_active)")
    .eq("user_id", user.id);
  const lines = ((rows ?? []) as AnyRow[])
    .map((r) => (Array.isArray(r.business_lines) ? r.business_lines[0] : r.business_lines))
    .filter((l): l is BusinessLine => !!l && l.is_active)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const base = { lines, canSeeAll, role, userId: user.id };
  const wanted = (await cookies()).get(BUSINESS_LINE_COOKIE)?.value ?? null;
  if (wanted === "ALL" && canSeeAll) {
    return { ...base, mode: "ALL", code: null, lineId: null };
  }
  if (wanted) {
    const match = lines.find((l) => l.code === wanted);
    if (match) {
      return { ...base, mode: "LINE", code: match.code, lineId: match.id };
    }
  }
  if (canSeeAll) return { ...base, mode: "ALL", code: null, lineId: null };
  if (lines.length > 0) {
    return { ...base, mode: "LINE", code: lines[0].code, lineId: lines[0].id };
  }
  return { ...base, mode: "NONE", code: null, lineId: null };
}

/** Một ngành đang hoạt động theo mã (OIL / AUTO_PARTS), null nếu không có. */
export async function getLineByCode(
  supabase: AnyRow,
  code: string,
): Promise<BusinessLine | null> {
  const { data } = await supabase
    .from("business_lines")
    .select("id, code, name, is_active")
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();
  return (data as BusinessLine | null) ?? null;
}

/** Nhãn hiển thị tiếng Việt của một ngành theo ID (phục vụ thông báo lỗi). */
export async function getLineLabelById(
  supabase: AnyRow,
  lineId: string | null | undefined,
): Promise<string> {
  if (!lineId) return "chưa phân loại";
  const { data } = await supabase
    .from("business_lines")
    .select("code")
    .eq("id", lineId)
    .maybeSingle();
  const code = (data as AnyRow | null)?.code as BusinessLineCode | undefined;
  return code ? BUSINESS_LINE_LABELS[code] : "chưa phân loại";
}

/**
 * Ngành ghi lên chứng từ mới (§18.3 — KHÔNG tin business_line do trình
 * duyệt gửi; chỉ dùng nó làm "ý muốn" rồi kiểm tra lại từ DB):
 *  - Ngữ cảnh LINE: dùng đúng ngành đang chọn; form gửi kèm mã khác
 *    (form cũ sau khi đổi ngữ cảnh) -> từ chối.
 *  - Ngữ cảnh ALL (OWNER/CEO): bắt buộc chọn ngành rõ ràng; mã phải là
 *    ngành đang hoạt động trong DB.
 *  - Ngữ cảnh NONE: từ chối — tài khoản chưa được gán ngành.
 */
export async function resolveWriteLine(
  supabase: AnyRow,
  requestedCode?: string | null,
): Promise<{ id: string; code: BusinessLineCode }> {
  const ctx = await getBusinessLineContext();
  if (ctx.mode === "NONE") {
    throw new Error(
      "Tài khoản chưa được gán ngành hàng — nhờ chủ cửa hàng gán ngành trước khi tạo chứng từ.",
    );
  }
  if (ctx.mode === "LINE") {
    if (requestedCode && requestedCode !== ctx.code) {
      throw new Error(
        "Ngữ cảnh ngành hàng đã đổi — tải lại trang rồi tạo lại chứng từ.",
      );
    }
    return { id: ctx.lineId as string, code: ctx.code as BusinessLineCode };
  }
  // ALL: OWNER/CEO phải chọn ngành rõ ràng cho từng chứng từ.
  if (!requestedCode) {
    throw new Error("Chọn ngành hàng (Dầu nhớt hoặc Phụ tùng) cho chứng từ này.");
  }
  const line = await getLineByCode(supabase, requestedCode);
  if (!line) {
    throw new Error(`Ngành hàng "${requestedCode}" không tồn tại hoặc đang tắt.`);
  }
  return { id: line.id, code: line.code };
}

/** Toàn bộ bảng mapping nhóm -> ngành (để lọc danh sách nhóm theo ngành trên form). */
export async function listGroupLineMappings(): Promise<
  { group: string; lineId: string; lineCode: BusinessLineCode }[]
> {
  const supabase = await client();
  if (!supabase) return [];
  const { data } = await supabase
    .from("business_line_group_mappings")
    .select("product_group, business_line_id, business_lines!inner(code)")
    .order("product_group", { ascending: true });
  return ((data ?? []) as AnyRow[]).map((r) => ({
    group: String(r.product_group),
    lineId: String(r.business_line_id),
    lineCode: String((r.business_lines as AnyRow)?.code) as BusinessLineCode,
  }));
}

/** Toàn bộ phân quyền ngành của tài khoản (để OWNER quản lý ở Cài đặt). */
export async function listUserBusinessLines(): Promise<
  { userId: string; lineId: string; lineCode: BusinessLineCode }[]
> {
  const supabase = await client();
  if (!supabase) return [];
  const { data } = await supabase
    .from("user_business_lines")
    .select("user_id, business_line_id, business_lines!inner(code)")
    .order("user_id", { ascending: true });
  return ((data ?? []) as AnyRow[]).map((r) => ({
    userId: String(r.user_id),
    lineId: String(r.business_line_id),
    lineCode: String((r.business_lines as AnyRow)?.code) as BusinessLineCode,
  }));
}

/** Ngành của một nhóm hàng theo bảng mapping tường minh (0025 §5.2). */
export async function getGroupLineId(
  supabase: AnyRow,
  productGroup: string | null | undefined,
): Promise<string | null> {
  if (!productGroup) return null;
  const { data } = await supabase
    .from("business_line_group_mappings")
    .select("business_line_id")
    .eq("product_group", productGroup)
    .maybeSingle();
  return ((data as AnyRow | null)?.business_line_id as string | null) ?? null;
}

/**
 * Nhóm hàng đã có mapping tường minh sang ngành khác với ngành ghi
 * chứng từ -> từ chối (tránh tạo sản phẩm nhớt trong ngành phụ tùng
 * và ngược lại). Nhóm chưa có trong bảng mapping thì không ràng buộc.
 */
export async function assertGroupMatchesLine(
  supabase: AnyRow,
  productGroup: string | null | undefined,
  lineId: string,
): Promise<void> {
  const mapped = await getGroupLineId(supabase, productGroup);
  if (mapped && mapped !== lineId) {
    const want = await getLineLabelById(supabase, mapped);
    const got = await getLineLabelById(supabase, lineId);
    throw new Error(
      `Nhóm hàng "${productGroup}" thuộc ngành ${want}, không tạo được sản phẩm ngành ${got} — đổi nhóm hàng hoặc đổi ngành làm việc.`,
    );
  }
}

/** Map product_id -> { lineId, code } (code null = chưa phân loại). */
export async function getProductLineMap(
  supabase: AnyRow,
  productIds: string[],
): Promise<Map<string, { lineId: string | null; code: BusinessLineCode | null }>> {
  const uniq = Array.from(new Set(productIds.filter(Boolean)));
  const map = new Map<string, { lineId: string | null; code: BusinessLineCode | null }>();
  if (!uniq.length) return map;
  const { data: products } = await supabase
    .from("products")
    .select("id, business_line_id")
    .in("id", uniq);
  const { data: lines } = await supabase
    .from("business_lines")
    .select("id, code")
    .eq("is_active", true);
  const codeById = new Map(
    ((lines ?? []) as AnyRow[]).map((l) => [String(l.id), l.code as BusinessLineCode]),
  );
  for (const p of (products ?? []) as AnyRow[]) {
    const lineId = (p.business_line_id as string | null) ?? null;
    map.set(String(p.id), { lineId, code: lineId ? codeById.get(lineId) ?? null : null });
  }
  return map;
}

/**
 * Chặn dòng hàng sai ngành trước khi ghi chứng từ (BL-002/BL-003):
 * sản phẩm chưa phân loại -> từ chối (phải phân loại trước, P2 siết);
 * sản phẩm thuộc ngành khác -> từ chối (không trộn ngành trong một
 * chứng từ). DB trigger kiểm tra lại, đây là kiểm tra sớm để báo lỗi
 * rõ ràng trước khi tạo chứng từ nháp.
 */
export async function assertProductsInLine(
  supabase: AnyRow,
  productIds: string[],
  lineId: string,
): Promise<void> {
  const uniq = Array.from(new Set(productIds.filter(Boolean)));
  if (!uniq.length) return;
  const { data } = await supabase
    .from("products")
    .select("id, sku, business_line_id")
    .in("id", uniq);
  const lineLabel = await getLineLabelById(supabase, lineId);
  for (const id of uniq) {
    const p = ((data ?? []) as AnyRow[]).find((r) => String(r.id) === id);
    if (!p) throw new Error("Không tìm thấy một sản phẩm trong chứng từ.");
    if (!p.business_line_id) {
      throw new Error(
        `Sản phẩm ${p.sku} chưa phân loại ngành hàng — hãy phân loại trước khi đưa vào chứng từ ngành ${lineLabel}.`,
      );
    }
    if (String(p.business_line_id) !== lineId) {
      const other = await getLineLabelById(supabase, String(p.business_line_id));
      throw new Error(
        `Sản phẩm ${p.sku} thuộc ngành ${other} — không đưa được vào chứng từ ngành ${lineLabel}. Một chứng từ chỉ thuộc một ngành.`,
      );
    }
  }
}

/** Như assertProductsInLine nhưng cho dòng theo lô (GK / trả hàng / phân bổ). */
export async function assertBatchesInLine(
  supabase: AnyRow,
  batchIds: string[],
  lineId: string,
): Promise<void> {
  const uniq = Array.from(new Set(batchIds.filter(Boolean)));
  if (!uniq.length) return;
  const { data: batches } = await supabase
    .from("stock_batches")
    .select("id, batch_code, product_id")
    .in("id", uniq);
  const lineLabel = await getLineLabelById(supabase, lineId);
  const productIds = ((batches ?? []) as AnyRow[]).map((b) => String(b.product_id));
  const lineMap = await getProductLineMap(supabase, productIds);
  for (const b of (batches ?? []) as AnyRow[]) {
    const entry = lineMap.get(String(b.product_id));
    if (!entry) throw new Error(`Không tìm thấy lô ${b.batch_code}.`);
    if (!entry.lineId) {
      throw new Error(
        `Lô ${b.batch_code} thuộc sản phẩm chưa phân loại ngành hàng — hãy phân loại trước khi đưa vào chứng từ ngành ${lineLabel}.`,
      );
    }
    if (entry.lineId !== lineId) {
      const other = await getLineLabelById(supabase, entry.lineId);
      throw new Error(
        `Lô ${b.batch_code} thuộc ngành ${other} — không đưa được vào chứng từ ngành ${lineLabel}. Một chứng từ chỉ thuộc một ngành.`,
      );
    }
  }
}


/**
 * TVK V2.0 P1+P2 — Helpers ngành hàng (business_lines / user_business_lines).
 *
 * Nguyên tắc:
 * - Mọi kiểm tra phân quyền ngành ở tầng server đều đọc từ DATABASE
 *   (user_business_lines + profiles), không bao giờ tin business_line_id
 *   do trình duyệt gửi lên.
 * - P2 fail-closed: user chưa được gán ngành nào KHÔNG thấy gì (trừ
 *   OWNER/CEO thấy tất cả); 5 tài khoản hiện có đã được gán mặc định
 *   Phụ tùng ở migration 0026. (P1 cho qua để tương thích — đã bỏ.)
 * - Đổi ngành của sản phẩm đã có giao dịch/tồn kho bị chặn ở DATABASE
 *   (trigger trg_products_business_line_guard, migration 0025); hàm
 *   canChangeProductBusinessLine dưới đây chỉ kiểm tra trước để báo lỗi
 *   thân thiện, không thay thế guard.
 */

async function client() {
  return createClient();
}

/** Danh mục ngành hàng đang hoạt động (OIL, AUTO_PARTS), xếp theo mã. */
export async function listBusinessLines(): Promise<BusinessLine[]> {
  const supabase = await client();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("business_lines")
    .select("id, code, name, is_active")
    .eq("is_active", true)
    .order("code", { ascending: true });
  if (error || !data) return [];
  return data as BusinessLine[];
}

/** ID các ngành mà một user được gán (rỗng = chưa gán ngành nào). */
export async function getUserBusinessLineIds(userId: string): Promise<string[]> {
  const supabase = await client();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("user_business_lines")
    .select("business_line_id")
    .eq("user_id", userId);
  if (error || !data) return [];
  return (data as AnyRow[]).map((r) => String(r.business_line_id));
}

/** ID các ngành của user đang đăng nhập (rỗng = chưa gán ngành nào). */
export async function getMyBusinessLineIds(): Promise<string[]> {
  const supabase = await client();
  if (!supabase) return [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  return getUserBusinessLineIds(user.id);
}

/**
 * Sản phẩm có được đổi ngành không? Trả về { ok: true } hoặc
 * { ok: false, reason } với lý do tiếng Việt để hiển thị.
 * (Kiểm tra lại ở DB trigger; đây chỉ là kiểm tra sớm phía server.)
 */
export async function canChangeProductBusinessLine(
  productId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await client();
  if (!supabase) return { ok: false, reason: "Hệ thống chưa cài đặt xong." };
  const { data: product, error } = await supabase
    .from("products")
    .select("id, sku, business_line_id")
    .eq("id", productId)
    .maybeSingle();
  if (error || !product) return { ok: false, reason: "Không tìm thấy sản phẩm." };
  if (!product.business_line_id) {
    return { ok: true }; // Chưa phân loại -> phân loại lần đầu luôn được.
  }
  // Đếm tham chiếu giao dịch/tồn kho (cùng danh sách với trigger DB 0025).
  const checks: Array<[string, string]> = [
    ["stock_batches", "product_id"],
    ["purchase_receipt_items", "product_id"],
    ["consignment_receipt_items", "product_id"],
    ["consumption_report_items", "product_id"],
    ["allocation_lines", "product_id"],
    ["sales_document_lines", "product_id"],
  ];
  for (const [table, column] of checks) {
    const { count, error: cErr } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(column, productId);
    if (!cErr && (count ?? 0) > 0) {
      return {
        ok: false,
        reason: `Không được đổi ngành hàng của sản phẩm đã có giao dịch hoặc tồn kho (${product.sku} đã có tham chiếu ở ${table}). Đổi ngành lịch sử phải dùng quy trình điều chỉnh đã phê duyệt.`,
      };
    }
  }
  // return_items tham chiếu sản phẩm gián tiếp qua lô.
  const { data: batches } = await supabase
    .from("stock_batches")
    .select("id")
    .eq("product_id", productId);
  const batchIds = (batches as AnyRow[] | null ?? []).map((b) => String(b.id));
  if (batchIds.length > 0) {
    const { count } = await supabase
      .from("return_items")
      .select("id", { count: "exact", head: true })
      .in("batch_id", batchIds);
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        reason: `Không được đổi ngành hàng của sản phẩm đã có giao dịch hoặc tồn kho (${product.sku} đã có tham chiếu ở return_items). Đổi ngành lịch sử phải dùng quy trình điều chỉnh đã phê duyệt.`,
      };
    }
  }
  return { ok: true };
}

/** Sản phẩm chưa phân loại ngành (hàng đợi xử lý thủ công, P1 §5.2). */
export async function listUnclassifiedProducts(): Promise<AnyRow[]> {
  const supabase = await client();
  if (!supabase) return [];
  const { data, error } = await supabase.from("v_unclassified_products").select("*").limit(500);
  if (error || !data) return [];
  return data as AnyRow[];
}
