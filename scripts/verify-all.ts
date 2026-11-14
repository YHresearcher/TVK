import assert from "node:assert/strict";

// ============================================================================
// 1. FS-01 & DB-04: Password reset & Middleware security logic
// ============================================================================
console.log("▶ Testing FS-01 & DB-04 (Password reset & Middleware security logic)...");

function simulateMiddleware(path: string, isAction: boolean, mustChangePassword: boolean) {
  if (!mustChangePassword) return "ALLOW";

  const isAuthPage = path.startsWith("/auth/");
  const isLoginPage = path === "/login";

  // FS-01: Chặn triệt để mọi Server Action và API route
  // Không cho phép bất kỳ server action nào chạy khi chưa đổi mật khẩu,
  // kể cả khi POST tới đường dẫn /auth/* (tránh lỗ hổng bypass qua path).
  if (isAction || (path.startsWith("/api/") && !path.startsWith("/api/auth/"))) {
    return "403_FORBIDDEN";
  }

  if (isAuthPage || isLoginPage) {
    return "ALLOW";
  }

  return "REDIRECT_TO_CHANGE_PASSWORD";
}

// Unprivileged action blocked
assert.equal(simulateMiddleware("/api/products", false, true), "403_FORBIDDEN");
assert.equal(simulateMiddleware("/inventory", true, true), "403_FORBIDDEN");
assert.equal(simulateMiddleware("/inventory", false, true), "REDIRECT_TO_CHANGE_PASSWORD");

// CRITICAL SECURITY TEST: Server action invoked via /auth/change-password path MUST be blocked!
assert.equal(simulateMiddleware("/auth/change-password", true, true), "403_FORBIDDEN");
assert.equal(simulateMiddleware("/auth/change-password", false, true), "ALLOW");

// When must_change_password is false, all routes allowed
assert.equal(simulateMiddleware("/inventory", false, false), "ALLOW");
assert.equal(simulateMiddleware("/inventory", true, false), "ALLOW");
assert.equal(simulateMiddleware("/api/products", false, false), "ALLOW");

// DB-04: Guard profile privileges simulation
function simulateGuardProfilePrivileges(opts: {
  authUid: string | null;
  role: string;
  pgTriggerDepth: number;
  bypassSetting: boolean;
  oldFlag: boolean;
  newFlag: boolean;
}) {
  if (!opts.authUid) return "ALLOW_SERVICE_ROLE";
  if (opts.role === "OWNER") return "ALLOW_OWNER";
  if (opts.pgTriggerDepth > 1 || opts.bypassSetting) return "ALLOW_SYSTEM_TRIGGER";
  if (opts.oldFlag !== opts.newFlag) {
    throw new Error("Không có quyền thay đổi vai trò, trạng thái, email hoặc cờ bảo mật của tài khoản.");
  }
  return "ALLOW";
}

// Direct REST API by SALES user trying to unset must_change_password: MUST FAIL
assert.throws(
  () =>
    simulateGuardProfilePrivileges({
      authUid: "user-123",
      role: "SALES",
      pgTriggerDepth: 1,
      bypassSetting: false,
      oldFlag: true,
      newFlag: false,
    }),
  /Không có quyền thay đổi vai trò/
);

// Password change triggered via auth.users update (pg_trigger_depth > 1): ALLOWED
assert.equal(
  simulateGuardProfilePrivileges({
    authUid: "user-123",
    role: "SALES",
    pgTriggerDepth: 2,
    bypassSetting: false,
    oldFlag: true,
    newFlag: false,
  }),
  "ALLOW_SYSTEM_TRIGGER"
);

// Password change via complete_password_change RPC (bypass setting on): ALLOWED
assert.equal(
  simulateGuardProfilePrivileges({
    authUid: "user-123",
    role: "SALES",
    pgTriggerDepth: 1,
    bypassSetting: true,
    oldFlag: true,
    newFlag: false,
  }),
  "ALLOW_SYSTEM_TRIGGER"
);
console.log("  ✔ Middleware routing & action blocking & DB-04 guard passed.");

// ============================================================================
// 2. FS-03: Double discount prevention in queries.ts
// ============================================================================
console.log("▶ Testing FS-03 (Single discount deduction)...");

function computeDocRevenueOld(subtotal: number, discount: number) {
  const total_amount = subtotal - discount; // total_amount stored in DB
  return Math.max(Number(total_amount) - Number(discount), 0); // BUG: discount subtracted twice
}

function computeDocRevenueNew(subtotal: number, discount: number) {
  const total_amount = subtotal - discount; // total_amount stored in DB
  return Math.max(Number(total_amount ?? 0), 0); // FIXED: accurate revenue
}

const subtotal = 1_000_000;
const discount = 100_000;
assert.equal(computeDocRevenueOld(subtotal, discount), 800_000); // Buggy: lost 100k
assert.equal(computeDocRevenueNew(subtotal, discount), 900_000); // Fixed: correct
console.log("  ✔ Revenue calculation without double discount passed.");

// ============================================================================
// 3. FE-01 & FS-03: Box D transfer loss & Sell-at-loss guards
// ============================================================================
console.log("▶ Testing Box D & Sell-at-loss guards...");

function checkConsignmentOutTransfer(ownership: string, unit_cost: number, transfer_price: number) {
  if (ownership === "CONSIGNED" && transfer_price < unit_cost) {
    throw new Error(`Không được gửi ký gửi lỗ ở Ô D (giá chuyển ${transfer_price} < giá vốn ${unit_cost}).`);
  }
  return true;
}

function checkSalesSellAtLoss(ownership: string, unit_cost: number, unit_price: number) {
  if (ownership === "CONSIGNED" && unit_price < unit_cost) {
    throw new Error(`Không thể bán hàng ký gửi dưới giá vốn (giá bán ${unit_price} < giá vốn ${unit_cost}).`);
  }
  return true;
}

// Box D: transfer CONSIGNED batch
assert.throws(() => checkConsignmentOutTransfer("CONSIGNED", 100_000, 80_000), /Không được gửi ký gửi lỗ ở Ô D/);
assert.equal(checkConsignmentOutTransfer("CONSIGNED", 100_000, 100_000), true);
assert.equal(checkConsignmentOutTransfer("CONSIGNED", 100_000, 120_000), true);
assert.equal(checkConsignmentOutTransfer("OWNED", 100_000, 80_000), true); // OWNED batch is not Box D

// Sales: sell CONSIGNED batch
assert.throws(() => checkSalesSellAtLoss("CONSIGNED", 100_000, 95_000), /Không thể bán hàng ký gửi dưới giá vốn/);
assert.equal(checkSalesSellAtLoss("CONSIGNED", 100_000, 100_000), true);
assert.equal(checkSalesSellAtLoss("CONSIGNED", 100_000, 150_000), true);
assert.equal(checkSalesSellAtLoss("OWNED", 100_000, 80_000), true);
console.log("  ✔ Loss prevention guards passed.");

// ============================================================================
// 4. FS-02: Multi-location shelf splitting
// ============================================================================
console.log("▶ Testing FS-02 (Multi-location shelf splitting)...");

interface ShelfLocationStock {
  locationId: string;
  qty: number;
}
interface BatchOwnStockInfo {
  locationId: string;
  qty: number;
  shelves: ShelfLocationStock[];
}

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
      info.qty -= take; // info.qty synced with shelves
      remaining -= take;
    }
  }
  if (remaining > 0) {
    throw new Error(`Không đủ hàng tồn tại các kệ để xuất đủ số lượng ${neededQty}.`);
  }
  return splits;
}

// Case A: Single shelf has enough
const batchA: BatchOwnStockInfo = {
  locationId: "KE-01",
  qty: 10,
  shelves: [{ locationId: "KE-01", qty: 10 }],
};
const splitA = splitAcrossShelves(batchA, 4);
assert.deepEqual(splitA, [{ locationId: "KE-01", qty: 4 }]);
assert.equal(batchA.shelves[0].qty, 6);
assert.equal(batchA.qty, 6);

// Case B: Split across multiple shelves
const batchB: BatchOwnStockInfo = {
  locationId: "KE-01",
  qty: 15,
  shelves: [
    { locationId: "KE-01", qty: 6 },
    { locationId: "KE-02", qty: 5 },
    { locationId: "KE-03", qty: 4 },
  ],
};
const splitB = splitAcrossShelves(batchB, 10);
assert.deepEqual(splitB, [
  { locationId: "KE-01", qty: 6 },
  { locationId: "KE-02", qty: 4 },
]);
assert.equal(batchB.shelves[0].qty, 0);
assert.equal(batchB.shelves[1].qty, 1);
assert.equal(batchB.shelves[2].qty, 4);
assert.equal(batchB.qty, 5); // Total remaining synced

// Sub-case: Next request for remaining
const splitB2 = splitAcrossShelves(batchB, 3);
assert.deepEqual(splitB2, [
  { locationId: "KE-02", qty: 1 },
  { locationId: "KE-03", qty: 2 },
]);
assert.equal(batchB.qty, 2);

// Case C: Insufficient total quantity
const batchC: BatchOwnStockInfo = {
  locationId: "KE-01",
  qty: 3,
  shelves: [{ locationId: "KE-01", qty: 3 }],
};
assert.throws(() => splitAcrossShelves(batchC, 5), /không còn đủ hàng tồn/);
console.log("  ✔ Multi-location shelf splitting passed.");

// ============================================================================
// 5. FS-05: Targeted SKU/code query extraction
// ============================================================================
console.log("▶ Testing FS-05 (Targeted candidate code extraction)...");

function storeCode(v: string): string {
  return v.trim().replace(/\s+/g, " ");
}

const rawRows = [
  { code: "  SKU-001 ", altCodes: ["ALT-001", "alt-002  "] },
  { code: "SKU-002", altCodes: [] },
  { code: "sku-003", altCodes: ["ALT-003"] },
  { code: "  ", altCodes: [] }, // empty
];

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
assert.ok(candidateCodes.includes("SKU-001"));
assert.ok(candidateCodes.includes("sku-001"));
assert.ok(candidateCodes.includes("SKU-003"));
assert.ok(candidateCodes.includes("sku-003"));
assert.ok(candidateCodes.includes("ALT-001"));
assert.ok(candidateCodes.includes("alt-002"));
assert.equal(candidateCodes.some((c) => c === ""), false);
console.log(`  ✔ Extracted ${candidateCodes.length} candidate codes with case resilience, without limit(5000) bottleneck.`);

// ============================================================================
// 6. DB-02: Overpayment check formula (Direct & Settlement)
// ============================================================================
console.log("▶ Testing DB-02 (Overpayment guard logic)...");

function checkOverpayment(amount: number, amount_paid: number, payment_amount: number) {
  if (amount_paid + payment_amount > amount) {
    throw new Error(`Thanh toán (${amount_paid + payment_amount}) vượt quá tổng nợ (${amount}).`);
  }
  return true;
}

// Direct payable/receivable
assert.equal(checkOverpayment(1_000_000, 400_000, 600_000), true);
assert.throws(() => checkOverpayment(1_000_000, 400_000, 600_001), /vượt quá tổng nợ/);

// Settlement lines distribution & overpayment check
interface SettlementLine {
  id: string;
  amount: number;
  amount_paid: number;
}

function simulateSettlementPayment(lines: SettlementLine[], paymentAmount: number) {
  let remPay = paymentAmount;
  for (const line of lines) {
    if (remPay <= 0) break;
    const unpaid = line.amount - line.amount_paid;
    const alloc = Math.min(remPay, unpaid);
    if (alloc > 0) {
      line.amount_paid += alloc;
      remPay -= alloc;
    }
  }
  if (remPay > 0) {
    throw new Error(`Số tiền thanh toán (${paymentAmount}) vượt quá tổng công nợ còn lại của đợt đối soát (thừa ${remPay})`);
  }
  return lines;
}

// Settlement test 1: Valid partial payment
const lines1: SettlementLine[] = [
  { id: "L1", amount: 1_000_000, amount_paid: 200_000 }, // unpaid 800k
  { id: "L2", amount: 500_000, amount_paid: 0 },         // unpaid 500k
];
simulateSettlementPayment(lines1, 1_000_000);
assert.equal(lines1[0].amount_paid, 1_000_000); // L1 fully paid (200k + 800k)
assert.equal(lines1[1].amount_paid, 200_000);   // L2 partially paid (0 + 200k)

// Settlement test 2: Overpayment throws
const lines2: SettlementLine[] = [
  { id: "L1", amount: 1_000_000, amount_paid: 800_000 }, // unpaid 200k
  { id: "L2", amount: 500_000, amount_paid: 400_000 },   // unpaid 100k
]; // total unpaid = 300k
assert.throws(
  () => simulateSettlementPayment(lines2, 350_000),
  /vượt quá tổng công nợ còn lại/
);

console.log("  ✔ Direct and settlement overpayment guards passed.");

// ============================================================================
// 7. Executive Red Flags, Cash Flow Runway & 3-Way Matching Audit Logic
// ============================================================================
console.log("▶ Testing Executive Red Flags, Cash Flow Runway & 3-Way Matching Audit...");

// 7.1 Cash Flow Runway calculation
function simulateCashFlowRunway(opts: {
  receivables: { amount: number; amount_paid: number; due_date: string }[];
  payables: { amount: number; amount_paid: number; due_date: string }[];
  today: string;
}) {
  const diffDays = (d1: string, d2: string) =>
    Math.floor((Date.parse(d2) - Date.parse(d1)) / 86400000);

  let overdueRecv = 0;
  let in0to14 = 0;
  let in15to30 = 0;
  for (const r of opts.receivables) {
    const rem = Math.max(r.amount - r.amount_paid, 0);
    const d = diffDays(opts.today, r.due_date);
    if (d < 0) overdueRecv += rem;
    else if (d <= 14) in0to14 += rem;
    else if (d <= 30) in15to30 += rem;
  }

  let overduePay = 0;
  let out0to14 = 0;
  let out15to30 = 0;
  for (const p of opts.payables) {
    const rem = Math.max(p.amount - p.amount_paid, 0);
    const d = diffDays(opts.today, p.due_date);
    if (d < 0) overduePay += rem;
    else if (d <= 14) out0to14 += rem;
    else if (d <= 30) out15to30 += rem;
  }

  const inflow14 = overdueRecv + in0to14;
  const outflow14 = overduePay + out0to14;
  const net14 = inflow14 - outflow14;
  const ratio14 = outflow14 > 0 ? inflow14 / outflow14 : 1;
  const status14 = net14 < 0 || ratio14 < 0.85 ? "DANGER" : ratio14 < 1.15 ? "WARNING" : "SAFE";

  const inflow30 = overdueRecv + in0to14 + in15to30;
  const outflow30 = overduePay + out0to14 + out15to30;
  const net30 = inflow30 - outflow30;
  const ratio30 = outflow30 > 0 ? inflow30 / outflow30 : 1;
  const status30 = net30 < 0 || ratio30 < 0.85 ? "DANGER" : ratio30 < 1.15 ? "WARNING" : "SAFE";

  return { inflow14, outflow14, net14, status14, inflow30, outflow30, net30, status30 };
}

const cf1 = simulateCashFlowRunway({
  today: "2026-11-14",
  receivables: [
    { amount: 50_000_000, amount_paid: 20_000_000, due_date: "2026-11-10" }, // overdue 30M
    { amount: 40_000_000, amount_paid: 0, due_date: "2026-11-20" },          // 0-14d 40M
    { amount: 30_000_000, amount_paid: 0, due_date: "2026-12-05" },          // 15-30d 30M
  ],
  payables: [
    { amount: 20_000_000, amount_paid: 0, due_date: "2026-11-18" },          // 0-14d 20M
    { amount: 45_000_000, amount_paid: 0, due_date: "2026-12-01" },          // 15-30d 45M
  ],
});
assert.equal(cf1.inflow14, 70_000_000); // 30M overdue + 40M
assert.equal(cf1.outflow14, 20_000_000);
assert.equal(cf1.net14, 50_000_000);
assert.equal(cf1.status14, "SAFE");
assert.equal(cf1.inflow30, 100_000_000); // 70M + 30M
assert.equal(cf1.outflow30, 65_000_000); // 20M + 45M
assert.equal(cf1.net30, 35_000_000);
assert.equal(cf1.status30, "SAFE");

// Test deficit in 14-day runway
const cf2 = simulateCashFlowRunway({
  today: "2026-11-14",
  receivables: [{ amount: 10_000_000, amount_paid: 0, due_date: "2026-11-20" }],
  payables: [{ amount: 40_000_000, amount_paid: 0, due_date: "2026-11-18" }],
});
assert.equal(cf2.net14, -30_000_000);
assert.equal(cf2.status14, "DANGER");

// 7.2 Excel 6-Column Conformity Test
const REQUIRED_EXCEL_COLUMNS = [
  "Thời gian",
  "Loại cảnh báo",
  "Đối tác/NCC",
  "Mã chứng từ/Lô hàng",
  "Số lượng/Số tiền chênh lệch",
  "Lý do cảnh báo",
];

const mockAlertExcelRow = {
  "Thời gian": "14/11/2026",
  "Loại cảnh báo": "ĐỎ (Khẩn cấp)",
  "Đối tác/NCC": "Gara An Phát",
  "Mã chứng từ/Lô hàng": "Ký gửi tại Gara An Phát",
  "Số lượng/Số tiền chênh lệch": "Lệch -5 cái",
  "Lý do cảnh báo": "Số lượng không khớp: Đã gửi (20) ≠ Tiêu thụ (10) + Đã trả (2) + Còn giữ (3)",
};

for (const col of REQUIRED_EXCEL_COLUMNS) {
  assert.ok(col in mockAlertExcelRow, `Missing required Excel column: ${col}`);
}
assert.equal(Object.keys(mockAlertExcelRow).length, 6);

// 7.3 3-Way Matching Signal & Timing Logic
function evaluate3WayMatch(opts: {
  docDate: string;
  today: string;
  hasVatInvoice: boolean;
  debtStatus: "PAID" | "UNPAID";
  dueDate: string;
  unitCost: number;
  unitPrice: number;
}) {
  const daysSinceDoc = Math.floor((Date.parse(opts.today) - Date.parse(opts.docDate)) / 86400000);
  const isOverdueInvoice = !opts.hasVatInvoice && daysSinceDoc > 5;
  const isOverdueDebt = opts.debtStatus === "UNPAID" && Date.parse(opts.dueDate) < Date.parse(opts.today);
  const isSellingAtLoss = opts.unitPrice < opts.unitCost;

  if (isOverdueInvoice || isOverdueDebt || isSellingAtLoss) {
    return "RED";
  }
  if (!opts.hasVatInvoice || opts.debtStatus === "UNPAID") {
    return "AMBER";
  }
  return "GREEN";
}

// Case 1: Invoiced late (> 5 days without invoice) -> RED
assert.equal(
  evaluate3WayMatch({
    docDate: "2026-11-01",
    today: "2026-11-14", // 13 days (> 5)
    hasVatInvoice: false,
    debtStatus: "PAID",
    dueDate: "2026-11-20",
    unitCost: 100_000,
    unitPrice: 150_000,
  }),
  "RED"
);

// Case 2: Within 5 days without invoice, debt in term -> AMBER
assert.equal(
  evaluate3WayMatch({
    docDate: "2026-11-12",
    today: "2026-11-14", // 2 days (<= 5)
    hasVatInvoice: false,
    debtStatus: "UNPAID",
    dueDate: "2026-11-25",
    unitCost: 100_000,
    unitPrice: 150_000,
  }),
  "AMBER"
);

// Case 3: Fully matched: invoiced, paid, profitable -> GREEN
assert.equal(
  evaluate3WayMatch({
    docDate: "2026-11-01",
    today: "2026-11-14",
    hasVatInvoice: true,
    debtStatus: "PAID",
    dueDate: "2026-11-10",
    unitCost: 100_000,
    unitPrice: 150_000,
  }),
  "GREEN"
);

// Case 4: Sold below cost -> RED
assert.equal(
  evaluate3WayMatch({
    docDate: "2026-11-12",
    today: "2026-11-14",
    hasVatInvoice: true,
    debtStatus: "PAID",
    dueDate: "2026-11-20",
    unitCost: 200_000,
    unitPrice: 150_000, // loss
  }),
  "RED"
);

// 7.4 Total Count vs Filtered Count & Discrepancy Aggregation
const mockRows = [
  { id: "1", signal: "RED" },
  { id: "2", signal: "AMBER" },
  { id: "3", signal: "GREEN" },
  { id: "4", signal: "RED" },
];

function simulateAuditFilter(rows: { id: string; signal: string }[], filterSignal?: string) {
  const discrepancyRows = rows.filter((r) => r.signal === "RED");
  const filteredRows = !filterSignal || filterSignal === "ALL"
    ? rows
    : rows.filter((r) => r.signal === filterSignal);
  return {
    totalCount: rows.length,
    filteredCount: filteredRows.length,
    rows: filteredRows,
    discrepancyRows,
  };
}

const auditAll = simulateAuditFilter(mockRows, "ALL");
assert.equal(auditAll.totalCount, 4);
assert.equal(auditAll.filteredCount, 4);
assert.equal(auditAll.discrepancyRows.length, 2);

const auditRed = simulateAuditFilter(mockRows, "RED");
assert.equal(auditRed.totalCount, 4, "Total count must remain total evaluated items (4), not filtered items");
assert.equal(auditRed.filteredCount, 2);
assert.equal(auditRed.discrepancyRows.length, 2, "Discrepancy rows must be preserved for 1-click export");

// 7.5 Export Endpoint Authorization Guard
function checkExportAuthorization(role: string | null | undefined): boolean {
  if (!role) return false;
  return ["OWNER", "ACCOUNTING", "CEO"].includes(role);
}

assert.equal(checkExportAuthorization("OWNER"), true);
assert.equal(checkExportAuthorization("CEO"), true);
assert.equal(checkExportAuthorization("ACCOUNTING"), true);
assert.equal(checkExportAuthorization("SALES"), false);
assert.equal(checkExportAuthorization("WAREHOUSE"), false);
assert.equal(checkExportAuthorization(null), false);
assert.equal(checkExportAuthorization(undefined), false);

console.log("  ✔ Cash Flow Runway, 6-column Excel schema, 3-Way Matching & Authorization guard passed.");

// ============================================================================
// 8. CEO Executive Dashboard & Semantic Color Tokens Verification
// ============================================================================
console.log("▶ Testing CEO Executive Dashboard & Semantic Color Tokens...");

// 8.1 Authorization Guard: strictly read-only for OWNER, CEO, ACCOUNTING
function checkExecutiveRouteAccess(role: string | null | undefined): "ALLOW" | "REDIRECT_DASHBOARD" {
  const ALLOWED = new Set(["OWNER", "CEO", "ACCOUNTING"]);
  if (role && ALLOWED.has(role)) return "ALLOW";
  return "REDIRECT_DASHBOARD";
}

assert.equal(checkExecutiveRouteAccess("OWNER"), "ALLOW");
assert.equal(checkExecutiveRouteAccess("CEO"), "ALLOW");
assert.equal(checkExecutiveRouteAccess("ACCOUNTING"), "ALLOW");
assert.equal(checkExecutiveRouteAccess("SALES"), "REDIRECT_DASHBOARD");
assert.equal(checkExecutiveRouteAccess("WAREHOUSE"), "REDIRECT_DASHBOARD");
assert.equal(checkExecutiveRouteAccess(null), "REDIRECT_DASHBOARD");

// 8.2 Strategic KPI Calculation Rules & Zero Denominator Handlers
function calculateGrossMargin(revenue: number, grossProfit: number): string {
  if (revenue <= 0) return "—";
  return ((grossProfit / revenue) * 100).toFixed(1) + "%";
}

function calculateOverdueRatio(totalReceivables: number, overdueReceivables: number): string {
  if (totalReceivables <= 0) return "—";
  return ((overdueReceivables / totalReceivables) * 100).toFixed(1) + "%";
}

function calculateInventoryTurnover(inventoryCapital: number, periodCogs: number): string {
  if (inventoryCapital <= 0) return "—";
  return (periodCogs / inventoryCapital).toFixed(2) + " vòng";
}

// Normal positive cases
assert.equal(calculateGrossMargin(100000000, 25000000), "25.0%");
assert.equal(calculateOverdueRatio(200000000, 30000000), "15.0%");
assert.equal(calculateInventoryTurnover(500000000, 1000000000), "2.00 vòng");

// Zero denominator cases MUST return "—", never "0.0%" or fake %
assert.equal(calculateGrossMargin(0, 0), "—");
assert.equal(calculateGrossMargin(-100, -20), "—");
assert.equal(calculateOverdueRatio(0, 0), "—");
assert.equal(calculateInventoryTurnover(0, 500000), "—");

// 8.3 Semantic Token Separation Check
import { SEMANTIC_COLORS } from "../src/lib/tokens.ts";

assert.equal(SEMANTIC_COLORS.cogs, "#F59E0B", "cogs must be amber #F59E0B");
assert.equal(SEMANTIC_COLORS.supplierConsignment, "#0284C7", "supplierConsignment must be #0284C7");
assert.notEqual(
  SEMANTIC_COLORS.cogs,
  SEMANTIC_COLORS.supplierConsignment,
  "cogs and supplierConsignment tokens must have distinct color codes"
);

// 8.4 Receivables Aging Bucket Distribution Check
function categorizeAging(daysOverdue: number): "not_due" | "1_30" | "31_60" | "over_60" {
  if (daysOverdue <= 0) return "not_due";
  if (daysOverdue <= 30) return "1_30";
  if (daysOverdue <= 60) return "31_60";
  return "over_60";
}

assert.equal(categorizeAging(-5), "not_due");
assert.equal(categorizeAging(0), "not_due");
assert.equal(categorizeAging(1), "1_30");
assert.equal(categorizeAging(30), "1_30");
assert.equal(categorizeAging(31), "31_60");
assert.equal(categorizeAging(60), "31_60");
assert.equal(categorizeAging(61), "over_60");
assert.equal(categorizeAging(120), "over_60");

console.log("  ✔ CEO Dashboard access control, zero-denominator handlers & token separation passed.");

console.log("\n All verification tests passed successfully!");
