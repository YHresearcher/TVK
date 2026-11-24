import assert from "node:assert/strict";
import {
  parseEnterpriseSample,
  resolveSampleCsvPath,
  sampleCsvExists,
} from "./harness/csv-parser";

export interface Tier4Result {
  passed: number;
  total: number;
  skipped?: boolean;
  skipReason?: string;
}

export async function runTier4Tests(): Promise<Tier4Result> {
  let passed = 0;
  console.log("  ▶ Tier 4: Real Enterprise Sample Data (376-row HOWO dataset replay)");

  const samplePath = resolveSampleCsvPath();
  if (!sampleCsvExists(samplePath)) {
    // File mẫu là dữ liệu kế toán thật của cửa hàng, KHÔNG có trong repo.
    // Không bịa dữ liệu, không fail cả suite — SKIP Tier 4 và báo rõ cách chạy lại.
    const skipReason =
      `Enterprise sample CSV not found at: ${samplePath}. ` +
      `Set TVK_E2E_SAMPLE_CSV to the full file path, or TVK_E2E_FIXTURES_DIR to the ` +
      `folder containing user-accounting-sample.csv, then re-run npm run test:e2e.`;
    console.log(`    ⊘ SKIPPED — ${skipReason}`);
    return { passed: 0, total: 0, skipped: true, skipReason };
  }

  const data = parseEnterpriseSample(samplePath);

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

  // Scenario 1: Master Catalog Import & Valuation (Lines 1-94)
  test("Scenario 1: HOWO Parts Master Catalog (46 SKUs, 5,456 units, 3,976,827,094.8 VNĐ, +35% AC planned 5,369,292,000 VNĐ)", () => {
    assert.equal(data.masterCatalog.length, 46);
    assert.equal(data.masterTotals.howo420.skus, 19);
    assert.equal(data.masterTotals.howo430.skus, 12);
    assert.equal(data.masterTotals.howo440.skus, 15);

    // Kiểm tra tổng số lượng nhập
    assert.equal(data.masterTotals.howo420.qty, 1158);
    assert.equal(data.masterTotals.howo430.qty, 2510);
    assert.equal(data.masterTotals.howo440.qty, 1788);
    assert.equal(data.masterTotals.totalQty, 5456);

    // Kiểm tra tổng giá trị vốn nhập (3.976.827.094,8 VNĐ)
    assert.ok(Math.abs(data.masterTotals.totalImportCost - 3976827094.8) < 1e-4);

    // Kiểm tra giá bán kế hoạch Cty Âu Châu (+35% markup: 5.369.292.000 VNĐ)
    assert.equal(data.masterTotals.totalPlannedAc, 5369292000);

    // Kiểm tra công thức VAT 8% và tỷ giá 27,000 cho từng SKU
    for (const item of data.masterCatalog) {
      const expectedUnitBeforeVat = item.priceUsd * 27000;
      const expectedVat = expectedUnitBeforeVat * 0.08;
      const expectedUnitCost = expectedUnitBeforeVat + expectedVat;
      assert.ok(Math.abs(item.vat8 - expectedVat) < 1e-4, `VAT 8% mismatch on SKU ${item.skuCode}`);
      assert.ok(Math.abs(item.unitCost - expectedUnitCost) < 1e-4, `Unit cost mismatch on SKU ${item.skuCode}`);
      // Markup 35%
      const expectedAcExact = expectedUnitCost * 1.35;
      assert.ok(Math.abs(item.plannedPriceAcExact - expectedAcExact) < 1e-4, `AC markup mismatch on SKU ${item.skuCode}`);
    }
  });

  // Scenario 2: September 2026 Direct Sales & Consignment (Lines 95-168)
  test("Scenario 2: Tháng 09/2026: Bán Âu Châu 445 cái (342.755M), Ký gửi Á Âu 161 cái (122.784M), Tồn cuối 4,850 cái (3,621,000,153.6 VNĐ), chênh lệch = 0", () => {
    const sep = data.september2026.summary;
    assert.equal(sep.openingStockQty, 5456);
    assert.ok(Math.abs(sep.openingStockValuation - 3976827094.8) < 1e-4);

    assert.equal(sep.salesAuChauQty, 445);
    assert.equal(sep.salesAuChauRevenue, 342755000);

    assert.equal(sep.consignmentAAuQty, 161);
    assert.equal(sep.consignmentAAuTotal, 122784000);

    // Khẳng định bất biến số học: Đầu kỳ (5456) - Bán Âu Châu (445) - Gửi Á Âu (161) = 4850
    const calculatedEndingQty = sep.openingStockQty - sep.salesAuChauQty - sep.consignmentAAuQty;
    assert.equal(calculatedEndingQty, 4850);
    assert.equal(sep.endingStockQty, 4850);

    // Giá trị tồn cuối
    assert.ok(Math.abs(sep.endingStockValuation - 3621000153.6) < 1e-4);

    // Khẳng định chênh lệch từng dòng bằng 0
    let lineSumQty = 0;
    let lineSumVal = 0;
    for (const item of data.september2026.items) {
      const calcEnd = item.openingQty - item.salesAuChauQty - item.consignmentAAuQty;
      assert.equal(calcEnd, item.endingQty, `Quantity mismatch in Sep on SKU ${item.skuCode}`);
      lineSumQty += item.endingQty;
      lineSumVal += item.endingTotalValuation;
    }
    assert.equal(lineSumQty, 4850);
    assert.ok(Math.abs(lineSumVal - 3621000153.6) < 1e-4);
  });

  // Scenario 3: October 2026 Dual-Channel Revenue & Profit (Lines 169-243)
  test("Scenario 3: Tháng 10/2026: Bán Âu Châu 1,074 cái (416.343M), Á Âu 400 cái (106.850M), Lãi gộp 108,011,283.6 VNĐ, Tồn cuối 3,376 cái (3,224,220,325.2 VNĐ)", () => {
    const oct = data.october2026.summary;
    // Đầu kỳ Tháng 10 = Cuối kỳ Tháng 9
    assert.equal(oct.openingStockQty, 4850);
    assert.ok(Math.abs(oct.openingStockValuation - 3621000153.6) < 1e-4);

    assert.equal(oct.salesAuChauQty, 1074);
    assert.equal(oct.salesAuChauRevenue, 416343000);

    assert.equal(oct.consignmentAAuQty, 400);
    assert.equal(oct.consignmentAAuTotal, 106850000);

    // Khẳng định bất biến: 4850 - 1074 - 400 = 3376
    const calculatedEndingQty = oct.openingStockQty - oct.salesAuChauQty - oct.consignmentAAuQty;
    assert.equal(calculatedEndingQty, 3376);
    assert.equal(oct.endingStockQty, 3376);

    assert.ok(Math.abs(oct.endingStockValuation - 3224220325.2) < 1e-4);

    // Lợi nhuận gộp quản trị: 108,011,283.6 VNĐ
    assert.ok(oct.grossProfit !== undefined);
    assert.ok(Math.abs(oct.grossProfit! - 108011283.6) < 1e-4);

    // Khẳng định chênh lệch từng dòng bằng 0
    let lineSumQty = 0;
    let lineSumVal = 0;
    for (const item of data.october2026.items) {
      const calcEnd = item.openingQty - item.salesAuChauQty - item.consignmentAAuQty;
      assert.equal(calcEnd, item.endingQty, `Quantity mismatch in Oct on SKU ${item.skuCode}`);
      lineSumQty += item.endingQty;
      lineSumVal += item.endingTotalValuation;
    }
    assert.equal(lineSumQty, 3376);
    assert.ok(Math.abs(lineSumVal - 3224220325.2) < 1e-4);
  });

  // Scenario 4: November 2026 Stable Run & Residual Inventory (Lines 246-319)
  test("Scenario 4: Tháng 11/2026: Bán Âu Châu 312 cái (395.263M), Á Âu 0 cái, Lãi gộp 66,091,654.4 VNĐ, Tồn cuối 3,064 cái (2,931,442,552.8 VNĐ)", () => {
    const nov = data.november2026.summary;
    // Đầu kỳ Tháng 11 = Cuối kỳ Tháng 10
    assert.equal(nov.openingStockQty, 3376);
    assert.ok(Math.abs(nov.openingStockValuation - 3224220325.2) < 1e-4);

    assert.equal(nov.salesAuChauQty, 312);
    assert.equal(nov.salesAuChauRevenue, 395263000);

    assert.equal(nov.consignmentAAuQty, 0);
    assert.equal(nov.consignmentAAuTotal, 0);

    // Khẳng định bất biến: 3376 - 312 = 3064
    const calculatedEndingQty = nov.openingStockQty - nov.salesAuChauQty - nov.consignmentAAuQty;
    assert.equal(calculatedEndingQty, 3064);
    assert.equal(nov.endingStockQty, 3064);

    assert.ok(Math.abs(nov.endingStockValuation - 2931442552.8) < 1e-4);

    // Lợi nhuận gộp quản trị: 66,091,654.4 VNĐ
    assert.ok(nov.grossProfit !== undefined);
    assert.ok(Math.abs(nov.grossProfit! - 66091654.4) < 1e-4);

    // Khẳng định chênh lệch từng dòng bằng 0
    let lineSumQty = 0;
    let lineSumVal = 0;
    for (const item of data.november2026.items) {
      const calcEnd = item.openingQty - item.salesAuChauQty - item.consignmentAAuQty;
      assert.equal(calcEnd, item.endingQty, `Quantity mismatch in Nov on SKU ${item.skuCode}`);
      lineSumQty += item.endingQty;
      lineSumVal += item.endingTotalValuation;
    }
    assert.equal(lineSumQty, 3064);
    assert.ok(Math.abs(lineSumVal - 2931442552.8) < 1e-4);
  });

  // Scenario 5: 3-Month Reconciliation & VAT Difference Analysis (Lines 320-376)
  test("Scenario 5: Bảng kê tồn kho chi tiết 40 mã phụ tùng khớp 100% với 3,064 cái và 2,931,442,552.8 VNĐ; đối chiếu 2 tầng doanh thu & ký gửi", () => {
    const end = data.endingInventory;
    assert.equal(end.summary.activeSkuCount, 40);
    assert.equal(end.summary.totalQty, 3064);
    assert.ok(Math.abs(end.summary.totalValuation - 2931442552.8) < 1e-4);

    // Đối chiếu 100% số lượng và giá trị giữa bảng kê tồn kho chuyển tiếp (Phần 5) và Tồn cuối Tháng 11 (Phần 4)
    assert.equal(end.summary.totalQty, data.november2026.summary.endingStockQty);
    assert.ok(Math.abs(end.summary.totalValuation - data.november2026.summary.endingStockValuation) < 1e-4);

    // Đối chiếu doanh thu 3 tháng:
    // Tổng doanh thu xuất bán Cty Âu Châu (đã xuất HĐ):
    const totalSalesAuChauRevenue =
      data.september2026.summary.salesAuChauRevenue +
      data.october2026.summary.salesAuChauRevenue +
      data.november2026.summary.salesAuChauRevenue;
    assert.equal(totalSalesAuChauRevenue, 342755000 + 416343000 + 395263000); // 1,154,361,000 VNĐ

    // Tổng giá trị hàng điều chuyển ký gửi đại lý Cty Á Âu:
    const totalConsignmentAAu =
      data.september2026.summary.consignmentAAuTotal +
      data.october2026.summary.consignmentAAuTotal +
      data.november2026.summary.consignmentAAuTotal;
    assert.equal(totalConsignmentAAu, 122784000 + 106850000 + 0); // 229,634,000 VNĐ

    // Tổng luân chuyển hàng hoá TVK 3 tháng:
    const totalDispatchedValue = totalSalesAuChauRevenue + totalConsignmentAAu;
    assert.equal(totalDispatchedValue, 1383995000);

    // Chênh lệch hai tầng kế toán: Phân định rạch ròi 1,154,361,000đ (doanh thu ghi nhận thuế) vs 229,634,000đ (ký gửi chờ tiêu thụ)
    assert.ok(totalSalesAuChauRevenue > 0);
    assert.ok(totalConsignmentAAu > 0);
  });

  return { passed, total: 5 };
}

if (process.argv[1]?.endsWith("tier4-real-sample.test.ts")) {
  runTier4Tests()
    .then((r) => {
      if (r.skipped) {
        console.log(`\nTier 4 SKIPPED: ${r.skipReason}`);
      } else {
        console.log(`\nAll ${r.passed}/${r.total} Tier 4 tests passed!`);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
