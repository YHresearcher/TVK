/**
 * scripts/verify-m1.ts
 * Milestone 1 Verification Suite: Schema, Migrations, Types & Server Actions Security
 */

import * as fs from "fs";
import * as path from "path";

// Test 1: Verify 0023_management_accounting.sql
function verifyMigrationSQL() {
  console.log("=== Checking supabase/migrations/0023_management_accounting.sql ===");
  const migrationPath = path.resolve(process.cwd(), "supabase/migrations/0023_management_accounting.sql");
  if (!fs.existsSync(migrationPath)) {
    throw new Error("Migration file 0023_management_accounting.sql does not exist!");
  }
  const content = fs.readFileSync(migrationPath, "utf-8");

  const expectedPatterns = [
    "opening_balance_date date NOT NULL DEFAULT '2026-01-01'",
    "CREATE TABLE IF NOT EXISTS public.cash_categories",
    "CHECK (kind IN ('IN', 'OUT'))",
    "CHECK (group_key IN ('SALARY', 'RENT', 'TRANSPORT', 'TAX', 'OTHER'))",
    "is_fixed",
    "monthly_budget",
    "THU_LAI",
    "CHI_LUONG",
    "CHI_MAT_BANG",
    "CHI_VAN_CHUYEN",
    "CHI_THUE_PHI",
    "ALTER TABLE public.cash_movements",
    "CHECK (movement_kind IN ('DEBT_PAYMENT', 'OPERATING', 'INTERNAL_TRANSFER', 'REVERSAL'))",
    "transfer_id uuid",
    "counter_fund_id uuid",
    "counter_movement_id uuid",
    "is_cancelled boolean",
    "cancel_reason text",
    "CREATE OR REPLACE VIEW public.v_cash_fund_balances",
    "CREATE OR REPLACE FUNCTION public.transfer_internal_cash_funds",
    "CREATE OR REPLACE FUNCTION public.cancel_cash_movement_reversal",
    "CREATE TABLE IF NOT EXISTS public.reconciliation_periods",
    "CREATE TABLE IF NOT EXISTS public.reconciliation_entries",
    "CREATE TRIGGER trg_reconciliation_entries_diff",
    "CREATE TABLE IF NOT EXISTS public.reconciliation_snapshots",
    "CREATE OR REPLACE FUNCTION public.create_reconciliation_snapshot",
    "current_app_role() = 'OWNER'",
    "current_app_role() = ANY (ARRAY['OWNER','ACCOUNTING','CEO']::app_role[])",
    "GROUP BY data_group",
  ];

  for (const pat of expectedPatterns) {
    if (!content.includes(pat)) {
      throw new Error(`Migration SQL missing expected pattern: ${pat}`);
    }
  }

  // Verify trigger reverts MATCHED back to PENDING when difference is non-zero
  if (!content.includes("new.discrepancy_status = 'MATCHED'") || !content.includes("new.discrepancy_status := 'PENDING'")) {
    throw new Error("Trigger calc_reconciliation_difference does not properly revert MATCHED to PENDING on difference divergence!");
  }

  // Verify create_reconciliation_snapshot does not use nested aggregates
  if (content.includes("jsonb_object_agg(data_group, jsonb_build_object('tvk', sum(tvk_amount)")) {
    throw new Error("create_reconciliation_snapshot contains illegal PostgreSQL nested aggregate call!");
  }

  // Count seeded categories (should be 12)
  const categoryCodes = [
    "THU_LAI", "THU_THANH_LY", "THU_HOAN_UNG", "THU_KHAC",
    "CHI_LUONG", "CHI_MAT_BANG", "CHI_VAN_CHUYEN", "CHI_THUE_PHI",
    "CHI_DIEN_NUOC", "CHI_SUA_CHUA", "CHI_TIEP_KHACH", "CHI_KHAC"
  ];
  for (const code of categoryCodes) {
    if (!content.includes(`'${code}'`)) {
      throw new Error(`Seeded category ${code} missing in migration SQL!`);
    }
  }
  console.log("✓ Migration SQL contains all required tables, triggers, views, RPCs, seed data, and RLS policies.");
}

// Test 2: Verify TypeScript Types in src/types/index.ts
function verifyTypes() {
  console.log("=== Checking src/types/index.ts & src/lib/types.ts ===");
  const typesPath = path.resolve(process.cwd(), "src/types/index.ts");
  if (!fs.existsSync(typesPath)) {
    throw new Error("src/types/index.ts does not exist!");
  }
  const content = fs.readFileSync(typesPath, "utf-8");

  const requiredTypes = [
    "CashFund",
    "CashFundBalance",
    "CategoryGroupKey",
    "CashCategory",
    "CashMovementKind",
    "CashMovement",
    "ReconciliationPeriod",
    "ReconciliationDataGroup",
    "DiscrepancyStatus",
    "ReconciliationEntry",
    "ReconciliationSnapshot",
    "CashFlowRunwayForecast",
  ];

  for (const t of requiredTypes) {
    if (!content.includes(t)) {
      throw new Error(`src/types/index.ts missing type: ${t}`);
    }
  }

  // Check re-export in src/lib/types.ts
  const libTypesPath = path.resolve(process.cwd(), "src/lib/types.ts");
  const libTypesContent = fs.readFileSync(libTypesPath, "utf-8");
  if (!libTypesContent.includes('@/types"')) {
    throw new Error("src/lib/types.ts does not re-export from @/types");
  }

  console.log("✓ TypeScript types verified in src/types/index.ts and re-exported in src/lib/types.ts.");
}

// Test 3: Verify Server Actions in src/lib/actions.ts
async function verifyActions() {
  console.log("=== Checking src/lib/actions.ts ===");
  const actionsPath = path.resolve(process.cwd(), "src/lib/actions.ts");
  const content = fs.readFileSync(actionsPath, "utf-8");

  const requiredActions = [
    "createCashFundAction",
    "updateCashFundAction",
    "createCashCategoryAction",
    "updateCashCategoryAction",
    "toggleCashCategoryAction",
    "createOperatingCashMovementAction",
    "transferInternalCashFundsAction",
    "cancelCashMovementAction",
    "createReconciliationPeriodAction",
    "updateReconciliationEntryAction",
    "createReconciliationSnapshotAction",
  ];

  for (const act of requiredActions) {
    if (!content.includes(`export async function ${act}`)) {
      throw new Error(`src/lib/actions.ts missing action: ${act}`);
    }
  }

  // Verify role protections
  const roleChecks = [
    { action: "createCashFundAction", roles: '["OWNER"]' },
    { action: "updateCashFundAction", roles: '["OWNER"]' },
    { action: "createCashCategoryAction", roles: '["OWNER"]' },
    { action: "updateCashCategoryAction", roles: '["OWNER"]' },
    { action: "toggleCashCategoryAction", roles: '["OWNER"]' },
    { action: "createOperatingCashMovementAction", roles: '["OWNER"]' },
    { action: "transferInternalCashFundsAction", roles: '["OWNER"]' },
    { action: "cancelCashMovementAction", roles: '["OWNER"]' },
    { action: "createReconciliationPeriodAction", roles: '["OWNER"]' },
    { action: "updateReconciliationEntryAction", roles: '["OWNER", "ACCOUNTING"]' },
    { action: "createReconciliationSnapshotAction", roles: '["OWNER"]' },
  ];

  for (const rc of roleChecks) {
    const fnStart = content.indexOf(`export async function ${rc.action}`);
    if (fnStart === -1) throw new Error(`Could not find ${rc.action}`);
    const fnSnippet = content.substring(fnStart, fnStart + 400).replace(/\s+/g, " ").replace(/\(\s+/g, "(");
    const expectedCall = `requireRole(${rc.roles}`.replace(/\s+/g, " ").replace(/\(\s+/g, "(");
    if (!fnSnippet.includes(expectedCall)) {
      throw new Error(`Action ${rc.action} does not enforce expected roles ${rc.roles}. Got: ${fnSnippet.substring(0, 150)}`);
    }
  }

  // Verify fund.is_active check in createOperatingCashMovementAction
  const opMoveStart = content.indexOf("export async function createOperatingCashMovementAction");
  const opMoveSnippet = content.substring(opMoveStart, opMoveStart + 1200);
  if (!opMoveSnippet.includes("!fund.is_active") || !opMoveSnippet.includes("Quỹ tiền đã chọn đang tắt")) {
    throw new Error("createOperatingCashMovementAction does not check if fund is active!");
  }

  console.log("✓ Server actions, fund status validation, and strict role-based access control verified.");
}

async function main() {
  try {
    verifyMigrationSQL();
    verifyTypes();
    await verifyActions();
    console.log("\n>>> ALL MILESTONE 1 VERIFICATIONS PASSED SUCCESSFULLY! <<<");
  } catch (err: any) {
    console.error("Verification failed:", err.message);
    process.exit(1);
  }
}

main();
