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
  getReversalLog,
  isReversiblePayment,
  paymentReversalLabel,
  reversalReasonFromNote,
} from "../../src/lib/payment-allocations";
import type { PaymentWithAllocations } from "../../src/lib/payment-allocations";
import {
  allocateDiscount,
  groupUninvoicedLinesByLine,
  splitVat,
  sumVatSplits,
} from "../../src/lib/vat";

/**
 * TIER 5 — TVK V2.0 P2 + P3 + P4: tách ngành hàng + phân bổ / đảo thanh
 * toán + VAT tách ngành.
 * Chỉ kiểm tra các hàm thuần (không chạm DB thật, không chạm Supabase):
 *  - splitByBusinessLine: tách checkout / file import theo ngành.
 *  - isOilLineCode / isExpiredBatch: phân loại FEFO theo ngành chuẩn.
 *  - compareLotOrder: thứ tự FEFO (dầu) / FIFO (phụ tùng).
 *  - buildAllocationSummary / isReversiblePayment / paymentReversalLabel:
 *    gom phân bổ theo ngành + điều kiện đảo phiếu (P3, BL-021).
 *  - allocateDiscount / splitVat / sumVatSplits /
 *    groupUninvoicedLinesByLine: chia giảm giá + tách VAT 8% + nhóm
 *    dòng chưa ghi hoá đơn theo ngành (P4).
 *  - reversalReasonFromNote / getReversalLog: tách lý do đảo + nhật ký
 *    đảo bút toán cho OWNER/Kế toán xem (P4, quyết chủ 23/11 21:48).
 * Ràng buộc DB (trigger, view, RLS) được kiểm chứng riêng bằng file
 * docs/tests/p2_operational_local.sql (P2),
 * docs/tests/p3_payment_allocations_local.sql (P3, BL-021/022/023) và
 * docs/tests/p4_finance_vat_local.sql (P4, VAT/BL-015/REV)
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

  // ---- P4 (VAT tách ngành, §13): chia giảm giá + tách VAT 8%. ----
  test("P4: allocateDiscount chia giảm giá theo tỉ lệ (300.000/200.000, giảm 50.000)", () => {
    const shares = allocateDiscount(
      [
        { id: "l1", lineTotal: 300000 },
        { id: "l2", lineTotal: 200000 },
      ],
      50000,
    );
    assert.equal(shares.get("l1"), 30000);
    assert.equal(shares.get("l2"), 20000);
    assert.equal(shares.get("l1")! + shares.get("l2")!, 50000);
  });

  test("P4: allocateDiscount — phần dư do làm tròn dồn về dòng lớn nhất (3 dòng bằng nhau, giảm 1đ)", () => {
    const shares = allocateDiscount(
      [
        { id: "l1", lineTotal: 100 },
        { id: "l2", lineTotal: 100 },
        { id: "l3", lineTotal: 100 },
      ],
      1,
    );
    // Mỗi dòng floor(1/3) = 0,33; dòng lớn nhất (hoà -> id nhỏ nhất) nhận phần dư 0,34.
    assert.equal(shares.get("l1"), 0.34);
    assert.equal(shares.get("l2"), 0.33);
    assert.equal(shares.get("l3"), 0.33);
    assert.equal(shares.get("l1")! + shares.get("l2")! + shares.get("l3")!, 1);
  });

  test("P4: allocateDiscount — không giảm giá thì mọi dòng 0", () => {
    const shares = allocateDiscount([{ id: "l1", lineTotal: 300000 }], 0);
    assert.equal(shares.get("l1"), 0);
  });

  test("P4: splitVat tách 8% đúng — 270.000 gồm VAT -> trước thuế 250.000, VAT 20.000", () => {
    const s = splitVat(270000, 0);
    assert.equal(s.including, 270000);
    assert.equal(s.beforeTax, 250000);
    assert.equal(s.vat, 20000);
  });

  test("P4: splitVat trừ phần giảm giá trước khi tách — 300.000 - 30.000 = 270.000", () => {
    const s = splitVat(300000, 30000);
    assert.equal(s.including, 270000);
    assert.equal(s.beforeTax, 250000);
    assert.equal(s.vat, 20000);
  });

  test("P4: splitVat làm tròn về đồng — 100.000 -> 92.592,59 + 7.407,41", () => {
    const s = splitVat(100000, 0);
    assert.equal(s.beforeTax, 92592.59);
    assert.equal(s.vat, 7407.41);
    assert.equal(s.beforeTax + s.vat, 100000);
  });

  test("P4: splitVat ném lỗi khi giảm giá chia xuống vượt tiền hàng", () => {
    assert.throws(() => splitVat(100000, 100001), /vượt tiền hàng/);
  });

  test("P4: sumVatSplits cộng header đúng (BH-VAT-0001: 450.000 = 416.666,67 + 33.333,33)", () => {
    const totals = sumVatSplits([splitVat(300000, 30000), splitVat(200000, 20000)]);
    assert.equal(totals.totalBeforeTax, 416666.67);
    assert.equal(totals.totalVat, 33333.33);
    assert.equal(totals.totalAmount, 450000);
  });

  test("P4: groupUninvoicedLinesByLine nhóm theo ngành, dòng chưa phân loại gom riêng", () => {
    const groups = groupUninvoicedLinesByLine([
      { id: "a1", business_line_id: "line-part" },
      { id: "a2", business_line_id: null },
      { id: "a3", business_line_id: "line-oil" },
      { id: "a4", business_line_id: "line-part" },
    ]);
    assert.equal(groups.length, 3);
    assert.equal(groups.find((g) => g.lineId === "line-part")?.lines.length, 2);
    assert.equal(groups.find((g) => g.lineId === "line-oil")?.lines.length, 1);
    const uncl = groups.find((g) => g.lineId === null);
    assert.equal(uncl?.lines.length, 1);
    assert.equal(uncl?.lines[0].id, "a2");
  });

  // ---- P4 (nhật ký đảo, quyết chủ 23/11 21:48): lý do + log đảo. ----
  test("P4: reversalReasonFromNote tách lý do khỏi ghi chú phiếu đảo (định dạng 0029)", () => {
    assert.equal(
      reversalReasonFromNote("Đảo của PT-2610-0001: Ghi nhầm số tiền"),
      "Ghi nhầm số tiền",
    );
    // Lý do chứa dấu ":" vẫn tách đúng (chỉ cắt ở ": " đầu tiên sau mã phiếu).
    assert.equal(
      reversalReasonFromNote("Đảo của PT-2610-0001: Kiểm chứng REV-01: OWNER đảo"),
      "Kiểm chứng REV-01: OWNER đảo",
    );
  });

  test("P4: reversalReasonFromNote hiểu cả định dạng cũ 0027, trả rỗng khi không theo mẫu", () => {
    assert.equal(
      reversalReasonFromNote("Đảo bút toán PT-2610-0001 (Lý do: Trùng phiếu)"),
      "Trùng phiếu",
    );
    assert.equal(reversalReasonFromNote("Thu tiền đối tác"), "");
    assert.equal(reversalReasonFromNote(null), "");
    assert.equal(reversalReasonFromNote(undefined), "");
  });

  test("P4: getReversalLog chỉ lấy phiếu đảo, kèm phiếu gốc + lý do + người đảo, mới nhất trước", () => {
    const mk = (o: Partial<PaymentWithAllocations>): PaymentWithAllocations =>
      ({
        id: "",
        doc_code: "",
        payment_kind: "IN",
        payment_date: "2026-09-09",
        amount: 0,
        method: "BANK",
        fund_id: null,
        note: null,
        settlement_id: null,
        payable_id: null,
        receivable_id: null,
        reversal_of_id: null,
        created_at: "",
        created_by: null,
        createdByName: null,
        obligationLabel: "",
        allocations: [],
        allocationSummary: [],
        reversedByDocCode: null,
        ...o,
      }) as PaymentWithAllocations;
    const log = getReversalLog([
      mk({ id: "p1", doc_code: "PT-0001", amount: 450000, created_at: "2026-09-09T01:00:00Z" }),
      mk({
        id: "r1",
        doc_code: "PT-0002",
        reversal_of_id: "p1",
        amount: 450000,
        note: "Đảo của PT-0001: Ghi nhầm số tiền",
        createdByName: "Thanh Phan",
        created_at: "2026-09-09T02:00:00Z",
      }),
      mk({
        id: "r2",
        doc_code: "PT-0003",
        reversal_of_id: "p1",
        amount: 100000,
        note: "Đảo bút toán PT-0001 (Lý do: Trùng phiếu)",
        createdByName: "Kế toán",
        created_at: "2026-09-09T03:00:00Z",
      }),
    ]);
    assert.equal(log.length, 2);
    assert.equal(log[0].reversalCode, "PT-0003"); // mới nhất trước
    assert.equal(log[0].originalCode, "PT-0001");
    assert.equal(log[0].reason, "Trùng phiếu");
    assert.equal(log[0].createdByName, "Kế toán");
    assert.equal(log[1].reversalCode, "PT-0002");
    assert.equal(log[1].reason, "Ghi nhầm số tiền");
    assert.equal(log[1].createdByName, "Thanh Phan");
  });

  return { passed, total };
}
