/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * TVK Management Accounting & 2-Tier Reconciliation Type Definitions
 */

// ---------------------------------------------------------------------
// CASH FUNDS & MOVEMENTS
// ---------------------------------------------------------------------
export type CashFundKind = "CASH" | "BANK";

export interface CashFund {
  id: string;
  name: string;
  kind: CashFundKind;
  opening_balance: number;
  opening_balance_date: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CashFundBalance extends CashFund {
  fund_id: string;
  fund_name: string;
  total_in: number;
  total_out: number;
  balance: number;
}

// ---------------------------------------------------------------------
// CASH CATEGORIES (THU / CHI VẬN HÀNH)
// ---------------------------------------------------------------------
export type CategoryGroupKey = "SALARY" | "RENT" | "TRANSPORT" | "TAX" | "OTHER";
export type CashCategoryKind = "IN" | "OUT";

export interface CashCategory {
  id: string;
  code: string;
  name: string;
  kind: CashCategoryKind;
  group_key: CategoryGroupKey;
  is_fixed: boolean;
  monthly_budget: number;
  is_active: boolean;
  is_system: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const CATEGORY_GROUP_LABELS: Record<CategoryGroupKey, string> = {
  SALARY: "Lương & Nhân sự",
  RENT: "Mặt bằng & Kho bãi",
  TRANSPORT: "Vận chuyển & Giao nhận",
  TAX: "Thuế & Phí nhà nước",
  OTHER: "Chi phí vận hành khác",
};

// ---------------------------------------------------------------------
// CASH MOVEMENTS & TRANSFERS
// ---------------------------------------------------------------------
export type CashMovementKind = "DEBT_PAYMENT" | "OPERATING" | "INTERNAL_TRANSFER" | "REVERSAL";

export interface CashMovement {
  id: string;
  fund_id: string;
  movement_kind: CashMovementKind;
  amount: number;
  movement_date: string;
  category_id?: string | null;
  payment_id?: string | null;
  transfer_id?: string | null;
  counter_fund_id?: string | null;
  counter_movement_id?: string | null;
  note?: string | null;
  created_by?: string | null;
  is_cancelled: boolean;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  reversal_of_id?: string | null;
  reversal_entry_id?: string | null;
  created_at?: string;
  // Joins
  fund_name?: string;
  counter_fund_name?: string;
  category_name?: string;
  category_code?: string;
  category_group_key?: CategoryGroupKey;
  creator_name?: string;
}

export const CASH_MOVEMENT_KIND_LABELS: Record<CashMovementKind, string> = {
  DEBT_PAYMENT: "Thanh toán công nợ",
  OPERATING: "Thu / chi vận hành",
  INTERNAL_TRANSFER: "Chuyển quỹ nội bộ",
  REVERSAL: "Bút toán đảo huỷ",
};

// ---------------------------------------------------------------------
// RECONCILIATION MODULE (ĐỐI CHIẾU KẾ TOÁN 2 TẦNG)
// ---------------------------------------------------------------------
export type ReconciliationPeriodType = "MONTH" | "WEEK" | "CUSTOM";
export type ReconciliationPeriodStatus = "OPEN" | "RECONCILED" | "LOCKED";

export interface ReconciliationPeriod {
  id: string;
  period_type: ReconciliationPeriodType;
  name: string;
  from_date: string;
  to_date: string;
  status: ReconciliationPeriodStatus;
  note?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type ReconciliationDataGroup =
  | "CASH_FUND"       // (1) Quỹ tiền két / ngân hàng
  | "RECEIVABLE"      // (2) Phải thu đối tác
  | "PAYABLE"         // (3) Phải trả nhà cung cấp
  | "INVENTORY"       // (4) Tồn kho tổng hợp
  | "REVENUE_EXPENSE"; // (5) Doanh thu & Chi phí nhóm gọn

export const RECONCILIATION_DATA_GROUP_LABELS: Record<ReconciliationDataGroup, string> = {
  CASH_FUND: "Quỹ tiền két & Ngân hàng",
  RECEIVABLE: "Phải thu đối tác",
  PAYABLE: "Phải trả nhà cung cấp",
  INVENTORY: "Tồn kho tổng hợp",
  REVENUE_EXPENSE: "Doanh thu & Chi phí",
};

export type DiscrepancyStatus =
  | "MATCHED"             // Đã khớp
  | "PENDING"             // Chờ giải trình
  | "VALID_TAX_TIMING"    // Lệch hợp lệ (Thuế vs Nội bộ)
  | "ACCOUNTING_ERROR"    // Lỗi bên kế toán
  | "TVK_ERROR";           // Lỗi bên TVK

export const DISCREPANCY_STATUS_LABELS: Record<DiscrepancyStatus, string> = {
  MATCHED: "Đã khớp",
  PENDING: "Chờ giải trình",
  VALID_TAX_TIMING: "Lệch hợp lệ (Thuế vs Nội bộ)",
  ACCOUNTING_ERROR: "Lỗi bên kế toán",
  TVK_ERROR: "Lỗi bên TVK",
};

export interface ReconciliationEntry {
  id: string;
  period_id: string;
  data_group: ReconciliationDataGroup;
  item_key: string;
  item_name: string;
  item_subtext?: string | null;
  tvk_amount: number;
  accounting_amount: number;
  difference_amount: number;
  discrepancy_status: DiscrepancyStatus;
  explanation_note?: string | null;
  drilldown_data?: any;
  created_at?: string;
  updated_at?: string;
}

export interface ReconciliationSnapshotSummary {
  total_entries?: number;
  matched_count?: number;
  pending_count?: number;
  explained_count?: number;
  by_group?: Record<string, {
    tvk: number;
    acc: number;
    diff: number;
  }>;
}

export interface ReconciliationSnapshot {
  id: string;
  period_id: string;
  snapshot_no: number;
  name: string;
  period_name: string;
  from_date: string;
  to_date: string;
  total_tvk: number;
  total_acc: number;
  total_diff: number;
  summary: ReconciliationSnapshotSummary | Record<string, any>;
  snapshot_items: ReconciliationEntry[] | Record<string, any>[];
  note?: string | null;
  created_by?: string | null;
  created_at?: string;
}

// ---------------------------------------------------------------------
// CASH FLOW FORECAST (14 - 30 NGÀY)
// ---------------------------------------------------------------------
export interface CashFlowRunwayForecast {
  currentAvailableCash: number;
  inflow14: number;
  outflow14: number;
  fixedCost14: number;
  net14: number;
  inflow30: number;
  outflow30: number;
  fixedCost30: number;
  net30: number;
  dailyPoints: Array<{
    date: string;
    cash: number;
    inflow: number;
    outflow: number;
    fixedCost: number;
  }>;
}
