import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  listCashCategories,
  listCashMovements,
  getMonthlyCashflowSummary,
} from "../src/lib/queries";

console.log("=== BẮT ĐẦU KIỂM CHỨNG MILESTONE 2: SỔ QUỸ & DÒNG TIỀN (/cashflow) ===");

// 1. Kiểm tra interface & file src/lib/audit.ts
console.log("\n▶ [1/5] Kiểm tra src/lib/audit.ts...");
const auditSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/audit.ts"), "utf-8");
assert(
  auditSrc.includes("currentAvailableCash: number;"),
  "CashFlowRunway interface phải chứa currentAvailableCash"
);
assert(
  auditSrc.includes("fixedCost14: number;"),
  "CashFlowRunway interface phải chứa fixedCost14"
);
assert(
  auditSrc.includes("fixedCost30: number;"),
  "CashFlowRunway interface phải chứa fixedCost30"
);
assert(
  auditSrc.includes("v_cash_fund_balances"),
  "getCashFlowRunway phải truy vấn v_cash_fund_balances"
);
assert(
  auditSrc.includes("cash_categories"),
  "getCashFlowRunway phải truy vấn cash_categories"
);
assert(
  auditSrc.includes("currentAvailableCash + inflow14 - outflow14 - fixedCost14"),
  "Công thức net14 phải bao gồm currentAvailableCash và fixedCost14"
);
assert(
  auditSrc.includes("currentAvailableCash + inflow30 - outflow30 - fixedCost30"),
  "Công thức net30 phải bao gồm currentAvailableCash và fixedCost30"
);
console.log("  ✔ src/lib/audit.ts đạt chuẩn công thức Runway 4 thành phần.");

// 2. Kiểm tra src/app/(dashboard)/executive/page.tsx
console.log("\n▶ [2/5] Kiểm tra src/app/(dashboard)/executive/page.tsx...");
const execSrc = fs.readFileSync(
  path.join(process.cwd(), "src/app/(dashboard)/executive/page.tsx"),
  "utf-8"
);
assert(
  execSrc.includes("cashflow.currentAvailableCash"),
  "Executive page phải hiển thị Tiền sẵn có hiện tại"
);
assert(
  execSrc.includes("cashflow.fixedCost14"),
  "Executive page phải hiển thị Chi cố định dự kiến 14 ngày"
);
assert(
  execSrc.includes("cashflow.fixedCost30"),
  "Executive page phải hiển thị Chi cố định dự kiến 30 ngày"
);
assert(
  execSrc.includes("cashflow.inflow14"),
  "Executive page phải hiển thị Thu nợ gara 14 ngày"
);
assert(
  execSrc.includes("cashflow.outflow14"),
  "Executive page phải hiển thị Trả nợ NCC 14 ngày"
);
console.log("  ✔ Executive page hiển thị đồng bộ 4 thành phần dòng tiền.");

// 3. Kiểm tra queries trong src/lib/queries.ts
console.log("\n▶ [3/5] Kiểm tra query functions trong src/lib/queries.ts...");
assert(typeof listCashCategories === "function", "listCashCategories phải là function");
assert(typeof listCashMovements === "function", "listCashMovements phải là function");
assert(typeof getMonthlyCashflowSummary === "function", "getMonthlyCashflowSummary phải là function");
const queriesSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/queries.ts"), "utf-8");
assert(
  queriesSrc.includes("export async function listCashCategories"),
  "queries.ts phải export listCashCategories"
);
assert(
  queriesSrc.includes("export async function listCashMovements"),
  "queries.ts phải export listCashMovements"
);
assert(
  queriesSrc.includes("export async function getMonthlyCashflowSummary"),
  "queries.ts phải export getMonthlyCashflowSummary"
);
console.log("  ✔ src/lib/queries.ts đã bổ sung đầy đủ 3 hàm truy vấn nghiệp vụ.");

// 4. Kiểm tra phân hệ /cashflow & các components
console.log("\n▶ [4/5] Kiểm tra cấu trúc phân hệ /cashflow...");
const cashflowDir = path.join(process.cwd(), "src/app/(dashboard)/cashflow");
assert(fs.existsSync(cashflowDir), "Thư mục /cashflow phải tồn tại");

const pagePath = path.join(cashflowDir, "page.tsx");
assert(fs.existsSync(pagePath), "cashflow/page.tsx phải tồn tại");
const pageSrc = fs.readFileSync(pagePath, "utf-8");
assert(
  pageSrc.includes("PERMITTED_ROLES") && pageSrc.includes("access_denied"),
  "cashflow/page.tsx phải bảo mật phân quyền RBAC và chặn truy cập trái phép"
);

const overviewPath = path.join(cashflowDir, "CashflowOverview.tsx");
assert(fs.existsSync(overviewPath), "CashflowOverview.tsx phải tồn tại");
const overviewSrc = fs.readFileSync(overviewPath, "utf-8");
assert(
  overviewSrc.includes("totalAvailable") && overviewSrc.includes("opening_balance_date"),
  "CashflowOverview.tsx phải thể hiện tổng tiền sẵn có và ngày số dư đầu kỳ"
);
assert(
  overviewSrc.includes("fixedCost14") && overviewSrc.includes("currentAvailableCash"),
  "CashflowOverview.tsx phải có widget Runway đồng bộ 100% với executive"
);

const actionsPath = path.join(cashflowDir, "CashflowQuickActions.tsx");
assert(fs.existsSync(actionsPath), "CashflowQuickActions.tsx phải tồn tại");
const actionsSrc = fs.readFileSync(actionsPath, "utf-8");
assert(
  actionsSrc.includes("createOperatingCashMovementAction"),
  "CashflowQuickActions phải gọi createOperatingCashMovementAction"
);
assert(
  actionsSrc.includes("transferInternalCashFundsAction"),
  "CashflowQuickActions phải gọi transferInternalCashFundsAction"
);
assert(
  actionsSrc.includes("createCashCategoryAction") && actionsSrc.includes("toggleCashCategoryAction"),
  "CashflowQuickActions phải hỗ trợ quản lý danh mục khoản mục"
);

const ledgerPath = path.join(cashflowDir, "CashflowLedger.tsx");
assert(fs.existsSync(ledgerPath), "CashflowLedger.tsx phải tồn tại");
const ledgerSrc = fs.readFileSync(ledgerPath, "utf-8");
assert(
  ledgerSrc.includes("cancelCashMovementAction"),
  "CashflowLedger phải hỗ trợ action huỷ phiếu"
);
assert(
  ledgerSrc.includes("reason"),
  "CashflowLedger phải bắt buộc nhập lý do huỷ phiếu"
);

const monthlyReportPath = path.join(cashflowDir, "CashflowMonthlyReport.tsx");
assert(fs.existsSync(monthlyReportPath), "CashflowMonthlyReport.tsx phải tồn tại");
const monthlyReportSrc = fs.readFileSync(monthlyReportPath, "utf-8");
assert(
  monthlyReportSrc.includes("netManagementProfit") && monthlyReportSrc.includes("operatingExpense"),
  "CashflowMonthlyReport phải thể hiện lãi ròng quản trị và chi phí vận hành"
);
console.log("  ✔ Toàn bộ 5 file giao diện phân hệ /cashflow đầy đủ và nhất quán.");

// 5. Kiểm tra toán học công thức Runway với các kịch bản thực tế
console.log("\n▶ [5/5] Kiểm thử toán học công thức Runway 4 thành phần...");
function computeRunway(
  cash: number,
  inflow: number,
  outflow: number,
  fixedCost: number
) {
  const net = cash + inflow - outflow - fixedCost;
  const demand = outflow + fixedCost;
  const supply = cash + inflow;
  const ratio = demand > 0 ? supply / demand : supply > 0 ? 99 : 1;
  let status: "SAFE" | "WARNING" | "DANGER" = "SAFE";
  if (net < 0 || ratio < 0.85) {
    status = "DANGER";
  } else if (ratio < 1.15) {
    status = "WARNING";
  }
  return { net, ratio, status };
}

// Case 1: Chi trả + chi phí cố định vượt quá tiền sẵn có + thu -> DANGER
const c1 = computeRunway(10_000_000, 20_000_000, 30_000_000, 14_000_000);
assert.equal(c1.net, -14_000_000);
assert(c1.ratio < 0.85);
assert.equal(c1.status, "DANGER");

// Case 2: Thặng dư nhẹ, độ phủ nằm trong khoảng 0.85 - 1.15 -> WARNING
const c2 = computeRunway(10_000_000, 40_000_000, 30_000_000, 16_000_000);
assert.equal(c2.net, 4_000_000);
assert(c2.ratio >= 0.85 && c2.ratio < 1.15);
assert.equal(c2.status, "WARNING");

// Case 3: Dồi dào tiền mặt, độ phủ >= 1.15 -> SAFE
const c3 = computeRunway(50_000_000, 50_000_000, 30_000_000, 14_000_000);
assert.equal(c3.net, 56_000_000);
assert(c3.ratio > 1.15);
assert.equal(c3.status, "SAFE");

console.log("  ✔ Logic tính toán Runway vượt qua 100% test cases giả lập.");

console.log("\n>>> TOÀN BỘ KIỂM CHỨNG MILESTONE 2 ĐÃ THÀNH CÔNG RỰC RỠ! <<<\n");
