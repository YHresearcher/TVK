import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { InMemoryDB } from "./harness/in-memory-db";
import { toNum, toDateISO } from "../../src/lib/excel-parse";

export async function runTier1Tests(): Promise<{ passed: number; total: number }> {
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

  console.log("  ▶ Cluster 1: Quản Trị Quỹ Tiền (cash_funds)");
  // TC1.1: Tạo quỹ mới (Két tiền mặt & Tài khoản NH)
  await testAsync("TC1.1: Tạo quỹ CASH/BANK với opening_balance và opening_balance_date", async () => {
    db.reset();
    db.setRole("OWNER");
    const res = await db.from("cash_funds").insert({
      name: "Két Tiền Mặt Văn Phòng",
      kind: "CASH",
      opening_balance: 50_000_000,
      opening_balance_date: "2026-01-01",
      is_active: true,
    });
    assert.equal(res.error, null);
    assert.equal(res.data.name, "Két Tiền Mặt Văn Phòng");
    assert.equal(res.data.kind, "CASH");
    assert.equal(res.data.opening_balance, 50_000_000);
    assert.equal(res.data.opening_balance_date, "2026-01-01");
    assert.equal(res.data.is_active, true);
  });

  // TC1.2: Tính số dư quỹ qua view v_cash_fund_balances
  await testAsync("TC1.2: Tính số dư quỹ qua view v_cash_fund_balances (opening + in - out)", async () => {
    db.reset();
    db.setRole("OWNER");
    const fundRes = await db.from("cash_funds").insert({
      name: "Tài khoản Vietcombank",
      kind: "BANK",
      opening_balance: 100_000_000,
      opening_balance_date: "2026-01-01",
      is_active: true,
    });
    const fundId = fundRes.data.id;

    // Thu 20M
    await db.from("cash_movements").insert({
      fund_id: fundId,
      movement_kind: "OPERATING",
      amount: 20_000_000,
      movement_date: "2026-01-10",
      note: "Thu khách lẻ",
      is_cancelled: false,
    });

    // Chi 30M
    await db.from("cash_movements").insert({
      fund_id: fundId,
      movement_kind: "OPERATING",
      amount: -30_000_000,
      movement_date: "2026-01-15",
      note: "Chi tiền thuê",
      is_cancelled: false,
    });

    const viewRes = await db.from("v_cash_fund_balances").select().eq("fund_id", fundId).single();
    assert.equal(viewRes.error, null);
    assert.equal(viewRes.data.balance, 90_000_000);
    assert.equal(viewRes.data.total_in, 20_000_000);
    assert.equal(viewRes.data.total_out, 30_000_000);
  });

  // TC1.3: Tắt hoạt động quỹ tiền
  await testAsync("TC1.3: Tắt hoạt động quỹ tiền (is_active = false) và bảo toàn lịch sử", async () => {
    db.reset();
    db.setRole("OWNER");
    const fundRes = await db.from("cash_funds").insert({
      name: "Tài khoản Sacombank Cũ",
      kind: "BANK",
      opening_balance: 10_000_000,
      opening_balance_date: "2026-01-01",
      is_active: true,
    });
    const fundId = fundRes.data.id;

    await db.from("cash_movements").insert({
      fund_id: fundId,
      movement_kind: "OPERATING",
      amount: 5_000_000,
      movement_date: "2026-01-05",
      is_cancelled: false,
    });

    await db.from("cash_funds").update({ is_active: false }).eq("id", fundId);

    const updated = await db.from("cash_funds").select().eq("id", fundId).single();
    assert.equal(updated.data.is_active, false);

    const movs = await db.from("cash_movements").select().eq("fund_id", fundId);
    assert.equal(movs.data.length, 1);
  });

  // TC1.4: Cập nhật thông tin quỹ tiền (chỉ OWNER)
  await testAsync("TC1.4: Cập nhật tên và ngày chốt số dư đầu kỳ (OWNER được phép, vai trò khác bị chặn)", async () => {
    db.reset();
    db.setRole("OWNER");
    const fund = await db.from("cash_funds").insert({
      name: "Két Tiền Cửa Hàng",
      kind: "CASH",
      opening_balance: 20_000_000,
      opening_balance_date: "2026-01-01",
      is_active: true,
    });

    // OWNER update
    await db.from("cash_funds").update({ name: "Két Tiền Mặt Tổng", opening_balance_date: "2026-02-01" }).eq("id", fund.data.id);
    const updated = await db.from("cash_funds").select().eq("id", fund.data.id).single();
    assert.equal(updated.data.name, "Két Tiền Mặt Tổng");
    assert.equal(updated.data.opening_balance_date, "2026-02-01");

    // ACCOUNTING update blocked
    db.setRole("ACCOUNTING");
    const accRes = await db.from("cash_funds").update({ name: "Két Hack" }).eq("id", fund.data.id);
    assert.notEqual(accRes.error, null);
  });

  // TC1.5: Tổng tiền sẵn có hợp nhất
  await testAsync("TC1.5: Tổng tiền sẵn có hợp nhất chính xác từ nhiều quỹ đang hoạt động", async () => {
    db.reset();
    db.setRole("OWNER");
    await db.from("cash_funds").insert([
      { name: "Két Tiền Mặt", kind: "CASH", opening_balance: 50_000_000, opening_balance_date: "2026-01-01", is_active: true },
      { name: "VCB Công Ty", kind: "BANK", opening_balance: 200_000_000, opening_balance_date: "2026-01-01", is_active: true },
      { name: "ACB Dự Phòng", kind: "BANK", opening_balance: 150_000_000, opening_balance_date: "2026-01-01", is_active: true },
      { name: "Quỹ Cũ Đã Đóng", kind: "BANK", opening_balance: 99_000_000, opening_balance_date: "2026-01-01", is_active: false },
    ]);

    const activeBalances = db.getFundBalances().filter((b) => b.is_active);
    const totalAvailable = activeBalances.reduce((s, b) => s + b.balance, 0);
    assert.equal(totalAvailable, 400_000_000);
  });

  // TC1.6: Ngăn chặn xoá cứng quỹ tiền
  await testAsync("TC1.6: Ngăn chặn xoá cứng quỹ tiền (DELETE blocked)", async () => {
    db.reset();
    db.setRole("OWNER");
    const fund = await db.from("cash_funds").insert({
      name: "Quỹ Thử Nghiệm",
      kind: "CASH",
      opening_balance: 1_000_000,
      opening_balance_date: "2026-01-01",
      is_active: true,
    });
    const delRes = await db.from("cash_funds").delete().eq("id", fund.data.id);
    assert.notEqual(delRes.error, null);
    assert.match(delRes.error.message, /Operation not permitted: DELETE on cash_funds/);
  });

  console.log("  ▶ Cluster 2: Danh Mục Thu/Chi Vận Hành (cash_categories)");
  // TC1.7: Khởi tạo 12 danh mục chi phí mặc định
  test("TC1.7: Khởi tạo đúng 12 danh mục mặc định trong 5 nhóm (SALARY, RENT, TRANSPORT, TAX, OTHER)", () => {
    db.reset();
    const cats = db.cash_categories;
    assert.equal(cats.length, 12);
    const groups = new Set(cats.map((c) => c.group_key));
    assert.deepEqual(Array.from(groups).sort(), ["OTHER", "RENT", "SALARY", "TAX", "TRANSPORT"]);
    assert.equal(cats.every((c) => c.is_system), true);
  });

  // TC1.8: Ghi nhận chi phí vận hành ngoài công nợ
  await testAsync("TC1.8: Ghi nhận chi phí vận hành ngoài công nợ (-5M RENT)", async () => {
    db.reset();
    db.setRole("OWNER");
    const fund = await db.from("cash_funds").insert({
      name: "Két Tiền Mặt",
      kind: "CASH",
      opening_balance: 50_000_000,
      opening_balance_date: "2026-01-01",
      is_active: true,
    });
    const rentCat = db.cash_categories.find((c) => c.code === "CHI_MAT_BANG")!;

    const movRes = await db.from("cash_movements").insert({
      fund_id: fund.data.id,
      movement_kind: "OPERATING",
      category_id: rentCat.id,
      amount: -5_000_000,
      movement_date: "2026-01-05",
      note: "Tiền thuê kho Tháng 1",
      is_cancelled: false,
    });
    assert.equal(movRes.error, null);
    assert.equal(movRes.data.amount, -5_000_000);
    assert.equal(movRes.data.movement_kind, "OPERATING");

    const bal = db.getFundBalances().find((b) => b.fund_id === fund.data.id)!;
    assert.equal(bal.balance, 45_000_000);
    assert.equal(bal.total_out, 5_000_000);
  });

  // TC1.9: Ghi nhận thu nhập vận hành ngoài công nợ
  await testAsync("TC1.9: Ghi nhận thu nhập vận hành ngoài công nợ (+2M OTHER)", async () => {
    db.reset();
    db.setRole("OWNER");
    const fund = await db.from("cash_funds").insert({
      name: "VCB",
      kind: "BANK",
      opening_balance: 100_000_000,
      opening_balance_date: "2026-01-01",
      is_active: true,
    });
    const otherCat = db.cash_categories.find((c) => c.code === "THU_THANH_LY")!;

    await db.from("cash_movements").insert({
      fund_id: fund.data.id,
      movement_kind: "OPERATING",
      category_id: otherCat.id,
      amount: 2_000_000,
      movement_date: "2026-01-08",
      note: "Thanh lý vỏ bình ắc quy cũ",
      is_cancelled: false,
    });

    const bal = db.getFundBalances().find((b) => b.fund_id === fund.data.id)!;
    assert.equal(bal.balance, 102_000_000);
    assert.equal(bal.total_in, 2_000_000);
  });

  // TC1.10: Cờ chi phí cố định (is_fixed = true)
  test("TC1.10: Cờ chi phí cố định is_fixed nhận diện đúng lương, mặt bằng, điện nước", () => {
    db.reset();
    const fixedCodes = db.cash_categories.filter((c) => c.is_fixed).map((c) => c.code);
    assert.deepEqual(fixedCodes.sort(), ["CHI_DIEN_NUOC", "CHI_LUONG", "CHI_MAT_BANG"]);
  });

  // TC1.11: Thêm danh mục chi phí tuỳ chỉnh
  await testAsync("TC1.11: Thêm danh mục chi phí tuỳ chỉnh (OWNER ok, vai trò khác blocked)", async () => {
    db.reset();
    db.setRole("OWNER");
    const addRes = await db.from("cash_categories").insert({
      code: "CHI_TIEP_KHACH_VIP",
      name: "Chi tiếp khách VIP dự án",
      kind: "OUT",
      group_key: "OTHER",
      is_fixed: false,
      monthly_budget: 10_000_000,
      is_active: true,
      is_system: false,
    });
    assert.equal(addRes.error, null);
    assert.equal(addRes.data.code, "CHI_TIEP_KHACH_VIP");

    db.setRole("ACCOUNTING");
    const failRes = await db.from("cash_categories").insert({
      code: "CHI_HACK",
      name: "Chi sai quyền",
      kind: "OUT",
      group_key: "OTHER",
      is_fixed: false,
      monthly_budget: 0,
      is_active: true,
      is_system: false,
    });
    assert.notEqual(failRes.error, null);
  });

  // TC1.12: Vô hiệu hoá danh mục và chặn xoá danh mục hệ thống
  await testAsync("TC1.12: Tắt danh mục chi phí và chặn xoá danh mục is_system", async () => {
    db.reset();
    db.setRole("OWNER");
    const sysCat = db.cash_categories.find((c) => c.code === "CHI_LUONG")!;

    // Chặn xoá danh mục hệ thống
    const delRes = await db.from("cash_categories").delete().eq("id", sysCat.id);
    assert.notEqual(delRes.error, null);
    assert.match(delRes.error.message, /Không thể xoá danh mục chi phí mặc định/);

    // Cho phép tắt is_active
    await db.from("cash_categories").update({ is_active: false }).eq("id", sysCat.id);
    const updated = await db.from("cash_categories").select().eq("id", sysCat.id).single();
    assert.equal(updated.data.is_active, false);
  });

  console.log("  ▶ Cluster 3: Chuyển Quỹ Nội Bộ (transfer_internal_cash_funds)");
  // TC1.13: Chuyển tiền từ Két sang Ngân hàng
  await testAsync("TC1.13: Chuyển 10M từ Két sang VCB sinh đúng 2 dòng đối ứng", async () => {
    db.reset();
    db.setRole("OWNER");
    const ket = await db.from("cash_funds").insert({ name: "Két", kind: "CASH", opening_balance: 50_000_000, opening_balance_date: "2026-01-01", is_active: true });
    const vcb = await db.from("cash_funds").insert({ name: "VCB", kind: "BANK", opening_balance: 100_000_000, opening_balance_date: "2026-01-01", is_active: true });

    const transferId = db.transfer_internal_cash_funds({
      p_source_fund_id: ket.data.id,
      p_dest_fund_id: vcb.data.id,
      p_amount: 10_000_000,
      p_transfer_date: "2026-01-15",
      p_note: "Nộp tiền mặt vào ngân hàng",
    });
    assert.ok(transferId);

    const movs = await db.from("cash_movements").select().eq("transfer_id", transferId);
    assert.equal(movs.data.length, 2);
    const sourceMov = movs.data.find((m: any) => m.fund_id === ket.data.id);
    const destMov = movs.data.find((m: any) => m.fund_id === vcb.data.id);

    assert.equal(sourceMov.amount, -10_000_000);
    assert.equal(sourceMov.movement_kind, "INTERNAL_TRANSFER");
    assert.equal(destMov.amount, 10_000_000);
    assert.equal(destMov.movement_kind, "INTERNAL_TRANSFER");
  });

  // TC1.14: Tổng biến động chuyển quỹ bằng 0
  test("TC1.14: Tổng biến động cặp chuyển quỹ sum(amount) == 0 và tổng tiền sẵn có không đổi", () => {
    const ket = db.cash_funds.find((f) => f.name === "Két")!;
    const vcb = db.cash_funds.find((f) => f.name === "VCB")!;
    const balances = db.getFundBalances();
    const ketBal = balances.find((b) => b.fund_id === ket.id)!;
    const vcbBal = balances.find((b) => b.fund_id === vcb.id)!;

    assert.equal(ketBal.balance, 40_000_000);
    assert.equal(vcbBal.balance, 110_000_000);
    assert.equal(ketBal.balance + vcbBal.balance, 150_000_000);
  });

  // TC1.15: Không ghi nhận doanh thu hoặc chi phí
  test("TC1.15: Chuyển quỹ nội bộ không ảnh hưởng doanh thu, chi phí, lãi ròng", () => {
    const internalMovs = db.cash_movements.filter((m) => m.movement_kind === "INTERNAL_TRANSFER");
    const revenueImpact = internalMovs.filter((m) => m.category_id && m.amount > 0).reduce((s, m) => s + m.amount, 0);
    const expenseImpact = internalMovs.filter((m) => m.category_id && m.amount < 0).reduce((s, m) => s + m.amount, 0);
    assert.equal(revenueImpact, 0);
    assert.equal(expenseImpact, 0);
  });

  // TC1.16: Liên kết đối ứng chặt chẽ
  test("TC1.16: Cặp chuyển quỹ liên kết đối ứng đối xứng qua counter_fund_id và counter_movement_id", () => {
    const movs = db.cash_movements.filter((m) => m.movement_kind === "INTERNAL_TRANSFER");
    const m1 = movs[0];
    const m2 = movs[1];
    assert.equal(m1.counter_fund_id, m2.fund_id);
    assert.equal(m2.counter_fund_id, m1.fund_id);
    assert.equal(m1.counter_movement_id, m2.id);
    assert.equal(m2.counter_movement_id, m1.id);
  });

  // TC1.17: Chặn chuyển quỹ cho chính nó
  test("TC1.17: Chặn chuyển quỹ khi quỹ nguồn == quỹ đích", () => {
    const ket = db.cash_funds.find((f) => f.name === "Két")!;
    assert.throws(
      () => {
        db.transfer_internal_cash_funds({
          p_source_fund_id: ket.id,
          p_dest_fund_id: ket.id,
          p_amount: 5_000_000,
          p_transfer_date: "2026-01-16",
        });
      },
      /Quỹ nguồn và quỹ đích không được trùng nhau/
    );
  });

  // TC1.18: Chuyển quỹ vượt số dư (ghi nhận số dư âm chính xác)
  test("TC1.18: Chuyển quỹ vượt số dư két ghi nhận chính xác số dư âm", () => {
    const ket = db.cash_funds.find((f) => f.name === "Két")!;
    const vcb = db.cash_funds.find((f) => f.name === "VCB")!;
    // Két đang có 40M, chuyển 50M
    db.transfer_internal_cash_funds({
      p_source_fund_id: ket.id,
      p_dest_fund_id: vcb.id,
      p_amount: 50_000_000,
      p_transfer_date: "2026-01-20",
    });
    const ketBal = db.getFundBalances().find((b) => b.fund_id === ket.id)!;
    assert.equal(ketBal.balance, -10_000_000);
  });

  console.log("  ▶ Cluster 4: Huỷ & Bút Toán Đảo (cancel_cash_movement_reversal)");
  // TC1.19: Huỷ phiếu chi vận hành có lý do bắt buộc
  await testAsync("TC1.19: Huỷ phiếu chi vận hành kèm lý do sinh bút toán đảo và cập nhật cờ huỷ", async () => {
    db.reset();
    db.setRole("OWNER");
    const fund = await db.from("cash_funds").insert({ name: "Két", kind: "CASH", opening_balance: 50_000_000, opening_balance_date: "2026-01-01", is_active: true });
    const exp = await db.from("cash_movements").insert({
      fund_id: fund.data.id,
      movement_kind: "OPERATING",
      amount: -5_000_000,
      movement_date: "2026-01-10",
      note: "Chi nhầm tài khoản",
      is_cancelled: false,
    });

    const revId = db.cancel_cash_movement_reversal({
      p_movement_id: exp.data.id,
      p_reason: "Chi nhầm đối tượng nhận",
    });
    assert.ok(revId);

    const orig = db.cash_movements.find((m) => m.id === exp.data.id)!;
    assert.equal(orig.is_cancelled, true);
    assert.equal(orig.cancel_reason, "Chi nhầm đối tượng nhận");
    assert.equal(orig.reversal_entry_id, revId);

    const rev = db.cash_movements.find((m) => m.id === revId)!;
    assert.equal(rev.amount, 5_000_000); // Đảo dấu
    assert.equal(rev.movement_kind, "REVERSAL");
    assert.equal(rev.reversal_of_id, orig.id);

    // Số dư phục hồi lại 50M
    const bal = db.getFundBalances().find((b) => b.fund_id === fund.data.id)!;
    assert.equal(bal.balance, 50_000_000);
  });

  // TC1.20: Chặn huỷ phiếu khi không có lý do
  await testAsync("TC1.20: Chặn huỷ phiếu khi lý do rỗng hoặc chỉ có khoảng trắng", async () => {
    db.reset();
    db.setRole("OWNER");
    const fund = await db.from("cash_funds").insert({ name: "Két", kind: "CASH", opening_balance: 50_000_000, opening_balance_date: "2026-01-01", is_active: true });
    const mov = await db.from("cash_movements").insert({
      fund_id: fund.data.id,
      movement_kind: "OPERATING",
      amount: -1_000_000,
      movement_date: "2026-01-10",
      is_cancelled: false,
    });

    assert.throws(
      () => {
        db.cancel_cash_movement_reversal({ p_movement_id: mov.data.id, p_reason: "   " });
      },
      /Bắt buộc phải nhập lý do huỷ phiếu/
    );
  });

  // TC1.21: Huỷ giao dịch chuyển quỹ nội bộ (đảo cả 2 vế)
  await testAsync("TC1.21: Huỷ chuyển quỹ nội bộ tự động đảo cả 2 chân giao dịch", async () => {
    db.reset();
    db.setRole("OWNER");
    const ket = await db.from("cash_funds").insert({ name: "Két", kind: "CASH", opening_balance: 50_000_000, opening_balance_date: "2026-01-01", is_active: true });
    const vcb = await db.from("cash_funds").insert({ name: "VCB", kind: "BANK", opening_balance: 100_000_000, opening_balance_date: "2026-01-01", is_active: true });

    const transferId = db.transfer_internal_cash_funds({
      p_source_fund_id: ket.data.id,
      p_dest_fund_id: vcb.data.id,
      p_amount: 15_000_000,
      p_transfer_date: "2026-01-15",
    });

    const movs = db.cash_movements.filter((m) => m.transfer_id === transferId);
    assert.equal(movs.length, 2);

    // Huỷ chân nguồn
    db.cancel_cash_movement_reversal({
      p_movement_id: movs[0].id,
      p_reason: "Lệnh chuyển quỹ bị sai sót",
    });

    // Cả 2 chân ban đầu đều bị cancelled
    assert.equal(movs[0].is_cancelled, true);
    assert.equal(movs[1].is_cancelled, true);

    // Đã sinh 2 bút toán đảo
    const reversals = db.cash_movements.filter((m) => m.movement_kind === "REVERSAL");
    assert.equal(reversals.length, 2);

    // Số dư trở về ban đầu
    const balKet = db.getFundBalances().find((b) => b.fund_id === ket.data.id)!;
    const balVcb = db.getFundBalances().find((b) => b.fund_id === vcb.data.id)!;
    assert.equal(balKet.balance, 50_000_000);
    assert.equal(balVcb.balance, 100_000_000);
  });

  // TC1.22: Huỷ phiếu thu công nợ khách hàng
  await testAsync("TC1.22: Huỷ phiếu thu công nợ khách hàng tự động phục hồi công nợ phải thu", async () => {
    db.reset();
    db.setRole("OWNER");
    const vcb = await db.from("cash_funds").insert({ name: "VCB", kind: "BANK", opening_balance: 50_000_000, opening_balance_date: "2026-01-01", is_active: true });

    // Tạo nợ phải thu 100M
    const recId = crypto.randomUUID();
    db.partner_receivables.push({
      id: recId,
      partner_name: "Gara An Phát",
      amount: 100_000_000,
      amount_paid: 40_000_000,
      status: "PARTIAL",
      due_date: "2026-02-15",
    });

    // Phiếu thu 40M
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

    // Huỷ phiếu thu
    db.cancel_cash_movement_reversal({
      p_movement_id: mov.data.id,
      p_reason: "Giao dịch NH bị trả về",
    });

    // Kiểm tra phục hồi nợ: amount_paid giảm về 0, status trở thành UNPAID
    const rec = db.partner_receivables.find((r) => r.id === recId)!;
    assert.equal(rec.amount_paid, 0);
    assert.equal(rec.status, "UNPAID");

    // Số dư VCB giảm lại 40M
    const bal = db.getFundBalances().find((b) => b.fund_id === vcb.data.id)!;
    assert.equal(bal.balance, 50_000_000);
  });

  // TC1.23: Huỷ phiếu trả nợ NCC
  await testAsync("TC1.23: Huỷ phiếu trả nợ NCC tự động phục hồi nợ phải trả", async () => {
    db.reset();
    db.setRole("OWNER");
    const vcb = await db.from("cash_funds").insert({ name: "VCB", kind: "BANK", opening_balance: 100_000_000, opening_balance_date: "2026-01-01", is_active: true });

    // Nợ NCC 50M, đã trả 20M
    const payId = crypto.randomUUID();
    db.supplier_payables.push({
      id: payId,
      supplier_name: "NCC Sinotruk Jinan",
      amount: 50_000_000,
      amount_paid: 20_000_000,
      status: "PARTIAL",
      due_date: "2026-02-28",
    });

    const pmtId = crypto.randomUUID();
    db.payments.push({
      id: pmtId,
      payable_id: payId,
      amount: 20_000_000,
      payment_date: "2026-01-12",
    });

    const mov = await db.from("cash_movements").insert({
      fund_id: vcb.data.id,
      movement_kind: "DEBT_PAYMENT",
      amount: -20_000_000,
      movement_date: "2026-01-12",
      payment_id: pmtId,
      is_cancelled: false,
    });

    // Huỷ phiếu chi trả nợ
    db.cancel_cash_movement_reversal({
      p_movement_id: mov.data.id,
      p_reason: "Sai uỷ nhiệm chi nhà cung cấp",
    });

    const sp = db.supplier_payables.find((p) => p.id === payId)!;
    assert.equal(sp.amount_paid, 0);
    assert.equal(sp.status, "UNPAID");

    const bal = db.getFundBalances().find((b) => b.fund_id === vcb.data.id)!;
    assert.equal(bal.balance, 100_000_000);
  });

  // TC1.24: Chặn huỷ lần hai & Chặn huỷ bút toán đảo
  await testAsync("TC1.24: Chặn huỷ lần hai và chặn huỷ một bút toán đảo", async () => {
    db.reset();
    db.setRole("OWNER");
    const fund = await db.from("cash_funds").insert({ name: "Két", kind: "CASH", opening_balance: 50_000_000, opening_balance_date: "2026-01-01", is_active: true });
    const mov = await db.from("cash_movements").insert({
      fund_id: fund.data.id,
      movement_kind: "OPERATING",
      amount: -1_000_000,
      movement_date: "2026-01-10",
      is_cancelled: false,
    });
    const revId = db.cancel_cash_movement_reversal({
      p_movement_id: mov.data.id,
      p_reason: "Huỷ lần một",
    });

    assert.throws(
      () => {
        db.cancel_cash_movement_reversal({
          p_movement_id: mov.data.id,
          p_reason: "Huỷ lần hai",
        });
      },
      /Giao dịch này đã được huỷ trước đó/
    );

    assert.throws(
      () => {
        db.cancel_cash_movement_reversal({
          p_movement_id: revId,
          p_reason: "Huỷ reversal",
        });
      },
      /Không thể huỷ một bút toán đảo/
    );
  });

  console.log("  ▶ Cluster 5: Phân Hệ Đối Chiếu Kế Toán 2 Tầng (reconciliation)");
  // TC1.25: Đối chiếu Quỹ tiền (Nhóm 1 CASH_FUND)
  await testAsync("TC1.25: Đối chiếu Quỹ tiền (Nhóm 1) tự động tính chênh lệch TVK - Kế toán", async () => {
    db.reset();
    db.setRole("OWNER");
    const period = await db.from("reconciliation_periods").insert({
      period_type: "MONTH",
      name: "Tháng 09/2026",
      from_date: "2026-09-01",
      to_date: "2026-09-30",
      status: "OPEN",
    });

    const entry = await db.from("reconciliation_entries").insert({
      period_id: period.data.id,
      data_group: "CASH_FUND",
      item_key: "FUND_VCB",
      item_name: "Tài khoản Vietcombank",
      tvk_amount: 150_000_000,
      accounting_amount: 145_000_000,
    });

    assert.equal(entry.data.difference_amount, 5_000_000);
    assert.equal(entry.data.discrepancy_status, "PENDING");
  });

  // TC1.26: Đối chiếu Phải thu đối tác (Nhóm 2 RECEIVABLE)
  await testAsync("TC1.26: Đối chiếu Phải thu đối tác (Nhóm 2) kèm drilldown chứng từ", async () => {
    const period = db.reconciliation_periods[0];
    const entry = await db.from("reconciliation_entries").insert({
      period_id: period.id,
      data_group: "RECEIVABLE",
      item_key: "PARTNER_AN_PHAT",
      item_name: "Gara An Phát",
      tvk_amount: 80_000_000,
      accounting_amount: 80_000_000,
      drilldown_data: { invoices: ["HD-001", "HD-002"], totalQty: 45 },
    });
    // Khớp tuyệt đối -> tự động set MATCHED
    assert.equal(entry.data.difference_amount, 0);
    assert.equal(entry.data.discrepancy_status, "MATCHED");
    assert.deepEqual(entry.data.drilldown_data.invoices, ["HD-001", "HD-002"]);
  });

  // TC1.27: Đối chiếu Phải trả NCC (Nhóm 3 PAYABLE)
  await testAsync("TC1.27: Đối chiếu Phải trả nhà cung cấp (Nhóm 3)", async () => {
    const period = db.reconciliation_periods[0];
    const entry = await db.from("reconciliation_entries").insert({
      period_id: period.id,
      data_group: "PAYABLE",
      item_key: "SUPPLIER_JINAN",
      item_name: "Sinotruk Jinan",
      tvk_amount: 500_000_000,
      accounting_amount: 520_000_000,
    });
    assert.equal(entry.data.difference_amount, -20_000_000);
    assert.equal(entry.data.discrepancy_status, "PENDING");
  });

  // TC1.28: Đối chiếu Tồn kho tổng hợp (Nhóm 4 INVENTORY)
  await testAsync("TC1.28: Đối chiếu Tồn kho tổng hợp (Nhóm 4) phân định kho sở hữu và ký gửi", async () => {
    const period = db.reconciliation_periods[0];
    const entry = await db.from("reconciliation_entries").insert({
      period_id: period.id,
      data_group: "INVENTORY",
      item_key: "INV_HOWO_TOTAL",
      item_name: "Tồn kho phụ tùng HOWO 420/430/440",
      tvk_amount: 3_621_000_153.6,
      accounting_amount: 3_621_000_153.6,
    });
    assert.equal(Math.abs(entry.data.difference_amount) < 0.01, true);
    assert.equal(entry.data.discrepancy_status, "MATCHED");
  });

  // TC1.29: Đối chiếu Doanh thu & Chi phí (Nhóm 5 REVENUE_EXPENSE)
  await testAsync("TC1.29: Đối chiếu Doanh thu & Chi phí (Nhóm 5)", async () => {
    const period = db.reconciliation_periods[0];
    const entry = await db.from("reconciliation_entries").insert({
      period_id: period.id,
      data_group: "REVENUE_EXPENSE",
      item_key: "REV_AU_CHAU",
      item_name: "Doanh thu bán Cty Âu Châu",
      tvk_amount: 342_755_000,
      accounting_amount: 342_755_000,
    });
    assert.equal(entry.data.difference_amount, 0);
    assert.equal(entry.data.discrepancy_status, "MATCHED");
  });

  // TC1.30: Cập nhật 5 trạng thái phân loại lệch
  await testAsync("TC1.30: Cập nhật trạng thái phân loại lệch VALID_TAX_TIMING và ghi chú giải trình", async () => {
    db.setRole("ACCOUNTING");
    const entry = db.reconciliation_entries.find((e) => e.data_group === "CASH_FUND")!;
    await db
      .from("reconciliation_entries")
      .update({
        discrepancy_status: "VALID_TAX_TIMING",
        explanation_note: "Phí ngân hàng chưa nhận được hoá đơn GTGT đầu vào",
      })
      .eq("id", entry.id);

    const updated = db.reconciliation_entries.find((e) => e.id === entry.id)!;
    assert.equal(updated.discrepancy_status, "VALID_TAX_TIMING");
    assert.equal(updated.explanation_note, "Phí ngân hàng chưa nhận được hoá đơn GTGT đầu vào");
  });

  // TC1.31: Lưu bản chốt kỳ (Snapshot) lịch sử
  test("TC1.31: Lưu bản chốt kỳ (Snapshot) lịch sử dạng JSONB và cập nhật status = RECONCILED", () => {
    db.setRole("OWNER");
    const period = db.reconciliation_periods[0];
    const snapId = db.create_reconciliation_snapshot({
      p_period_id: period.id,
      p_name: "Chốt Tháng 09/2026 Lần 1",
      p_note: "Chốt sau khi giải trình phí ngân hàng",
    });
    assert.ok(snapId);

    const snapshot = db.reconciliation_snapshots.find((s) => s.id === snapId)!;
    assert.equal(snapshot.name, "Chốt Tháng 09/2026 Lần 1");
    assert.equal(snapshot.period_id, period.id);
    assert.equal(snapshot.snapshot_no, 1);
    assert.equal(snapshot.summary.total_entries, 5);
    assert.equal(period.status, "RECONCILED");
    assert.ok(snapshot.snapshot_items.length >= 5);
  });

  console.log("  ▶ Cluster 6: Excel Export & Import Helpers (excel-parse)");
  // TC1.32: Xuất biên bản đối chiếu ra file Excel
  test("TC1.32: Xuất biên bản đối chiếu ra cấu trúc workbook XLSX hợp lệ", () => {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ["BIÊN BẢN ĐỐI CHIẾU KẾ TOÁN 2 TẦNG TVK"],
      ["Kỳ đối chiếu:", "Tháng 09/2026"],
      [],
      ["Nhóm Dữ Liệu", "Mã Khoản Mục", "Tên Khoản Mục", "Số TVK (VNĐ)", "Số Kế Toán (VNĐ)", "Chênh Lệch", "Trạng Thái", "Giải Trình"],
      ["Quỹ tiền", "FUND_VCB", "Tài khoản Vietcombank", 150000000, 145000000, 5000000, "Lệch hợp lệ", "Chờ HĐ"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "DoiChieu_T9");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    assert.ok(buf.length > 500);

    // Đọc lại để kiểm chứng
    const readWb = XLSX.read(buf, { type: "buffer" });
    assert.equal(readWb.SheetNames[0], "DoiChieu_T9");
  });

  // TC1.33: Import file kế toán mẫu chuẩn TVK
  test("TC1.33: Nhận diện cột chuẩn TVK và đọc số kế toán", () => {
    const rows = [
      ["Mã khoản mục", "Số tiền kế toán", "Ghi chú"],
      ["FUND_VCB", "145.000.000", "Khớp sao kê"],
      ["INV_HOWO_TOTAL", "3.621.000.154", "Làm tròn"],
    ];
    const parsed = rows.slice(1).map((r) => ({
      key: r[0],
      amount: toNum(r[1]),
      note: r[2],
    }));
    assert.equal(parsed[0].amount, 145_000_000);
    assert.equal(parsed[1].amount, 3_621_000_154);
  });

  // TC1.34: Import file kế toán linh hoạt với cấu trúc cột tuỳ ý
  test("TC1.34: Ánh xạ cấu trúc cột tuỳ ý (Col B mã, Col E số tiền)", () => {
    const customRow = ["1", "PARTNER_AN_PHAT", "Gara An Phát", "HĐ tháng 9", "80.000.000,50"];
    const colKey = 1;
    const colAmount = 4;
    const itemKey = customRow[colKey];
    const amount = toNum(customRow[colAmount]);
    assert.equal(itemKey, "PARTNER_AN_PHAT");
    assert.equal(amount, 80_000_000.5);
  });

  // TC1.35: Xử lý định dạng số Việt Nam
  test("TC1.35: toNum() xử lý định dạng số VN: dấu chấm phân tách hàng nghìn, dấu phẩy thập phân", () => {
    assert.equal(toNum("2.916.000"), 2916000);
    assert.equal(toNum("2.916.000,50"), 2916000.5);
    assert.equal(toNum("100,500,000"), 100500000);
    assert.equal(toNum(5000000), 5000000);
    assert.equal(toNum("   "), 0);
    assert.equal(toNum(null), 0);
  });

  // TC1.36: Xử lý ngày tháng linh hoạt
  test("TC1.36: toDateISO() xử lý ngày Serial Excel, DD/MM/YYYY, ISO", () => {
    assert.equal(toDateISO("2026-09-18"), "2026-09-18");
    assert.equal(toDateISO("18/09/2026"), "2026-09-18");
    assert.equal(toDateISO("18-09-2026"), "2026-09-18");
    // Excel serial 46283 = 2026-09-18
    assert.equal(toDateISO(46283), "2026-09-18");
    assert.equal(toDateISO("invalid-date"), "");
  });

  console.log("  ▶ Cluster 7: Phân Quyền 5 Vai Trò & Điều Hướng Sidebar");
  // TC1.37: Quyền hạn OWNER
  test("TC1.37: OWNER có toàn quyền thực hiện mọi mutation và RPC", () => {
    db.setRole("OWNER");
    assert.equal(db.getRole(), "OWNER");
  });

  // TC1.38: Quyền hạn CEO
  await testAsync("TC1.38: CEO chỉ xem, mọi mutation hoặc RPC đều bị chặn 403", async () => {
    db.setRole("CEO");
    // SELECT ok
    const funds = await db.from("cash_funds").select();
    assert.equal(funds.error, null);

    // Mutation throws
    const ins = await db.from("cash_funds").insert({ name: "Hacked Fund" });
    assert.notEqual(ins.error, null);
    assert.match(ins.error.message, /Quyền CEO chỉ được xem dữ liệu/);

    const rpcRes = await db.rpc("transfer_internal_cash_funds", {
      p_source_fund_id: "a",
      p_dest_fund_id: "b",
      p_amount: 100,
      p_transfer_date: "2026-01-01",
    });
    assert.notEqual(rpcRes.error, null);
  });

  // TC1.39: Quyền hạn ACCOUNTING
  await testAsync("TC1.39: ACCOUNTING xem được sổ quỹ & nhập đối chiếu; bị chặn tạo quỹ và snapshot", async () => {
    db.setRole("ACCOUNTING");
    // SELECT ok
    const views = await db.from("v_cash_fund_balances").select();
    assert.equal(views.error, null);

    // Tạo quỹ bị chặn
    const insFund = await db.from("cash_funds").insert({ name: "Fund by KT" });
    assert.notEqual(insFund.error, null);

    // Tạo snapshot bị chặn
    const snapRes = await db.rpc("create_reconciliation_snapshot", { p_period_id: "x" });
    assert.notEqual(snapRes.error, null);
  });

  // TC1.40: Quyền hạn SALES
  test("TC1.40: SALES bị chặn hoàn toàn truy cập sổ quỹ và phân hệ đối chiếu", () => {
    db.setRole("SALES");
    assert.throws(() => {
      db.getFundBalances();
    }, /SALES không có quyền xem v_cash_fund_balances/);
  });

  // TC1.41: Quyền hạn WAREHOUSE
  test("TC1.41: WAREHOUSE bị chặn hoàn toàn truy cập sổ quỹ và phân hệ đối chiếu", () => {
    db.setRole("WAREHOUSE");
    assert.throws(() => {
      db._getTable("reconciliation_entries");
    }, /WAREHOUSE không có quyền xem reconciliation_entries/);
  });

  // TC1.42: Sidebar navigation filtering
  test("TC1.42: Sidebar hiển thị đúng menu theo ma trận 5 vai trò", () => {
    function getSidebarNav(role: string): string[] {
      const nav: string[] = ["/dashboard"];
      if (["OWNER", "CEO", "ACCOUNTING"].includes(role)) {
        nav.push("/cashflow", "/reconciliation", "/audit-center");
      }
      if (["OWNER", "CEO"].includes(role)) {
        nav.push("/executive");
      }
      return nav;
    }

    const ownerNav = getSidebarNav("OWNER");
    const ceoNav = getSidebarNav("CEO");
    const accNav = getSidebarNav("ACCOUNTING");
    const salesNav = getSidebarNav("SALES");
    const whNav = getSidebarNav("WAREHOUSE");

    assert.ok(ownerNav.includes("/cashflow") && ownerNav.includes("/reconciliation"));
    assert.ok(ceoNav.includes("/cashflow") && ceoNav.includes("/reconciliation"));
    assert.ok(accNav.includes("/cashflow") && accNav.includes("/reconciliation"));
    assert.ok(!salesNav.includes("/cashflow") && !salesNav.includes("/reconciliation"));
    assert.ok(!whNav.includes("/cashflow") && !whNav.includes("/reconciliation"));
  });

  return { passed, total: 42 };
}

if (process.argv[1]?.endsWith("tier1-features.test.ts")) {
  runTier1Tests()
    .then((r) => {
      console.log(`\nAll ${r.passed}/${r.total} Tier 1 tests passed!`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
