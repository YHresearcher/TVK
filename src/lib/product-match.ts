import { normalizeHeader } from "@/lib/excel-parse";
import type { PriceTier } from "@/lib/types";

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
