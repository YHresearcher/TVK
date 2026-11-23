import assert from "node:assert/strict";
import {
  compareLotOrder,
  isExpiredBatch,
  isOilLineCode,
  splitByBusinessLine,
} from "../../src/lib/product-match";
import {
  allocationLineLabel,
  buildAllocationSummary,
  isReversiblePayment,
  paymentReversalLabel,
} from "../../src/lib/payment-allocations";

/**
 * TIER 5 — TVK V2.0 P2 + P3: tách ngành hàng + phân bổ / đảo thanh toán.
 * Chỉ kiểm tra các hàm thuần (không chạm DB thật, không chạm Supabase):
 *  - splitByBusinessLine: tách checkout / file import theo ngành.
 *  - isOilLineCode / isExpiredBatch: phân loại FEFO theo ngành chuẩn.
 *  - compareLotOrder: thứ tự FEFO (dầu) / FIFO (phụ tùng).
 *  - buildAllocationSummary / isReversiblePayment / paymentReversalLabel:
 *    gom phân bổ theo ngành + điều kiện đảo phiếu (P3, BL-021).
 * Ràng buộc DB (trigger, view, RLS) được kiểm chứng riêng bằng file
 * docs/tests/p2_operational_local.sql (P2) và
 * docs/tests/p3_payment_allocations_local.sql (P3, BL-021/022/023)
 * trên PostgreSQL scratch.
 */
export async function runTier5Tests(): Promise<{ passed: number; total: number }> {
  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void) {
    total++;
    try {
      fn();
      passed++;
      console.log(`    ✔ ${name}`);
    } catch (err: any) {
      console.error(`    ❌ ${name}: ${err.message}`);
      throw err;
    }
  }

  // BL-003: checkout chung tách thành chứng từ riêng theo ngành.
  test("BL-003: splitByBusinessLine tách dòng bán chung thành 2 nhóm ngành", () => {
    const lines = [
      { product_id: "p-oil", qty: 2 },
      { product_id: "p-part", qty: 5 },
      { product_id: "p-oil-2", qty: 1 },
    ];
    const lineOf = new Map([
      ["p-oil", "line-oil"],
      ["p-oil-2", "line-oil"],
      ["p-part", "line-part"],
    ]);
    const groups = splitByBusinessLine(lines, (l) => lineOf.get(l.product_id) ?? null);
    assert.equal(groups.size, 2);
    assert.equal(groups.get("line-oil")?.length, 2);
    assert.equal(groups.get("line-part")?.length, 1);
  });

  // BL-004: tối đa 4 chứng từ (2 ngành × BH/KG) — nhóm theo (tính chất, ngành).
  test("BL-004: nhóm theo (tính chất, ngành) cho tối đa 4 chứng từ", () => {
    const lines = [
      { kind: "BH", line: "line-oil" },
      { kind: "KG", line: "line-oil" },
      { kind: "BH", line: "line-part" },
      { kind: "KG", line: "line-part" },
      { kind: "BH", line: "line-oil" },
    ];
    const groups = splitByBusinessLine(lines, (l) => l.line);
    // Nhóm theo ngành trước (2 nhóm), rồi tách BH/KG trong từng nhóm
    // ở tầng action — ở đây kiểm tra nhóm ngành không gộp lẫn nhau.
    assert.equal(groups.size, 2);
    assert.equal(groups.get("line-oil")?.length, 3);
    assert.equal(groups.get("line-part")?.length, 2);
    const kinds = new Set(groups.get("line-oil")?.map((l) => l.kind));
    assert.deepEqual(Array.from(kinds).sort(), ["BH", "KG"]);
  });

  // BL-005: FEFO cho dầu — hạn gần nhất trước.
  test("BL-005: compareLotOrder FEFO — lô dầu hạn gần nhất xếp trước", () => {
    const a = { received_date: "2026-01-10", expiry_date: "2027-06-01", batch_code: "OIL-A" };
    const b = { received_date: "2026-01-05", expiry_date: "2027-03-01", batch_code: "OIL-B" };
    const c = { received_date: "2026-01-01", expiry_date: "2027-12-01", batch_code: "OIL-C" };
    const sorted = [a, b, c].sort((x, y) => compareLotOrder(x, y, true));
    assert.deepEqual(sorted.map((l) => l.batch_code), ["OIL-B", "OIL-A", "OIL-C"]);
  });

  // BL-006: lô dầu hết hạn thì không được bán.
  test("BL-006: isExpiredBatch chặn lô dầu hết hạn theo ngày bán", () => {
    assert.equal(isExpiredBatch("2026-10-04", "2026-10-05"), true);
    assert.equal(isExpiredBatch("2026-10-05", "2026-10-05"), false);
    assert.equal(isExpiredBatch("2026-10-06", "2026-10-05"), false);
    // Không có hạn dùng thì không coi là hết hạn (lô phụ tùng / lô dầu cũ).
    assert.equal(isExpiredBatch(null, "2026-10-05"), false);
    assert.equal(isExpiredBatch(undefined, "2026-10-05"), false);
    assert.equal(isExpiredBatch("", "2026-10-05"), false);
  });

  // BL-007: lô dầu không hạn dùng xếp sau lô có hạn (FEFO), rồi mới FIFO.
  test("BL-007: compareLotOrder FEFO — lô dầu không hạn xếp sau lô có hạn", () => {
    const dated = { received_date: "2026-01-10", expiry_date: "2027-06-01", batch_code: "OIL-DATED" };
    const undated = { received_date: "2026-01-01", expiry_date: null, batch_code: "OIL-NODATE" };
    const sorted = [undated, dated].sort((x, y) => compareLotOrder(x, y, true));
    assert.deepEqual(sorted.map((l) => l.batch_code), ["OIL-DATED", "OIL-NODATE"]);
  });

  // BL-008: FIFO cho phụ tùng — nhập trước xuất trước.
  test("BL-008: compareLotOrder FIFO — lô phụ tùng nhập trước xếp trước", () => {
    const a = { received_date: "2026-02-01", expiry_date: "2027-01-01", batch_code: "PART-NEW" };
    const b = { received_date: "2026-01-01", expiry_date: null, batch_code: "PART-OLD" };
    const sorted = [a, b].sort((x, y) => compareLotOrder(x, y, false));
    assert.deepEqual(sorted.map((l) => l.batch_code), ["PART-OLD", "PART-NEW"]);
  });

  // Phân loại FEFO theo ngành chuẩn (business_line_code), không theo tên nhóm.
  test("BL-005/008: isOilLineCode chỉ đúng với OIL, không theo tên nhóm hàng", () => {
    assert.equal(isOilLineCode("OIL"), true);
    assert.equal(isOilLineCode("AUTO_PARTS"), false);
    assert.equal(isOilLineCode(null), false);
    assert.equal(isOilLineCode(undefined), false);
    assert.equal(isOilLineCode(""), false);
  });

  // Dòng chưa phân loại gom dưới khoá "" — tầng gọi phải từ chối rõ ràng,
  // không được lặng lẽ bỏ dòng.
  test("BL-003: splitByBusinessLine gom dòng chưa phân loại dưới khoá rỗng", () => {
    const lines = [
      { product_id: "p-known", qty: 1 },
      { product_id: "p-unknown", qty: 2 },
    ];
    const groups = splitByBusinessLine(lines, (l) =>
      l.product_id === "p-known" ? "line-part" : null,
    );
    assert.equal(groups.size, 2);
    assert.equal(groups.get("")?.length, 1);
    assert.equal(groups.get("")?.[0].product_id, "p-unknown");
  });

  // ---- P3 (BL-021): hàm thuần cho lịch sử phân bổ + đảo phiếu. ----
  test("P3: buildAllocationSummary gom phân bổ theo ngành, cộng tiền từng ngành", () => {
    const summary = buildAllocationSummary([
      { business_line_code: "OIL", amount: 100000 },
      { business_line_code: "AUTO_PARTS", amount: 50000 },
      { business_line_code: "OIL", amount: -100000 },
      { business_line_code: null, amount: 7000 },
    ]);
    assert.equal(summary.length, 3);
    assert.equal(summary.find((s) => s.lineCode === "OIL")?.amount, 0);
    assert.equal(summary.find((s) => s.lineCode === "AUTO_PARTS")?.amount, 50000);
    assert.equal(summary.find((s) => s.lineCode === null)?.lineLabel, "Chưa phân loại");
    assert.equal(summary.find((s) => s.lineCode === "OIL")?.lineLabel, "Dầu nhớt");
    assert.equal(summary.find((s) => s.lineCode === "AUTO_PARTS")?.lineLabel, "Phụ tùng");
  });

  test("P3: allocationLineLabel đúng nhãn Dầu nhớt / Phụ tùng / Chưa phân loại", () => {
    assert.equal(allocationLineLabel("OIL"), "Dầu nhớt");
    assert.equal(allocationLineLabel("AUTO_PARTS"), "Phụ tùng");
    assert.equal(allocationLineLabel(null), "Chưa phân loại");
    assert.equal(allocationLineLabel(undefined), "Chưa phân loại");
    assert.equal(allocationLineLabel("KHAC"), "Chưa phân loại");
  });

  test("P3 (BL-021): isReversiblePayment — phiếu thường đảo được, phiếu đảo và phiếu đã đảo thì không", () => {
    const all = [
      { id: "p1", reversal_of_id: null },
      { id: "p2", reversal_of_id: null },
      { id: "r1", reversal_of_id: "p1" },
    ];
    assert.equal(isReversiblePayment(all[0], all), false); // p1 đã bị đảo bởi r1
    assert.equal(isReversiblePayment(all[1], all), true); // p2 chưa bị đảo
    assert.equal(isReversiblePayment(all[2], all), false); // r1 là phiếu đảo
  });

  test("P3 (BL-021): paymentReversalLabel — Bút toán đảo / Đã đảo (mã phiếu đảo) / rỗng", () => {
    assert.equal(paymentReversalLabel({ reversal_of_id: "p1" }, null), "Bút toán đảo");
    assert.equal(paymentReversalLabel({ reversal_of_id: null }, "PC-2611-0001"), "Đã đảo (PC-2611-0001)");
    assert.equal(paymentReversalLabel({ reversal_of_id: null }, null), "");
  });

  return { passed, total };
}
