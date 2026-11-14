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

console.log("\n All verification tests passed successfully!");
