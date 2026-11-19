import assert from "node:assert/strict";
import crypto from "node:crypto";
import { InMemoryDB } from "./harness/in-memory-db";

export interface CashFlowRunwayParams {
  currentAvailableCash: number;
  inflow14: number;
  outflow14: number;
  fixedCost14: number;
  inflow30: number;
  outflow30: number;
  fixedCost30: number;
}

export function computeCashFlowForecast(p: CashFlowRunwayParams) {
  const net14 = p.currentAvailableCash + p.inflow14 - p.outflow14 - p.fixedCost14;
  const safetyRatio14 = (p.outflow14 + p.fixedCost14) > 0
    ? (p.currentAvailableCash + p.inflow14) / (p.outflow14 + p.fixedCost14)
    : 99;
  let safetyStatus14: "SAFE" | "WARNING" | "DANGER" = "SAFE";
  if (net14 < 0 || safetyRatio14 < 0.85) {
    safetyStatus14 = "DANGER";
  } else if (safetyRatio14 < 1.15) {
    safetyStatus14 = "WARNING";
  }

  const net30 = p.currentAvailableCash + p.inflow30 - p.outflow30 - p.fixedCost30;
  const safetyRatio30 = (p.outflow30 + p.fixedCost30) > 0
    ? (p.currentAvailableCash + p.inflow30) / (p.outflow30 + p.fixedCost30)
    : 99;
  let safetyStatus30: "SAFE" | "WARNING" | "DANGER" = "SAFE";
  if (net30 < 0 || safetyRatio30 < 0.85) {
    safetyStatus30 = "DANGER";
  } else if (safetyRatio30 < 1.15) {
    safetyStatus30 = "WARNING";
  }

  return {
    net14,
    safetyRatio14,
    safetyStatus14,
    net30,
    safetyRatio30,
    safetyStatus30,
  };
}

export async function runTier3Tests(): Promise<{ passed: number; total: number }> {
  let passed = 0;
  const db = new InMemoryDB();

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

  console.log("  ▶ Tier 3: Cross-Feature Integration Combinations");

  // TC3.1: Chuyển quỹ nội bộ kèm Huỷ bút toán đảo (Transfer -> Reversal)
  await testAsync("TC3.1: Transfer -> Reversal: Két 50M, VCB 100M -> Chuyển 30M -> Huỷ lệnh chuyển hoàn lại số dư ban đầu", async () => {
    db.reset();
    db.setRole("OWNER");
    // Bước 1: Khởi tạo quỹ
    const ket = await db.from("cash_funds").insert({ name: "Két Tiền Mặt", kind: "CASH", opening_balance: 50_000_000, opening_balance_date: "2026-01-01", is_active: true });
    const vcb = await db.from("cash_funds").insert({ name: "VCB Công Ty", kind: "BANK", opening_balance: 100_000_000, opening_balance_date: "2026-01-01", is_active: true });

    let b1 = db.getFundBalances();
    assert.equal(b1.find((b) => b.fund_id === ket.data.id)!.balance, 50_000_000);
    assert.equal(b1.find((b) => b.fund_id === vcb.data.id)!.balance, 100_000_000);
    assert.equal(b1.reduce((s, b) => s + b.balance, 0), 150_000_000);

    // Bước 2: Chuyển 30M từ Két sang VCB
    const transferId = db.transfer_internal_cash_funds({
      p_source_fund_id: ket.data.id,
      p_dest_fund_id: vcb.data.id,
      p_amount: 30_000_000,
      p_transfer_date: "2026-01-10",
      p_note: "Nộp tiền mặt vào VCB",
    });

    let b2 = db.getFundBalances();
    assert.equal(b2.find((b) => b.fund_id === ket.data.id)!.balance, 20_000_000);
    assert.equal(b2.find((b) => b.fund_id === vcb.data.id)!.balance, 130_000_000);
    assert.equal(b2.reduce((s, b) => s + b.balance, 0), 150_000_000);

    // Bước 3: OWNER huỷ lệnh chuyển
    const movs = db.cash_movements.filter((m) => m.transfer_id === transferId);
    assert.equal(movs.length, 2);
    db.cancel_cash_movement_reversal({
      p_movement_id: movs[0].id,
      p_reason: "Chuyển nhầm tài khoản",
    });

    // Bước 4: Kiểm tra phục hồi hoàn toàn
    let b3 = db.getFundBalances();
    assert.equal(b3.find((b) => b.fund_id === ket.data.id)!.balance, 50_000_000);
    assert.equal(b3.find((b) => b.fund_id === vcb.data.id)!.balance, 100_000_000);
    assert.equal(b3.reduce((s, b) => s + b.balance, 0), 150_000_000);

    // Vết kiểm toán đầy đủ 4 bản ghi: 2 chuyển quỹ gốc + 2 bút toán đảo
    const allMovs = db.cash_movements.filter((m) => m.transfer_id === transferId);
    assert.equal(allMovs.length, 4);
    assert.equal(allMovs.filter((m) => m.movement_kind === "INTERNAL_TRANSFER" && m.is_cancelled).length, 2);
    assert.equal(allMovs.filter((m) => m.movement_kind === "REVERSAL").length, 2);
  });

  // TC3.2: Xuất hàng ký gửi kèm Đối chiếu chênh lệch 2 tầng (Consignment -> Reconciliation)
  await testAsync("TC3.2: Consignment -> Reconciliation: Xuất ký gửi 161 cái (122.784M) -> Lệch doanh thu -> Ghi nhận VALID_TAX_TIMING", async () => {
    db.reset();
    db.setRole("OWNER");
    // Bước 1: Tạo kỳ đối chiếu Tháng 09/2026
    const period = await db.from("reconciliation_periods").insert({
      period_type: "MONTH",
      name: "Tháng 09/2026",
      from_date: "2026-09-01",
      to_date: "2026-09-30",
      status: "OPEN",
    });

    // Bước 2: Tồn kho tổng hợp (Nhóm 4): TVK = 3,621,000,153.6, Kế toán = 3,621,000,153.6 -> MATCHED
    await db.from("reconciliation_entries").insert({
      period_id: period.data.id,
      data_group: "INVENTORY",
      item_key: "INV_TOTAL",
      item_name: "Tồn kho tổng hợp HOWO (Kho TVK + Kho ký gửi Á Âu)",
      tvk_amount: 3_621_000_153.6,
      accounting_amount: 3_621_000_153.6,
      drilldown_data: { ownedWarehouse: 4850 - 161, consignmentWarehouse: 161 },
    });

    // Bước 3: Doanh thu (Nhóm 5): TVK chỉ tính doanh thu bán đứt Âu Châu (342,755,000đ).
    // Kế toán vội hạch toán cả lô ký gửi Á Âu (342,755,000 + 122,784,000 = 465,539,000đ)
    const revEntry = await db.from("reconciliation_entries").insert({
      period_id: period.data.id,
      data_group: "REVENUE_EXPENSE",
      item_key: "REV_TOTAL",
      item_name: "Tổng doanh thu bán hàng & dịch vụ",
      tvk_amount: 342_755_000,
      accounting_amount: 465_539_000,
    });

    assert.equal(revEntry.data.difference_amount, -122_784_000);
    assert.equal(revEntry.data.discrepancy_status, "PENDING");

    // Bước 4: Kế toán cập nhật phân loại lệch sang VALID_TAX_TIMING kèm giải trình
    db.setRole("ACCOUNTING");
    await db
      .from("reconciliation_entries")
      .update({
        discrepancy_status: "VALID_TAX_TIMING",
        explanation_note: "Hàng gửi đại lý Cty Á Âu 161 cái chưa xuất hoá đơn GTGT và chưa có biên bản tiêu thụ.",
      })
      .eq("id", revEntry.data.id);

    const verified = db.reconciliation_entries.find((e) => e.id === revEntry.data.id)!;
    assert.equal(verified.discrepancy_status, "VALID_TAX_TIMING");
    assert.match(verified.explanation_note!, /chưa xuất hoá đơn GTGT/);
  });

  // TC3.3: Thu nợ khách hàng kèm Huỷ phiếu khôi phục công nợ (Debt Payment -> Reversal)
  await testAsync("TC3.3: Debt Payment -> Reversal: Thu nợ 40M từ khách 100M -> Huỷ phiếu -> Quỹ giảm 40M và công nợ phục hồi 100M", async () => {
    db.reset();
    db.setRole("OWNER");
    const vcb = await db.from("cash_funds").insert({ name: "VCB", kind: "BANK", opening_balance: 50_000_000, opening_balance_date: "2026-01-01", is_active: true });

    // Khách hàng Âu Châu có nợ 100,000,000 VNĐ
    const recId = crypto.randomUUID();
    db.partner_receivables.push({
      id: recId,
      partner_name: "Cty Âu Châu",
      amount: 100_000_000,
      amount_paid: 40_000_000,
      status: "PARTIAL",
      due_date: "2026-03-31",
    });

    const pmtId = crypto.randomUUID();
    db.payments.push({
      id: pmtId,
      receivable_id: recId,
      amount: 40_000_000,
      payment_date: "2026-01-10",
      note: "Thu nợ chuyển khoản",
    });

    const mov = await db.from("cash_movements").insert({
      fund_id: vcb.data.id,
      movement_kind: "DEBT_PAYMENT",
      amount: 40_000_000,
      movement_date: "2026-01-10",
      payment_id: pmtId,
      is_cancelled: false,
    });

    // Số dư VCB đã tăng lên 90M, nợ còn 60M
    assert.equal(db.getFundBalances().find((b) => b.fund_id === vcb.data.id)!.balance, 90_000_000);
    const recBefore = db.partner_receivables.find((r) => r.id === recId)!;
    assert.equal(recBefore.amount - recBefore.amount_paid, 60_000_000);

    // Ngân hàng hoàn trả lệnh -> OWNER huỷ phiếu thu
    db.cancel_cash_movement_reversal({
      p_movement_id: mov.data.id,
      p_reason: "Uỷ nhiệm chi bị hoàn trả",
    });

    // Quỹ VCB trở lại 50M
    assert.equal(db.getFundBalances().find((b) => b.fund_id === vcb.data.id)!.balance, 50_000_000);

    // Công nợ phải thu của Âu Châu tự động phục hồi về 100M
    const recAfter = db.partner_receivables.find((r) => r.id === recId)!;
    assert.equal(recAfter.amount_paid, 0);
    assert.equal(recAfter.status, "UNPAID");
    assert.equal(recAfter.amount - recAfter.amount_paid, 100_000_000);
  });

  // TC3.4: Đồng bộ Dự báo dòng tiền 14-30 ngày (/cashflow <-> /executive)
  await testAsync("TC3.4: 14-30 day cashflow runway sync: Khả dụng 300M + Thu 150M - Chi 100M - Phí cố định 20M = 330M (SAFE)", async () => {
    db.reset();
    db.setRole("OWNER");
    // 2 quỹ: Két 100M, VCB 200M -> Khả dụng 300M
    await db.from("cash_funds").insert([
      { name: "Két", kind: "CASH", opening_balance: 100_000_000, opening_balance_date: "2026-01-01", is_active: true },
      { name: "VCB", kind: "BANK", opening_balance: 200_000_000, opening_balance_date: "2026-01-01", is_active: true },
    ]);
    const availableCash = db.getFundBalances().reduce((s, b) => s + b.balance, 0);
    assert.equal(availableCash, 300_000_000);

    const forecast = computeCashFlowForecast({
      currentAvailableCash: availableCash,
      inflow14: 150_000_000,
      outflow14: 100_000_000,
      fixedCost14: 20_000_000, // Chi phí mặt bằng cố định
      inflow30: 250_000_000,
      outflow30: 180_000_000,
      fixedCost30: 40_000_000,
    });

    // net14 = 300 + 150 - 100 - 20 = 330M
    assert.equal(forecast.net14, 330_000_000);
    assert.equal(forecast.safetyStatus14, "SAFE");

    // net30 = 300 + 250 - 180 - 40 = 330M
    assert.equal(forecast.net30, 330_000_000);
    assert.equal(forecast.safetyStatus30, "SAFE");
  });

  // TC3.5: Snapshot immutability vs back-dated live vouchers
  await testAsync("TC3.5: Snapshot immutability: Bản chốt kỳ đóng băng 342.755M bất biến khi chứng từ lùi ngày 10M được thêm", async () => {
    db.reset();
    db.setRole("OWNER");
    const period = await db.from("reconciliation_periods").insert({
      period_type: "MONTH",
      name: "Tháng 09/2026",
      from_date: "2026-09-01",
      to_date: "2026-09-30",
      status: "OPEN",
    });

    await db.from("reconciliation_entries").insert({
      period_id: period.data.id,
      data_group: "REVENUE_EXPENSE",
      item_key: "REV_AU_CHAU",
      item_name: "Doanh thu bán Cty Âu Châu Tháng 9",
      tvk_amount: 342_755_000,
      accounting_amount: 342_755_000,
    });

    // Chốt kỳ snapshot
    const snapId = db.create_reconciliation_snapshot({
      p_period_id: period.data.id,
      p_name: "Bản chốt chính thức T9",
      p_note: "Đã chốt sổ sách",
    });

    const frozenSnapshot = db.reconciliation_snapshots.find((s) => s.id === snapId)!;
    assert.equal(frozenSnapshot.total_tvk, 342_755_000);
    assert.equal(frozenSnapshot.snapshot_items[0].tvk_amount, 342_755_000);

    // Người dùng vào lập hoá đơn bổ sung lùi ngày 15/09/2026 trị giá 10M
    // Thêm một chứng từ mới vào live TVK
    const liveEntry = db.reconciliation_entries.find((e) => e.item_key === "REV_AU_CHAU")!;
    liveEntry.tvk_amount += 10_000_000;
    liveEntry.difference_amount = liveEntry.tvk_amount - liveEntry.accounting_amount;

    // Số liệu live đã đổi thành 352,755,000 VNĐ
    assert.equal(liveEntry.tvk_amount, 352_755_000);

    // NHƯNG bản chốt snapshot trong quá khứ vẫn giữ nguyên 100% là 342,755,000 VNĐ
    const reopenedSnapshot = db.reconciliation_snapshots.find((s) => s.id === snapId)!;
    assert.equal(reopenedSnapshot.total_tvk, 342_755_000);
    assert.equal(reopenedSnapshot.snapshot_items[0].tvk_amount, 342_755_000);
    assert.notEqual(reopenedSnapshot.total_tvk, liveEntry.tvk_amount);
  });

  return { passed, total: 5 };
}

if (process.argv[1]?.endsWith("tier3-combinations.test.ts")) {
  runTier3Tests()
    .then((r) => {
      console.log(`\nAll ${r.passed}/${r.total} Tier 3 tests passed!`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
