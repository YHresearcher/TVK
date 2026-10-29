import { normalizeHeader } from "@/lib/excel-parse";
import type { PriceTier } from "@/lib/types";

/** Mã hàng chuẩn hoá để tra cứu: hoa hết, bỏ mọi khoảng trắng (kể cả
 * xuống dòng trong ô Excel) — "VG1540080110-CX1020 SMS-10452" và
 * "VG1540080110-CX1020\nSMS-10452" là một mã. Dùng chung cho mọi nơi
 * tra cứu theo mã: quầy POS, import bán hàng, quét barcode. */
export function normCode(v: unknown): string {
  return String(v ?? "")
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Nhóm hàng có phải là nhớt? So khớp không dấu, chứa "nhot" (Nhớt,
 * Dầu nhớt...). Nhớt quản lý hạn dùng theo lô và xuất FEFO; linh kiện
 * và mọi nhóm khác xuất FIFO, không xét hạn dùng. */
export function isOilGroup(group: unknown): boolean {
  const n = normalizeHeader(group);
  return n.includes("nhot");
}

export interface LotOrder {
  expiry_date?: string | null;
  received_date?: string | null;
  batch_code?: string | null;
}

/** Thứ tự xuất kho của các lô cùng một sản phẩm: nhớt thì FEFO — hạn
 * dùng gần nhất trước, lô không có hạn xếp sau cùng rồi mới theo FIFO;
 * còn lại FIFO thuần (ngày nhập rồi mã lô). */
export function compareLotOrder(a: LotOrder, b: LotOrder, oil: boolean): number {
  if (oil) {
    const ea = a.expiry_date || "";
    const eb = b.expiry_date || "";
    if (ea !== eb) {
      if (!ea) return 1;
      if (!eb) return -1;
      const c = ea.localeCompare(eb);
      if (c) return c;
    }
  }
  return (
    String(a.received_date ?? "").localeCompare(String(b.received_date ?? "")) ||
    String(a.batch_code ?? "").localeCompare(String(b.batch_code ?? ""))
  );
}

/** Tên hàng chuẩn hoá để so khớp: bỏ dấu, hoa/thường và khoảng trắng đều như nhau. */
export function normProductName(v: unknown): string {
  return normalizeHeader(v);
}

/** Dòng xe chuẩn hoá: hoa hết, bỏ khoảng trắng và gạch nối ("HOWO-420" = "HOWO 420"). */
export function normVehicle(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

export interface MatchableProduct {
  id: string;
  name: string;
  fitments: string[];
}

/**
 * Khớp một món theo tên + dòng xe. Dòng xe để trống thì khớp theo tên.
 * Chỉ khớp khi đúng một món — tên trùng nhau mà dòng xe không phân biệt
 * được thì báo trùng, không đoán mò.
 */
export function matchByNameVehicle(
  products: MatchableProduct[],
  name: string,
  vehicle: string
): { productId: string } | { error: "not-found" | "ambiguous" } {
  const n = normProductName(name);
  if (!n) return { error: "not-found" };
  const v = normVehicle(vehicle);
  let candidates = products.filter((p) => normProductName(p.name) === n);
  if (v) {
    // Có dòng xe thì chỉ giữ món có đúng dòng xe đó; không món nào có
    // thì coi như không tìm thấy, đừng đoán sang dòng xe khác.
    candidates = candidates.filter((p) => p.fitments.some((f) => normVehicle(f) === v));
  }
  if (candidates.length === 0) return { error: "not-found" };
  if (candidates.length > 1) return { error: "ambiguous" };
  return { productId: candidates[0].id };
}

export interface TierPriced {
  retailPrice: number;
  garagePrice: number;
  wholesalePrice: number;
}

/** Giá của một món theo bậc giá (lẻ / gara / đại lý). */
export function tierPriceOf(p: TierPriced, tier: PriceTier): number {
  return tier === "retail" ? p.retailPrice : tier === "garage" ? p.garagePrice : p.wholesalePrice;
}
