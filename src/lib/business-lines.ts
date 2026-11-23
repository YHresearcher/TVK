import { createClient } from "@/lib/supabase/server";
import type { AnyRow, BusinessLine } from "@/lib/types";

/**
 * TVK V2.0 P1 — Helpers ngành hàng (business_lines / user_business_lines).
 *
 * Nguyên tắc:
 * - Mọi kiểm tra phân quyền ngành ở tầng server đều đọc từ DATABASE
 *   (user_business_lines + profiles), không bao giờ tin business_line_id
 *   do trình duyệt gửi lên.
 * - Quy tắc tương thích P1: user chưa được gán ngành nào vẫn thấy toàn bộ
 *   (xem userHasBusinessLineAccess trong types.ts). Việc bắt buộc gán thuộc P2.
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
