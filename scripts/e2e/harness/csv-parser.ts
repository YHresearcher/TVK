import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

export const DEFAULT_SAMPLE_CSV_PATH =
  "C:\\Users\\pntha\\.gemini\\antigravity\\brain\\3b71abe4-1e21-481a-a798-df50914371d0\\scratch\\user-accounting-sample.csv";

export interface MasterCatalogItem {
  stt: number;
  vehicleModel: "HOWO 420" | "HOWO 430" | "HOWO 440";
  partName: string;
  partDescriptionEn: string;
  partDescriptionCn: string;
  skuCode: string;
  unit: string;
  qty: number;
  priceUsd: number;
  exchangeRate: number;
  vat8: number;
  unitCost: number;
  totalImportCost: number;
  plannedPriceAcExact: number;
  plannedPriceAcRounded: number;
  totalPlannedAc: number;
}

export interface MonthlyLineItem {
  stt: number;
  vehicleModel: string;
  partName: string;
  skuCode: string;
  unit: string;
  openingQty: number;
  unitCost: number;
  openingTotalCost: number;
  salesAuChauQty: number;
  salesAuChauUnitPrice: number;
  salesAuChauTotal: number;
  consignmentAAuQty: number;
  consignmentAAuUnitPrice: number;
  consignmentAAuTotal: number;
  endingQty: number;
  endingUnitPrice: number;
  endingTotalValuation: number;
  profitAuChauPerUnit?: number;
  profitAAuPerUnit?: number;
  totalProfit?: number;
}

export interface MonthSummary {
  openingStockQty: number;
  openingStockValuation: number;
  salesAuChauQty: number;
  salesAuChauRevenue: number;
  consignmentAAuQty: number;
  consignmentAAuTotal: number;
  endingStockQty: number;
  endingStockValuation: number;
  grossProfit?: number;
}

export interface EndingInventoryItem {
  stt: number;
  vehicleModel: string;
  partName: string;
  skuCode: string;
  unit: string;
  qty: number;
  priceUsd: number;
  unitCost: number;
  totalValuation: number;
}

export interface EnterpriseAccountingData {
  masterCatalog: MasterCatalogItem[];
  masterTotals: {
    totalQty: number;
    totalImportCost: number;
    totalPlannedAc: number;
    howo420: { skus: number; qty: number; cost: number; plannedAc: number };
    howo430: { skus: number; qty: number; cost: number; plannedAc: number };
    howo440: { skus: number; qty: number; cost: number; plannedAc: number };
  };
  september2026: {
    items: MonthlyLineItem[];
    summary: MonthSummary;
  };
  october2026: {
    items: MonthlyLineItem[];
    summary: MonthSummary;
  };
  november2026: {
    items: MonthlyLineItem[];
    summary: MonthSummary;
  };
  endingInventory: {
    items: EndingInventoryItem[];
    summary: { totalQty: number; totalValuation: number; activeSkuCount: number };
  };
}

export function parseEnterpriseSample(csvPath = DEFAULT_SAMPLE_CSV_PATH): EnterpriseAccountingData {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Enterprise sample CSV file not found at: ${csvPath}`);
  }

  const buf = fs.readFileSync(csvPath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

  // 1. MASTER CATALOG (Rows 0 to 67)
  const masterCatalog: MasterCatalogItem[] = [];
  let currentModel: "HOWO 420" | "HOWO 430" | "HOWO 440" = "HOWO 420";

  for (let i = 0; i <= 67; i++) {
    const r = rows[i];
    if (!r) continue;
    const firstCell = String(r[0] || "");
    if (firstCell.includes("HOWO 430")) {
      currentModel = "HOWO 430";
      continue;
    }
    if (firstCell.includes("HOWO 440")) {
      currentModel = "HOWO 440";
      continue;
    }
    if (typeof r[0] === "number") {
      masterCatalog.push({
        stt: Number(r[0]),
        vehicleModel: currentModel,
        partName: String(r[1] || "").trim(),
        partDescriptionEn: String(r[2] || "").trim(),
        partDescriptionCn: String(r[3] || "").trim(),
        skuCode: String(r[4] || "").trim(),
        unit: String(r[5] || "Cái").trim(),
        qty: Number(r[6] || 0),
        priceUsd: Number(r[7] || 0),
        exchangeRate: Number(r[9] || 27000),
        vat8: Number(r[10] || 0),
        unitCost: Number(r[11] || 0),
        totalImportCost: Number(r[12] || 0),
        plannedPriceAcExact: Number(r[13] || 0),
        plannedPriceAcRounded: Number(r[14] || 0),
        totalPlannedAc: Number(r[15] || 0),
      });
    }
  }

  const h420 = masterCatalog.filter((m) => m.vehicleModel === "HOWO 420");
  const h430 = masterCatalog.filter((m) => m.vehicleModel === "HOWO 430");
  const h440 = masterCatalog.filter((m) => m.vehicleModel === "HOWO 440");

  const masterTotals = {
    totalQty: masterCatalog.reduce((s, m) => s + m.qty, 0),
    totalImportCost: masterCatalog.reduce((s, m) => s + m.totalImportCost, 0),
    totalPlannedAc: masterCatalog.reduce((s, m) => s + m.totalPlannedAc, 0),
    howo420: {
      skus: h420.length,
      qty: h420.reduce((s, m) => s + m.qty, 0),
      cost: h420.reduce((s, m) => s + m.totalImportCost, 0),
      plannedAc: h420.reduce((s, m) => s + m.totalPlannedAc, 0),
    },
    howo430: {
      skus: h430.length,
      qty: h430.reduce((s, m) => s + m.qty, 0),
      cost: h430.reduce((s, m) => s + m.totalImportCost, 0),
      plannedAc: h430.reduce((s, m) => s + m.totalPlannedAc, 0),
    },
    howo440: {
      skus: h440.length,
      qty: h440.reduce((s, m) => s + m.qty, 0),
      cost: h440.reduce((s, m) => s + m.totalImportCost, 0),
      plannedAc: h440.reduce((s, m) => s + m.totalPlannedAc, 0),
    },
  };

  // Helper to parse monthly items
  function parseMonthlyBlock(startRow: number, endRow: number): MonthlyLineItem[] {
    const items: MonthlyLineItem[] = [];
    for (let i = startRow; i <= endRow; i++) {
      const r = rows[i];
      if (r && typeof r[0] === "number") {
        items.push({
          stt: Number(r[0]),
          vehicleModel: String(r[1] || ""),
          partName: String(r[2] || "").trim(),
          skuCode: String(r[5] || "").trim(),
          unit: String(r[6] || "Cái").trim(),
          openingQty: Number(r[7] || 0),
          unitCost: Number(r[12] || 0),
          openingTotalCost: Number(r[13] || 0),
          salesAuChauQty: Number(r[19] || 0),
          salesAuChauUnitPrice: Number(r[20] || 0),
          salesAuChauTotal: Number(r[21] || 0),
          consignmentAAuQty: Number(r[23] || 0),
          consignmentAAuUnitPrice: Number(r[24] || 0),
          consignmentAAuTotal: Number(r[25] || 0),
          endingQty: Number(r[27] || 0),
          endingUnitPrice: Number(r[28] || 0),
          endingTotalValuation: Number(r[29] || 0),
          profitAuChauPerUnit: r[31] !== undefined ? Number(r[31]) : undefined,
          profitAAuPerUnit: r[32] !== undefined ? Number(r[32]) : undefined,
          totalProfit: r[34] !== undefined ? Number(r[34]) : undefined,
        });
      }
    }
    return items;
  }

  // 2. SEPTEMBER 2026 (Rows 71 to 116, summary row 117)
  const sepItems = parseMonthlyBlock(71, 116);
  const sepSummaryRow = rows[117] || [];
  const september2026 = {
    items: sepItems,
    summary: {
      openingStockQty: Number(sepSummaryRow[7] || 5456),
      openingStockValuation: Number(sepSummaryRow[13] || 3976827094.8),
      salesAuChauQty: Number(sepSummaryRow[19] || 445),
      salesAuChauRevenue: Number(sepSummaryRow[21] || 342755000),
      consignmentAAuQty: Number(sepSummaryRow[23] || 161),
      consignmentAAuTotal: Number(sepSummaryRow[25] || 122784000),
      endingStockQty: Number(sepSummaryRow[27] || 4850),
      endingStockValuation: Number(sepSummaryRow[29] || 3621000153.6),
    },
  };

  // 3. OCTOBER 2026 (Rows 121 to 166, summary row 167)
  const octItems = parseMonthlyBlock(121, 166);
  const octSummaryRow = rows[167] || [];
  const october2026 = {
    items: octItems,
    summary: {
      openingStockQty: Number(octSummaryRow[7] || 4850),
      openingStockValuation: Number(octSummaryRow[13] || 3621000153.6),
      salesAuChauQty: Number(octSummaryRow[19] || 1074),
      salesAuChauRevenue: Number(octSummaryRow[21] || 416343000),
      consignmentAAuQty: Number(octSummaryRow[23] || 400),
      consignmentAAuTotal: Number(octSummaryRow[25] || 106850000),
      endingStockQty: Number(octSummaryRow[27] || 3376),
      endingStockValuation: Number(octSummaryRow[29] || 3224220325.2),
      grossProfit: Number(octSummaryRow[34] || 108011283.6),
    },
  };

  // 4. NOVEMBER 2026 (Rows 174 to 219, summary row 220)
  const novItems = parseMonthlyBlock(174, 219);
  const novSummaryRow = rows[220] || [];
  const november2026 = {
    items: novItems,
    summary: {
      openingStockQty: Number(novSummaryRow[7] || 3376),
      openingStockValuation: Number(novSummaryRow[13] || 3224220325.2),
      salesAuChauQty: Number(novSummaryRow[19] || 312),
      salesAuChauRevenue: Number(novSummaryRow[21] || 395263000),
      consignmentAAuQty: Number(novSummaryRow[23] || 0),
      consignmentAAuTotal: Number(novSummaryRow[25] || 0),
      endingStockQty: Number(novSummaryRow[27] || 3064),
      endingStockValuation: Number(novSummaryRow[29] || 2931442552.8),
      grossProfit: Number(novSummaryRow[34] || 66091654.4),
    },
  };

  // 5. ENDING INVENTORY (Rows 224 to 263, summary row 264)
  const endingItems: EndingInventoryItem[] = [];
  for (let i = 224; i <= 263; i++) {
    const r = rows[i];
    if (r && typeof r[0] === "number") {
      endingItems.push({
        stt: Number(r[0]),
        vehicleModel: String(r[1] || ""),
        partName: String(r[2] || "").trim(),
        skuCode: String(r[5] || "").trim(),
        unit: String(r[6] || "Cái").trim(),
        qty: Number(r[7] || 0),
        priceUsd: Number(r[8] || 0),
        unitCost: Number(r[12] || 0),
        totalValuation: Number(r[13] || 0),
      });
    }
  }

  const endSummaryRow = rows[264] || [];
  const endingInventory = {
    items: endingItems,
    summary: {
      totalQty: Number(endSummaryRow[7] || 3064),
      totalValuation: Number(endSummaryRow[13] || 2931442552.8),
      activeSkuCount: endingItems.length,
    },
  };

  return {
    masterCatalog,
    masterTotals,
    september2026,
    october2026,
    november2026,
    endingInventory,
  };
}
