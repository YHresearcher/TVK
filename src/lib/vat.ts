/**
 * VAT + giảm giá cho hoá đơn GTGT tách theo ngành (TVK V2.0 P4b, §13).
 *
 * Quyết định của chủ (21/11/2026):
 *  - Giá ghi trong hệ thống LÀ GIÁ ĐÃ GỒM VAT.
 *  - Thuế suất 8% cho cả hai ngành (Dầu nhớt / Phụ tùng).
 *  - TÁCH HOÁ ĐƠN theo ngành: một hoá đơn GTGT không trộn hai ngành.
 *
 * Toán VAT dùng đồng bộ với migration 0029 (create_vat_invoice):
 *  - Giảm giá đầu chứng từ chia xuống từng dòng theo tỷ lệ, làm tròn
 *    XUỐNG đồng, phần dư về dòng có line_total lớn nhất (dòng đầu tiên
 *    khi bằng nhau, theo id) — tổng phần đã chia = đúng discount.
 *  - Cơ sở thuế của dòng = line_total - phần giảm giá của dòng.
 *  - Trước thuế = ROUND(cơ-sở / 1.08, 2); VAT = cơ-sở - trước-thuế
 *    (VAT tính bằng phép trừ để trước-thuế + VAT = đúng cơ-sở).
 *
 * Chỉ chứa hàm thuần (không đọc DB) để test được bằng Tier 5.
 */

export const VAT_RATE = 8 as const;
export const VAT_DIVISOR = 1.08 as const;

/** Kết quả tách VAT của một dòng sau khi trừ giảm giá. */
export type VatSplit = {
  /** Tiền gồm thuế sau khi trừ giảm giá (= amount / amount_including_tax). */
  including: number;
  /** Phần giảm giá đã chia xuống dòng này. */
  discount: number;
  /** Tiền trước thuế (làm tròn 2 chữ số). */
  beforeTax: number;
  /** Tiền thuế GTGT (= including - beforeTax). */
  vat: number;
};

export type InvoiceLineInput = {
  id: string;
  /** line_total = qty * unit_price (chưa trừ giảm giá). */
  lineTotal: number;
};

/** Làm tròn xuống tới đồng (dùng khi chia giảm giá theo tỷ lệ). */
export function floorToDong(value: number): number {
  return Math.floor(value * 100) / 100;
}

/**
 * Chia giảm giá đầu chứng từ xuống từng dòng theo tỷ lệ line_total.
 * Trả về Map lineId -> phần giảm giá (2 chữ số). Tổng các phần = đúng
 * discount (phần dư do làm tròn dồn về dòng lớn nhất). Discount = 0
 * hoặc tổng line_total = 0 -> mọi dòng 0.
 */
export function allocateDiscount(
  lines: InvoiceLineInput[],
  discount: number,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!lines.length) return result;
  const subtotal = lines.reduce((acc, l) => acc + l.lineTotal, 0);
  if (!discount || discount <= 0 || subtotal <= 0) {
    for (const l of lines) result.set(l.id, 0);
    return result;
  }
  // Dòng lớn nhất (line_total lớn nhất, rồi id nhỏ nhất) nhận phần dư.
  const sorted = [...lines].sort((a, b) => b.lineTotal - a.lineTotal || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const largestId = sorted[0].id;
  let othersFloor = 0;
  for (const l of lines) {
    if (l.id === largestId) continue;
    const share = floorToDong((discount * l.lineTotal) / subtotal);
    result.set(l.id, share);
    othersFloor += share;
  }
  // Làm tròn 2 chữ số để tránh sai số số thực (vd 49999.999999).
  result.set(largestId, Math.round((discount - othersFloor) * 100) / 100);
  return result;
}

/**
 * Tách VAT 8% cho một dòng: cơ sở = lineTotal - discountShare.
 * Ném lỗi khi cơ sở âm (giảm giá chia xuống vượt tiền hàng).
 */
export function splitVat(lineTotal: number, discountShare: number): VatSplit {
  const including = Math.round((lineTotal - discountShare) * 100) / 100;
  if (including < 0) {
    throw new Error("Phần giảm giá chia xuống dòng vượt tiền hàng của dòng.");
  }
  const beforeTax = Math.round((including / VAT_DIVISOR) * 100) / 100;
  const vat = Math.round((including - beforeTax) * 100) / 100;
  return { including, discount: discountShare, beforeTax, vat };
}

/** Tổng hợp header hoá đơn từ các dòng đã tách (trước-thuế + VAT = tổng). */
export function sumVatSplits(splits: VatSplit[]): {
  totalBeforeTax: number;
  totalVat: number;
  totalAmount: number;
} {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    totalBeforeTax: round2(splits.reduce((a, s) => a + s.beforeTax, 0)),
    totalVat: round2(splits.reduce((a, s) => a + s.vat, 0)),
    totalAmount: round2(splits.reduce((a, s) => a + s.including, 0)),
  };
}

/**
 * Nhóm các dòng chứng từ chưa ghi hoá đơn theo ngành (phục vụ trang
 * Hoá đơn GTGT: một thẻ ghi hoá đơn cho một ngành). Dòng chưa phân
 * loại (lineId null) gom vào nhóm riêng 'unclassified' — giao diện
 * hiện cảnh báo và không cho ghi (RPC cũng chặn).
 */
export type UninvoicedLineRow = {
  id: string;
  business_line_id: string | null;
};

export function groupUninvoicedLinesByLine<T extends UninvoicedLineRow>(
  lines: T[],
): { lineId: string | null; lines: T[] }[] {
  const groups = new Map<string, { lineId: string | null; lines: T[] }>();
  for (const l of lines) {
    const key = l.business_line_id ?? "__unclassified__";
    const g = groups.get(key) ?? { lineId: l.business_line_id, lines: [] };
    g.lines.push(l);
    groups.set(key, g);
  }
  return Array.from(groups.values());
}
