import assert from "node:assert/strict";
import { InMemoryDB } from "./harness/in-memory-db";

export function validateMovementAmount(amount: number): { valid: boolean; error?: string } {
  if (typeof amount !== "number" || Number.isNaN(amount)) {
    return { valid: false, error: "Số tiền không hợp lệ." };
  }
  if (amount === 0) {
    return { valid: false, error: "Số tiền phải lớn hơn 0." };
  }
  if (amount < 0) {
    return { valid: false, error: "Số tiền không được là số âm. Số tiền phải lớn hơn 0." };
  }
  return { valid: true };
}

export function validateDateAndCutoff(dateStr: string, openingBalanceDate: string): { valid: boolean; error?: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { valid: false, error: "Định dạng ngày không hợp lệ. Yêu cầu YYYY-MM-DD." };
  }
  const d = new Date(dateStr + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dateStr) {
    return { valid: false, error: `Ngày không tồn tại trong lịch (${dateStr}).` };
  }
  if (dateStr < openingBalanceDate) {
    return { valid: false, error: `Ngày giao dịch (${dateStr}) không thể trước ngày chốt số dư đầu kỳ (${openingBalanceDate}).` };
  }
  return { valid: true };
}

export function calculateGrossMargin(revenue: number, grossProfit: number): string {
  if (revenue <= 0) return "—";
  return ((grossProfit / revenue) * 100).toFixed(1) + "%";
}

export function calculateOverdueRatio(totalReceivables: number, overdueReceivables: number): string {
  if (totalReceivables <= 0) return "—";
  return ((overdueReceivables / totalReceivables) * 100).toFixed(1) + "%";
}

export function calculateInventoryTurnover(inventoryCapital: number, periodCogs: number): string {
  if (inventoryCapital <= 0) return "—";
  return (periodCogs / inventoryCapital).toFixed(2) + " vòng";
}

export async function runTier2Tests(): Promise<{ passed: number; total: number }> {
  let passed = 0;
  const db = new InMemoryDB();

  function test(name: string, fn: () => void) {
    try {
      fn();
      passed++;
      console.log(`    ✔ ${name}`);
    } catch (err: any) {
      console.error(`    ❌ ${name}: ${err.message}`);
      throw err;
    }
  }

  async function testAsync(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`    ✔ ${name}`);
    } catch (err: any) {
      console.error(`    ❌ ${name}: ${err.message}`);
      throw err;
    }
  }

  console.log("  ▶ Tier 2: Boundary Value Analysis & Corner Cases");

  // TC2.1: Quỹ rỗng / Mới tạo
  await testAsync("TC2.1: Quỹ rỗng mới tạo có balance = 0, total_in = 0, total_out = 0, không NaN/null", async () => {
    db.reset();
    db.setRole("OWNER");
    const fund = await db.from("cash_funds").insert({
      name: "Quỹ Mới 0đ",
      kind: "CASH",
      opening_balance: 0,
      opening_balance_date: "2026-01-01",
      is_active: true,
    });

    const bal = db.getFundBalances().find((b) => b.fund_id === fund.data.id)!;
    assert.equal(bal.balance, 0);
    assert.equal(bal.total_in, 0);
    assert.equal(bal.total_out, 0);
    assert.equal(Number.isNaN(bal.balance), false);
    assert.notEqual(bal.balance, null);
  });

  // TC2.2: Số tiền bằng 0
  test("TC2.2: Xác thực chặn giao dịch với số tiền = 0", () => {
    const val = validateMovementAmount(0);
    assert.equal(val.valid, false);
    assert.equal(val.error, "Số tiền phải lớn hơn 0.");

    assert.throws(() => {
      db.transfer_internal_cash_funds({
        p_source_fund_id: "fund-a",
        p_dest_fund_id: "fund-b",
        p_amount: 0,
        p_transfer_date: "2026-01-01",
      });
    }, /Số tiền chuyển quỹ phải lớn hơn 0/);
  });

  // TC2.3: Số tiền âm
  test("TC2.3: Xác thực chặn nhập số tiền âm (ngăn chặn đảo dấu làm tăng quỹ trái phép)", () => {
    const val = validateMovementAmount(-5_000_000);
    assert.equal(val.valid, false);
    assert.equal(val.error, "Số tiền không được là số âm. Số tiền phải lớn hơn 0.");

    assert.throws(() => {
      db.transfer_internal_cash_funds({
        p_source_fund_id: "fund-a",
        p_dest_fund_id: "fund-b",
        p_amount: -10_000_000,
        p_transfer_date: "2026-01-01",
      });
    }, /Số tiền chuyển quỹ phải lớn hơn 0/);
  });

  // TC2.4: Số tiền cực lớn > 100 Tỷ VNĐ
  await testAsync("TC2.4: Số tiền cực lớn 250 tỷ VNĐ (250_000_000_000) bảo toàn độ chính xác số học", async () => {
    db.reset();
    db.setRole("OWNER");
    const largeOpening = 250_000_000_000;
    const fund = await db.from("cash_funds").insert({
      name: "Quỹ Vốn Điều Lệ Lớn",
      kind: "BANK",
      opening_balance: largeOpening,
      opening_balance_date: "2026-01-01",
      is_active: true,
    });

    const delta = 1_234_567;
    await db.from("cash_movements").insert({
      fund_id: fund.data.id,
      movement_kind: "OPERATING",
      amount: delta,
      movement_date: "2026-01-10",
      is_cancelled: false,
    });

    const bal = db.getFundBalances().find((b) => b.fund_id === fund.data.id)!;
    assert.equal(bal.balance, 250_001_234_567);
  });

  // TC2.5: Ngày không hợp lệ & Ngày trước số dư đầu kỳ
  test("TC2.5: Kiểm tra tính hợp lệ của ngày: từ chối 29/02 năm không nhuận và ngày trước số dư đầu kỳ", () => {
    const openingDate = "2026-01-01";

    // 2026 không phải năm nhuận -> 2026-02-29 không tồn tại
    const leapRes = validateDateAndCutoff("2026-02-29", openingDate);
    assert.equal(leapRes.valid, false);
    assert.match(leapRes.error!, /Ngày không tồn tại trong lịch/);

    // Ngày trước số dư đầu kỳ
    const beforeRes = validateDateAndCutoff("2025-12-15", openingDate);
    assert.equal(beforeRes.valid, false);
    assert.match(beforeRes.error!, /không thể trước ngày chốt số dư đầu kỳ/);

    // Ngày hợp lệ
    const validRes = validateDateAndCutoff("2026-01-15", openingDate);
    assert.equal(validRes.valid, true);
  });

  // TC2.6: Kỳ đối chiếu đã khoá
  await testAsync("TC2.6: Kỳ đối chiếu đã khoá (LOCKED) chặn mọi thao tác thêm/sửa entry", async () => {
    db.reset();
    db.setRole("OWNER");
    const period = await db.from("reconciliation_periods").insert({
      period_type: "MONTH",
      name: "Tháng 08/2026 Đã Khoá",
      from_date: "2026-08-01",
      to_date: "2026-08-31",
      status: "LOCKED",
    });

    // Thử thêm entry vào kỳ LOCKED
    const insRes = await db.from("reconciliation_entries").insert({
      period_id: period.data.id,
      data_group: "CASH_FUND",
      item_key: "FUND_TEST",
      item_name: "Test Locked",
      tvk_amount: 10_000_000,
    });
    assert.notEqual(insRes.error, null);
    assert.match(insRes.error.message, /Kỳ đối chiếu đã đóng, không thể sửa đổi số liệu/);
  });

  // TC2.7: Làm tròn ngoại tệ & Thuế GTGT 8%
  test("TC2.7: Thuế GTGT 8% và tỷ giá 27,000 không bị lệch sai số dấu phẩy động trên 50 đơn vị", () => {
    const usdPrice = 26.87;
    const rate = 27000;
    const vatRate = 0.08;
    const unitPriceBeforeVat = usdPrice * rate; // 725490
    const vatAmount = unitPriceBeforeVat * vatRate; // 58039.2
    const unitCost = unitPriceBeforeVat + vatAmount; // 783529.2

    assert.equal(unitPriceBeforeVat, 725490);
    assert.ok(Math.abs(vatAmount - 58039.2) < 1e-6);
    assert.ok(Math.abs(unitCost - 783529.2) < 1e-6);

    const qty = 50;
    const totalCost = qty * unitCost; // 39176460
    assert.ok(Math.abs(totalCost - 39176460) < 1e-4);
  });

  // TC2.8: Mẫu số bằng 0 trong KPI tài chính
  test("TC2.8: Xử lý mẫu số bằng 0 trong KPI tài chính trả về '—', tuyệt đối không trả về '0.0%', Infinity, hay NaN", () => {
    // Gross margin khi revenue = 0
    assert.equal(calculateGrossMargin(0, 0), "—");
    assert.equal(calculateGrossMargin(0, 10_000_000), "—");
    assert.equal(calculateGrossMargin(-100, -20), "—");

    // Overdue ratio khi total debt = 0
    assert.equal(calculateOverdueRatio(0, 0), "—");
    assert.equal(calculateOverdueRatio(0, 5_000_000), "—");

    // Inventory turnover khi inventory capital = 0
    assert.equal(calculateInventoryTurnover(0, 500_000_000), "—");

    // Kiểm tra trường hợp mẫu số > 0 bình thường
    assert.equal(calculateGrossMargin(100_000_000, 25_000_000), "25.0%");
    assert.equal(calculateOverdueRatio(200_000_000, 30_000_000), "15.0%");
    assert.equal(calculateInventoryTurnover(500_000_000, 1_000_000_000), "2.00 vòng");
  });

  return { passed, total: 8 };
}

if (process.argv[1]?.endsWith("tier2-boundaries.test.ts")) {
  runTier2Tests()
    .then((r) => {
      console.log(`\nAll ${r.passed}/${r.total} Tier 2 tests passed!`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
