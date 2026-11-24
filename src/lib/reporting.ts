/**
 * Báo cáo theo ngành — hàm thuần (TVK V2.0 P5, Prompt §17–§18.1).
 *
 * Chỉ chứa hàm thuần (không đọc DB) để test được bằng Tier 5, theo
 * quy ước của src/lib/payment-allocations.ts / src/lib/vat.ts.
 *
 * Nguồn số liệu ở tầng gọi là 10 view tổng hợp của migration 0030
 * (v_sales_by_line, v_debt_by_line, v_inventory_value_by_line, ...),
 * đọc qua src/lib/queries.ts (getSalesByLine / getDebtByLine /
 * getInventoryValueByLine / getLineComparison).
 *
 * Quy ước BL-020 (§17.6 / §15.7): tổng các hàng theo ngành cộng lại
 * phải đúng số tổng hợp toàn doanh nghiệp. Chứng từ / khoản nợ / lô
 * chưa phân loại (business_line_id NULL) KHÔNG thuộc Dầu nhớt hay Phụ
 * tùng, nhưng vẫn nằm trong số tổng hợp — nên khi có hàng chưa phân
 * loại thì Dầu nhớt + Phụ tùng lệch đúng bằng số chưa phân loại đó.
 * checkLineTotals() trả về chênh lệch để UI ghi chú rõ, thay vì lặng
 * lẽ gộp hàng chưa phân loại vào một ngành.
 */

import { BUSINESS_LINE_LABELS } from "@/lib/types";
import type { BusinessLineCode } from "@/lib/types";

/** Nhãn hàng chưa phân loại (business_line_id NULL). */
export const UNCLASSIFIED_LABEL = "Chưa phân loại" as const;
/** Nhãn hàng tổng toàn doanh nghiệp (§18.1: ALL = "Toàn doanh nghiệp"). */
export const ALL_LINES_LABEL = "Toàn doanh nghiệp" as const;

/**
 * Nhãn ngành hiển thị theo mã (§18.1): OIL = "Dầu nhớt",
 * AUTO_PARTS = "Phụ tùng", ALL = "Toàn doanh nghiệp";
 * null / mã lạ = "Chưa phân loại".
 */
export function businessLineLabel(code: string | null | undefined): string {
  if (code === "OIL") return BUSINESS_LINE_LABELS.OIL;
  if (code === "AUTO_PARTS") return BUSINESS_LINE_LABELS.AUTO_PARTS;
  if (code === "ALL") return ALL_LINES_LABEL;
  return UNCLASSIFIED_LABEL;
}

/** Làm tròn 2 chữ số để tránh sai số số thực khi so sánh tiền (BL-020). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Một dòng doanh thu theo ngành (từ v_sales_by_line). */
export interface SalesByLineInput {
  lineId: string | null;
  lineCode: string | null;
  orders: number;
  qty: number;
  /** Doanh thu thuần (§17.6: SUM(line_total) − giảm giá, chặn dưới 0). */
  revenue: number;
  cogs: number;
  profit: number;
  soldQty: number;
  soldRevenue: number;
  revenue30d: number;
  cogs30d: number;
  profit30d: number;
  orders30d: number;
}

/** Tổng doanh thu / lãi / đơn của một tập hàng theo ngành. */
export interface SalesTotals {
  orders: number;
  qty: number;
  revenue: number;
  cogs: number;
  profit: number;
  soldQty: number;
  soldRevenue: number;
  revenue30d: number;
  cogs30d: number;
  profit30d: number;
  orders30d: number;
}

/** Cộng các hàng doanh thu theo ngành thành một tổng (BL-020). */
export function sumSalesByLine(rows: SalesByLineInput[]): SalesTotals {
  const totals: SalesTotals = {
    orders: 0,
    qty: 0,
    revenue: 0,
    cogs: 0,
    profit: 0,
    soldQty: 0,
    soldRevenue: 0,
    revenue30d: 0,
    cogs30d: 0,
    profit30d: 0,
    orders30d: 0,
  };
  for (const r of rows) {
    totals.orders += Number(r.orders ?? 0);
    totals.qty += Number(r.qty ?? 0);
    totals.revenue = round2(totals.revenue + Number(r.revenue ?? 0));
    totals.cogs = round2(totals.cogs + Number(r.cogs ?? 0));
    totals.profit = round2(totals.profit + Number(r.profit ?? 0));
    totals.soldQty += Number(r.soldQty ?? 0);
    totals.soldRevenue = round2(totals.soldRevenue + Number(r.soldRevenue ?? 0));
    totals.revenue30d = round2(totals.revenue30d + Number(r.revenue30d ?? 0));
    totals.cogs30d = round2(totals.cogs30d + Number(r.cogs30d ?? 0));
    totals.profit30d = round2(totals.profit30d + Number(r.profit30d ?? 0));
    totals.orders30d += Number(r.orders30d ?? 0);
  }
  return totals;
}

/** Loại công nợ: RECEIVABLE = Phải thu, PAYABLE = Phải trả (§18.1). */
export type DebtKind = "RECEIVABLE" | "PAYABLE";

/** Một dòng dư nợ theo ngành (từ v_debt_by_line). */
export interface DebtByLineInput {
  kind: DebtKind;
  lineId: string | null;
  lineCode: string | null;
  /** Dư nợ còn phải thu / trả (amount − amount_paid, UNPAID + PARTIAL). */
  outstanding: number;
  unpaid: number;
  partial: number;
  /** Dư nợ đã quá hạn thanh toán. */
  overdue: number;
  count: number;
}

/** Tổng dư nợ của một tập hàng theo ngành. */
export interface DebtTotals {
  outstanding: number;
  unpaid: number;
  partial: number;
  overdue: number;
  count: number;
}

/**
 * Cộng các hàng dư nợ theo ngành thành một tổng (BL-020).
 * kind: chỉ cộng một loại (RECEIVABLE / PAYABLE); bỏ trống = cộng cả hai.
 */
export function sumDebtByLine(rows: DebtByLineInput[], kind?: DebtKind): DebtTotals {
  const totals: DebtTotals = { outstanding: 0, unpaid: 0, partial: 0, overdue: 0, count: 0 };
  for (const r of rows) {
    if (kind && r.kind !== kind) continue;
    totals.outstanding = round2(totals.outstanding + Number(r.outstanding ?? 0));
    totals.unpaid = round2(totals.unpaid + Number(r.unpaid ?? 0));
    totals.partial = round2(totals.partial + Number(r.partial ?? 0));
    totals.overdue = round2(totals.overdue + Number(r.overdue ?? 0));
    totals.count += Number(r.count ?? 0);
  }
  return totals;
}

/** Một dòng giá trị tồn kho theo ngành (từ v_inventory_value_by_line). */
export interface InventoryByLineInput {
  lineId: string | null;
  lineCode: string | null;
  /** Giá trị hàng TVK sở hữu theo giá vốn lô (kho mình + kho đối tác). */
  ownedCostTotal: number;
  /** Giá trị hàng nhận ký gửi giữ hộ theo giá vốn (không phải tài sản). */
  consignedCost: number;
}

/** Một hàng trong bảng so sánh theo ngành (OIL / AUTO_PARTS / ALL). */
export interface LineComparisonRow {
  lineId: string | null;
  lineCode: string | null;
  lineLabel: string;
  revenue: number;
  profit: number;
  orders: number;
  /** Giá trị hàng sở hữu theo giá vốn (owned_cost_total). */
  inventoryValue: number;
  receivableOutstanding: number;
  payableOutstanding: number;
}

/** Thứ tự hiển thị cố định: Dầu nhớt trước, Phụ tùng sau. */
const LINE_ORDER: Record<string, number> = { OIL: 0, AUTO_PARTS: 1 };

/**
 * Bảng so sánh OIL vs AUTO_PARTS vs ALL từ các hàng view theo ngành.
 * - Mỗi ngành trong `lines` có một hàng (thiếu số liệu thì 0).
 * - Hàng chưa phân loại (lineId NULL) hiện thành hàng riêng khi có dữ
 *   liệu — không gộp vào ngành nào, để BL-020 nhìn thấy được.
 * - Hàng ALL luôn là tổng của MỌI hàng đầu vào (gồm chưa phân loại),
 *   nên ALL = Dầu nhớt + Phụ tùng + Chưa phân loại (nếu có).
 */
export function buildLineComparison(input: {
  sales: SalesByLineInput[];
  debts: DebtByLineInput[];
  inventory: InventoryByLineInput[];
  lines: { id: string; code: BusinessLineCode }[];
}): LineComparisonRow[] {
  const { sales, debts, inventory } = input;
  const orderedLines = [...input.lines].sort(
    (a, b) => (LINE_ORDER[a.code] ?? 2) - (LINE_ORDER[b.code] ?? 2) || a.code.localeCompare(b.code),
  );

  const rowFor = (lineId: string | null, lineCode: string | null, lineLabel: string): LineComparisonRow => {
    const s = sumSalesByLine(sales.filter((r) => r.lineId === lineId));
    const recv = sumDebtByLine(
      debts.filter((r) => r.lineId === lineId),
      "RECEIVABLE",
    );
    const pay = sumDebtByLine(
      debts.filter((r) => r.lineId === lineId),
      "PAYABLE",
    );
    const inv = inventory
      .filter((r) => r.lineId === lineId)
      .reduce((a, r) => round2(a + Number(r.ownedCostTotal ?? 0)), 0);
    return {
      lineId,
      lineCode,
      lineLabel,
      revenue: s.revenue,
      profit: s.profit,
      orders: s.orders,
      inventoryValue: inv,
      receivableOutstanding: recv.outstanding,
      payableOutstanding: pay.outstanding,
    };
  };

  const rows: LineComparisonRow[] = orderedLines.map((l) =>
    rowFor(l.id, l.code, businessLineLabel(l.code)),
  );
  const hasUnclassified =
    sales.some((r) => r.lineId === null) ||
    debts.some((r) => r.lineId === null) ||
    inventory.some((r) => r.lineId === null);
  if (hasUnclassified) {
    rows.push(rowFor(null, null, UNCLASSIFIED_LABEL));
  }
  const allSales = sumSalesByLine(sales);
  const allRecv = sumDebtByLine(debts, "RECEIVABLE");
  const allPay = sumDebtByLine(debts, "PAYABLE");
  const allInv = inventory.reduce((a, r) => round2(a + Number(r.ownedCostTotal ?? 0)), 0);
  rows.push({
    lineId: null,
    lineCode: "ALL",
    lineLabel: ALL_LINES_LABEL,
    revenue: allSales.revenue,
    profit: allSales.profit,
    orders: allSales.orders,
    inventoryValue: allInv,
    receivableOutstanding: allRecv.outstanding,
    payableOutstanding: allPay.outstanding,
  });
  return rows;
}

/** Một dòng hiệu suất theo nhóm hàng × ngành (từ v_group_performance_by_line). */
export interface GroupPerformanceInput {
  group: string;
  lineId?: string | null;
  revenue: number;
  qty: number;
}

/**
 * Gộp các hàng hiệu suất theo nhóm khi xem toàn doanh nghiệp: view trả
 * một dòng mỗi (nhóm, ngành) nên cùng nhóm ở 2 ngành phải cộng lại.
 * Doanh thu ở đây là GỘP trước chiết khấu (SUM(line_total)) — giữ đúng
 * ý nghĩa của getGroupPerformance cũ (cộng tay line_total).
 */
export function mergeGroupPerformance(
  rows: GroupPerformanceInput[],
): { group: string; revenue: number; qty: number }[] {
  const byGroup = new Map<string, { group: string; revenue: number; qty: number }>();
  for (const r of rows) {
    const label = r.group;
    const cur = byGroup.get(label) ?? { group: label, revenue: 0, qty: 0 };
    cur.revenue = round2(cur.revenue + Number(r.revenue ?? 0));
    cur.qty += Number(r.qty ?? 0);
    byGroup.set(label, cur);
  }
  return Array.from(byGroup.values()).sort((a, b) => b.revenue - a.revenue);
}

/** Kết quả kiểm tra BL-020: tổng các hàng theo ngành so với số tổng hợp. */
export interface LineTotalsCheck {
  /** Tổng cộng các hàng theo ngành. */
  perLineSum: number;
  /** Số tổng hợp toàn doanh nghiệp. */
  consolidated: number;
  /** Chênh lệch = perLineSum − consolidated (0 = khớp). */
  diff: number;
  matches: boolean;
}

/**
 * Kiểm tra BL-020: cộng các hàng theo ngành rồi so với số tổng hợp.
 * diff = 0 → khớp. diff âm (thường gặp) = số tổng hợp còn chứa hàng
 * chưa phân loại chưa nằm trong các hàng theo ngành (vd diff = −X thì
 * X chính là số chưa phân loại). So sánh sau khi làm tròn đồng.
 */
export function checkLineTotals(
  perLineAmounts: number[],
  consolidatedAmount: number,
): LineTotalsCheck {
  const perLineSum = round2(perLineAmounts.reduce((a, v) => a + Number(v ?? 0), 0));
  const consolidated = round2(Number(consolidatedAmount ?? 0));
  const diff = round2(perLineSum - consolidated);
  return { perLineSum, consolidated, diff, matches: diff === 0 };
}
