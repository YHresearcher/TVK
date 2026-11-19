import crypto from "node:crypto";

export type AppRole = "OWNER" | "CEO" | "ACCOUNTING" | "SALES" | "WAREHOUSE";

export type CashFundKind = "CASH" | "BANK";
export type CategoryGroupKey = "SALARY" | "RENT" | "TRANSPORT" | "TAX" | "OTHER";
export type CashMovementKind = "DEBT_PAYMENT" | "OPERATING" | "INTERNAL_TRANSFER" | "REVERSAL";
export type ReconciliationPeriodType = "MONTH" | "WEEK" | "CUSTOM";
export type ReconciliationPeriodStatus = "OPEN" | "RECONCILED" | "LOCKED";
export type ReconciliationDataGroup = "CASH_FUND" | "RECEIVABLE" | "PAYABLE" | "INVENTORY" | "REVENUE_EXPENSE";
export type DiscrepancyStatus = "MATCHED" | "PENDING" | "VALID_TAX_TIMING" | "ACCOUNTING_ERROR" | "TVK_ERROR";

export interface CashFundRow {
  id: string;
  name: string;
  kind: CashFundKind;
  opening_balance: number;
  opening_balance_date: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CashCategoryRow {
  id: string;
  code: string;
  name: string;
  kind: "IN" | "OUT";
  group_key: CategoryGroupKey;
  is_fixed: boolean;
  monthly_budget: number;
  is_active: boolean;
  is_system: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashMovementRow {
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
  created_at: string;
}

export interface ReconciliationPeriodRow {
  id: string;
  period_type: ReconciliationPeriodType;
  name: string;
  from_date: string;
  to_date: string;
  status: ReconciliationPeriodStatus;
  note?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReconciliationEntryRow {
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
  created_at: string;
  updated_at: string;
}

export interface ReconciliationSnapshotRow {
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
  summary: any;
  snapshot_items: any[];
  note?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  payable_id?: string | null;
  receivable_id?: string | null;
  amount: number;
  payment_date: string;
  note?: string | null;
}

export interface PartnerReceivableRow {
  id: string;
  partner_name: string;
  amount: number;
  amount_paid: number;
  status: "UNPAID" | "PARTIAL" | "PAID";
  due_date: string;
}

export interface SupplierPayableRow {
  id: string;
  supplier_name: string;
  amount: number;
  amount_paid: number;
  status: "UNPAID" | "PARTIAL" | "PAID";
  due_date: string;
}

export interface CashFundBalanceRow {
  fund_id: string;
  fund_name: string;
  kind: CashFundKind;
  opening_balance: number;
  opening_balance_date: string;
  is_active: boolean;
  total_in: number;
  total_out: number;
  balance: number;
}

const DEFAULT_CATEGORIES: Array<Omit<CashCategoryRow, "id" | "created_at" | "updated_at">> = [
  { code: "THU_LAI", name: "Thu lãi tiền gửi ngân hàng", kind: "IN", group_key: "OTHER", is_fixed: false, monthly_budget: 0, is_active: true, is_system: true },
  { code: "THU_THANH_LY", name: "Thu thanh lý phụ tùng cũ / tài sản", kind: "IN", group_key: "OTHER", is_fixed: false, monthly_budget: 0, is_active: true, is_system: true },
  { code: "THU_HOAN_UNG", name: "Thu hoàn ứng / tạm ứng nhân sự", kind: "IN", group_key: "OTHER", is_fixed: false, monthly_budget: 0, is_active: true, is_system: true },
  { code: "THU_KHAC", name: "Thu hoạt động khác ngoài công nợ", kind: "IN", group_key: "OTHER", is_fixed: false, monthly_budget: 0, is_active: true, is_system: true },
  { code: "CHI_LUONG", name: "Lương và phụ cấp nhân sự", kind: "OUT", group_key: "SALARY", is_fixed: true, monthly_budget: 0, is_active: true, is_system: true },
  { code: "CHI_MAT_BANG", name: "Tiền thuê mặt bằng, kho bãi", kind: "OUT", group_key: "RENT", is_fixed: true, monthly_budget: 0, is_active: true, is_system: true },
  { code: "CHI_VAN_CHUYEN", name: "Chi phí vận chuyển & giao nhận", kind: "OUT", group_key: "TRANSPORT", is_fixed: false, monthly_budget: 0, is_active: true, is_system: true },
  { code: "CHI_THUE_PHI", name: "Tiền thuế, phí & lệ phí nhà nước", kind: "OUT", group_key: "TAX", is_fixed: false, monthly_budget: 0, is_active: true, is_system: true },
  { code: "CHI_DIEN_NUOC", name: "Tiền điện, nước, internet, viễn thông", kind: "OUT", group_key: "OTHER", is_fixed: true, monthly_budget: 0, is_active: true, is_system: true },
  { code: "CHI_SUA_CHUA", name: "Sửa chữa, bảo trì kho và trang thiết bị", kind: "OUT", group_key: "OTHER", is_fixed: false, monthly_budget: 0, is_active: true, is_system: true },
  { code: "CHI_TIEP_KHACH", name: "Chi phí tiếp khách, văn phòng phẩm", kind: "OUT", group_key: "OTHER", is_fixed: false, monthly_budget: 0, is_active: true, is_system: true },
  { code: "CHI_KHAC", name: "Chi phí vận hành khác", kind: "OUT", group_key: "OTHER", is_fixed: false, monthly_budget: 0, is_active: true, is_system: true },
];

export class InMemoryDB {
  public cash_funds: CashFundRow[] = [];
  public cash_categories: CashCategoryRow[] = [];
  public cash_movements: CashMovementRow[] = [];
  public reconciliation_periods: ReconciliationPeriodRow[] = [];
  public reconciliation_entries: ReconciliationEntryRow[] = [];
  public reconciliation_snapshots: ReconciliationSnapshotRow[] = [];
  public payments: PaymentRow[] = [];
  public partner_receivables: PartnerReceivableRow[] = [];
  public supplier_payables: SupplierPayableRow[] = [];

  private currentRole: AppRole = "OWNER";
  private currentUserId: string = "00000000-0000-0000-0000-000000000001";

  constructor() {
    this.reset();
  }

  public setRole(role: AppRole): void {
    this.currentRole = role;
  }

  public getRole(): AppRole {
    return this.currentRole;
  }

  public setUserId(uid: string): void {
    this.currentUserId = uid;
  }

  public getUserId(): string {
    return this.currentUserId;
  }

  public reset(): void {
    this.cash_funds = [];
    this.cash_movements = [];
    this.reconciliation_periods = [];
    this.reconciliation_entries = [];
    this.reconciliation_snapshots = [];
    this.payments = [];
    this.partner_receivables = [];
    this.supplier_payables = [];
    this.currentRole = "OWNER";

    // Seed default categories
    const now = new Date().toISOString();
    this.cash_categories = DEFAULT_CATEGORIES.map((c) => ({
      ...c,
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
    }));
  }

  // -------------------------------------------------------------------------
  // RLS Checks
  // -------------------------------------------------------------------------
  private assertSelectPermission(table: string): void {
    if (this.currentRole === "SALES" || this.currentRole === "WAREHOUSE") {
      throw new Error(`Chưa được phân quyền truy cập: ${this.currentRole} không có quyền xem ${table}.`);
    }
  }

  private assertOwnerMutation(action: string, table: string): void {
    if (this.currentRole === "SALES" || this.currentRole === "WAREHOUSE") {
      throw new Error(`Chưa được phân quyền truy cập: ${this.currentRole} bị chặn thao tác.`);
    }
    if (this.currentRole === "CEO") {
      throw new Error(`Thao tác bị từ chối: Quyền CEO chỉ được xem dữ liệu (${action} on ${table}).`);
    }
    if (this.currentRole !== "OWNER") {
      throw new Error(`Chỉ Chủ cửa hàng (OWNER) mới có quyền ${action} trên ${table}.`);
    }
  }

  // -------------------------------------------------------------------------
  // VIEW: v_cash_fund_balances
  // -------------------------------------------------------------------------
  public getFundBalances(): CashFundBalanceRow[] {
    this.assertSelectPermission("v_cash_fund_balances");
    return this.cash_funds.map((f) => {
      const fundMovements = this.cash_movements.filter((m) => m.fund_id === f.id);

      const total_in = fundMovements
        .filter((m) => m.amount > 0 && !m.is_cancelled && m.movement_kind !== "REVERSAL")
        .reduce((sum, m) => sum + m.amount, 0);

      const total_out = fundMovements
        .filter((m) => m.amount < 0 && !m.is_cancelled && m.movement_kind !== "REVERSAL")
        .reduce((sum, m) => sum + -m.amount, 0);

      const total_all_movements = fundMovements.reduce((sum, m) => sum + m.amount, 0);
      const balance = f.opening_balance + total_all_movements;

      return {
        fund_id: f.id,
        fund_name: f.name,
        kind: f.kind,
        opening_balance: f.opening_balance,
        opening_balance_date: f.opening_balance_date,
        is_active: f.is_active,
        total_in,
        total_out,
        balance,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Trigger simulation: calc_reconciliation_difference
  // -------------------------------------------------------------------------
  private triggerCalcDiff(entry: ReconciliationEntryRow): void {
    if (!entry.discrepancy_status) {
      entry.discrepancy_status = "PENDING";
    }
    entry.difference_amount = (entry.tvk_amount ?? 0) - (entry.accounting_amount ?? 0);
    if (
      Math.abs(entry.difference_amount) < 0.01 &&
      entry.discrepancy_status === "PENDING"
    ) {
      entry.discrepancy_status = "MATCHED";
    }
    entry.updated_at = new Date().toISOString();
  }

  // -------------------------------------------------------------------------
  // Stored Procedure RPC: transfer_internal_cash_funds
  // -------------------------------------------------------------------------
  public transfer_internal_cash_funds(params: {
    p_source_fund_id: string;
    p_dest_fund_id: string;
    p_amount: number;
    p_transfer_date: string;
    p_note?: string;
  }): string {
    if (this.currentRole !== "OWNER") {
      throw new Error("Chỉ Chủ cửa hàng mới được thực hiện chuyển quỹ nội bộ.");
    }
    if (params.p_source_fund_id === params.p_dest_fund_id) {
      throw new Error("Quỹ nguồn và quỹ đích không được trùng nhau.");
    }
    if (params.p_amount <= 0) {
      throw new Error("Số tiền chuyển quỹ phải lớn hơn 0.");
    }

    const sourceFund = this.cash_funds.find((f) => f.id === params.p_source_fund_id);
    const destFund = this.cash_funds.find((f) => f.id === params.p_dest_fund_id);
    if (!sourceFund || !destFund) {
      throw new Error("Không tìm thấy quỹ nguồn hoặc quỹ đích.");
    }

    const transfer_id = crypto.randomUUID();
    const source_mov_id = crypto.randomUUID();
    const dest_mov_id = crypto.randomUUID();
    const now = new Date().toISOString();

    const note = params.p_note || "Chuyển quỹ nội bộ";

    // 1. Tiền ra khỏi quỹ nguồn (-)
    const sourceMov: CashMovementRow = {
      id: source_mov_id,
      fund_id: params.p_source_fund_id,
      movement_kind: "INTERNAL_TRANSFER",
      amount: -params.p_amount,
      movement_date: params.p_transfer_date,
      transfer_id,
      counter_fund_id: params.p_dest_fund_id,
      counter_movement_id: dest_mov_id,
      note,
      created_by: this.currentUserId,
      is_cancelled: false,
      created_at: now,
    };

    // 2. Tiền vào quỹ đích (+)
    const destMov: CashMovementRow = {
      id: dest_mov_id,
      fund_id: params.p_dest_fund_id,
      movement_kind: "INTERNAL_TRANSFER",
      amount: params.p_amount,
      movement_date: params.p_transfer_date,
      transfer_id,
      counter_fund_id: params.p_source_fund_id,
      counter_movement_id: source_mov_id,
      note,
      created_by: this.currentUserId,
      is_cancelled: false,
      created_at: now,
    };

    this.cash_movements.push(sourceMov, destMov);
    return transfer_id;
  }

  // -------------------------------------------------------------------------
  // Stored Procedure RPC: cancel_cash_movement_reversal
  // -------------------------------------------------------------------------
  public cancel_cash_movement_reversal(params: {
    p_movement_id: string;
    p_reason: string;
  }): string {
    if (this.currentRole !== "OWNER") {
      throw new Error("Chỉ Chủ cửa hàng mới có quyền huỷ phiếu và tạo bút toán đảo.");
    }
    const reason = params.p_reason?.trim();
    if (!reason || reason.length === 0) {
      throw new Error("Bắt buộc phải nhập lý do huỷ phiếu.");
    }

    const orig = this.cash_movements.find((m) => m.id === params.p_movement_id);
    if (!orig) {
      throw new Error("Không tìm thấy giao dịch quỹ cần huỷ.");
    }
    if (orig.is_cancelled) {
      throw new Error("Giao dịch này đã được huỷ trước đó.");
    }
    if (orig.movement_kind === "REVERSAL") {
      throw new Error("Không thể huỷ một bút toán đảo.");
    }

    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const reversal_id = crypto.randomUUID();

    // 1. Tạo bút toán đảo
    const reversalMov: CashMovementRow = {
      id: reversal_id,
      fund_id: orig.fund_id,
      movement_kind: "REVERSAL",
      amount: -orig.amount,
      movement_date: today,
      category_id: orig.category_id,
      payment_id: orig.payment_id,
      transfer_id: orig.transfer_id,
      counter_fund_id: orig.counter_fund_id,
      reversal_of_id: orig.id,
      note: `Bút toán đảo huỷ: ${orig.note ?? ""} (Lý do: ${reason})`,
      created_by: this.currentUserId,
      is_cancelled: false,
      created_at: now,
    };
    this.cash_movements.push(reversalMov);

    // 2. Ghi nhận huỷ trên dòng gốc
    orig.is_cancelled = true;
    orig.cancel_reason = reason;
    orig.cancelled_at = now;
    orig.cancelled_by = this.currentUserId;
    orig.reversal_entry_id = reversal_id;

    // 3. Nếu là chuyển quỹ, tự động đảo luôn chân đối ứng
    if (orig.movement_kind === "INTERNAL_TRANSFER" && orig.counter_movement_id) {
      const counterOrig = this.cash_movements.find((m) => m.id === orig.counter_movement_id);
      if (counterOrig && !counterOrig.is_cancelled) {
        const counter_reversal_id = crypto.randomUUID();
        const counterReversalMov: CashMovementRow = {
          id: counter_reversal_id,
          fund_id: counterOrig.fund_id,
          movement_kind: "REVERSAL",
          amount: -counterOrig.amount,
          movement_date: today,
          transfer_id: counterOrig.transfer_id,
          counter_fund_id: counterOrig.counter_fund_id,
          reversal_of_id: counterOrig.id,
          note: `Bút toán đảo đối ứng chuyển quỹ (Lý do: ${reason})`,
          created_by: this.currentUserId,
          is_cancelled: false,
          created_at: now,
        };
        this.cash_movements.push(counterReversalMov);

        counterOrig.is_cancelled = true;
        counterOrig.cancel_reason = reason;
        counterOrig.cancelled_at = now;
        counterOrig.cancelled_by = this.currentUserId;
        counterOrig.reversal_entry_id = counter_reversal_id;
      }
    }

    // 4. Nếu là thanh toán công nợ, phục hồi số dư công nợ
    if (orig.payment_id) {
      const pmt = this.payments.find((p) => p.id === orig.payment_id);
      if (pmt) {
        if (pmt.payable_id) {
          const sp = this.supplier_payables.find((p) => p.id === pmt.payable_id);
          if (sp) {
            sp.amount_paid = Math.max(sp.amount_paid - pmt.amount, 0);
            sp.status = sp.amount_paid === 0 ? "UNPAID" : "PARTIAL";
          }
        } else if (pmt.receivable_id) {
          const pr = this.partner_receivables.find((r) => r.id === pmt.receivable_id);
          if (pr) {
            pr.amount_paid = Math.max(pr.amount_paid - pmt.amount, 0);
            pr.status = pr.amount_paid === 0 ? "UNPAID" : "PARTIAL";
          }
        }
      }
    }

    return reversal_id;
  }

  // -------------------------------------------------------------------------
  // Stored Procedure RPC: create_reconciliation_snapshot
  // -------------------------------------------------------------------------
  public create_reconciliation_snapshot(params: {
    p_period_id: string;
    p_name?: string;
    p_note?: string;
  }): string {
    if (this.currentRole !== "OWNER") {
      throw new Error("Chỉ Chủ cửa hàng mới có quyền chốt kỳ đối chiếu.");
    }
    const period = this.reconciliation_periods.find((p) => p.id === params.p_period_id);
    if (!period) {
      throw new Error(`Không tìm thấy kỳ đối chiếu ${params.p_period_id}`);
    }

    const entries = this.reconciliation_entries.filter((e) => e.period_id === params.p_period_id);

    // snapshot_no
    const prevSnapshots = this.reconciliation_snapshots.filter((s) => s.period_id === params.p_period_id);
    const next_no = prevSnapshots.length > 0 ? Math.max(...prevSnapshots.map((s) => s.snapshot_no)) + 1 : 1;

    const total_tvk = entries.reduce((s, e) => s + (e.tvk_amount || 0), 0);
    const total_acc = entries.reduce((s, e) => s + (e.accounting_amount || 0), 0);
    const total_diff = entries.reduce((s, e) => s + (e.difference_amount || 0), 0);

    const byGroup: Record<string, { tvk: number; acc: number; diff: number }> = {};
    for (const e of entries) {
      if (!byGroup[e.data_group]) {
        byGroup[e.data_group] = { tvk: 0, acc: 0, diff: 0 };
      }
      byGroup[e.data_group].tvk += e.tvk_amount || 0;
      byGroup[e.data_group].acc += e.accounting_amount || 0;
      byGroup[e.data_group].diff += e.difference_amount || 0;
    }

    const summary = {
      total_entries: entries.length,
      matched_count: entries.filter((e) => e.discrepancy_status === "MATCHED").length,
      pending_count: entries.filter((e) => e.discrepancy_status === "PENDING").length,
      explained_count: entries.filter((e) => !["MATCHED", "PENDING"].includes(e.discrepancy_status)).length,
      by_group: byGroup,
    };

    const snapshot_id = crypto.randomUUID();
    const now = new Date().toISOString();

    const snapshot: ReconciliationSnapshotRow = {
      id: snapshot_id,
      period_id: params.p_period_id,
      snapshot_no: next_no,
      name: params.p_name || `${period.name} - Bản chốt ${next_no}`,
      period_name: period.name,
      from_date: period.from_date,
      to_date: period.to_date,
      total_tvk,
      total_acc,
      total_diff,
      summary,
      snapshot_items: JSON.parse(JSON.stringify(entries)), // deep copy freeze
      note: params.p_note ?? null,
      created_by: this.currentUserId,
      created_at: now,
    };

    this.reconciliation_snapshots.push(snapshot);
    period.status = "RECONCILED";
    period.updated_at = now;

    return snapshot_id;
  }

  // -------------------------------------------------------------------------
  // Fluent PostgREST mock query builder
  // -------------------------------------------------------------------------
  public from(tableName: string) {
    return new PostgrestQueryBuilder(this, tableName);
  }

  public async rpc(funcName: string, args: Record<string, any>): Promise<{ data: any; error: any }> {
    try {
      if (funcName === "transfer_internal_cash_funds") {
        const id = this.transfer_internal_cash_funds({
          p_source_fund_id: args.p_source_fund_id,
          p_dest_fund_id: args.p_dest_fund_id,
          p_amount: args.p_amount,
          p_transfer_date: args.p_transfer_date,
          p_note: args.p_note,
        });
        return { data: id, error: null };
      }
      if (funcName === "cancel_cash_movement_reversal") {
        const id = this.cancel_cash_movement_reversal({
          p_movement_id: args.p_movement_id,
          p_reason: args.p_reason,
        });
        return { data: id, error: null };
      }
      if (funcName === "create_reconciliation_snapshot") {
        const id = this.create_reconciliation_snapshot({
          p_period_id: args.p_period_id,
          p_name: args.p_name,
          p_note: args.p_note,
        });
        return { data: id, error: null };
      }
      throw new Error(`Unknown RPC function: ${funcName}`);
    } catch (err: any) {
      return { data: null, error: err };
    }
  }

  // Internal table accessor with security
  public _getTable(tableName: string): any[] {
    this.assertSelectPermission(tableName);
    switch (tableName) {
      case "cash_funds":
        return this.cash_funds;
      case "cash_categories":
        return this.cash_categories;
      case "cash_movements":
        return this.cash_movements;
      case "reconciliation_periods":
        return this.reconciliation_periods;
      case "reconciliation_entries":
        return this.reconciliation_entries;
      case "reconciliation_snapshots":
        return this.reconciliation_snapshots;
      case "v_cash_fund_balances":
        return this.getFundBalances();
      case "payments":
        return this.payments;
      case "partner_receivables":
        return this.partner_receivables;
      case "supplier_payables":
        return this.supplier_payables;
      default:
        throw new Error(`Unknown table in in-memory-db: ${tableName}`);
    }
  }

  // Internal mutation helpers
  public _insert(tableName: string, rowOrRows: any | any[]): any {
    this.assertOwnerMutation("INSERT", tableName);
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    const inserted: any[] = [];
    const now = new Date().toISOString();

    for (const raw of rows) {
      const item = { ...raw };
      if (!item.id) item.id = crypto.randomUUID();
      if (!item.created_at) item.created_at = now;
      if (!item.updated_at && tableName !== "cash_movements") item.updated_at = now;

      if (tableName === "reconciliation_periods") {
        if (item.from_date && item.to_date && item.to_date < item.from_date) {
          throw new Error("chk_reconciliation_period_dates: to_date must be >= from_date");
        }
      }

      if (tableName === "reconciliation_entries") {
        const period = this.reconciliation_periods.find((p) => p.id === item.period_id);
        if (period && period.status === "LOCKED") {
          throw new Error("Kỳ đối chiếu đã đóng, không thể sửa đổi số liệu.");
        }
        this.triggerCalcDiff(item);
      }

      const table = this._getTable(tableName);
      table.push(item);
      inserted.push(item);
    }
    return Array.isArray(rowOrRows) ? inserted : inserted[0];
  }

  public _update(tableName: string, updates: any, filterFn: (row: any) => boolean): any[] {
    if (this.currentRole === "CEO") {
      throw new Error(`Thao tác bị từ chối: Quyền CEO chỉ được xem dữ liệu (UPDATE on ${tableName}).`);
    }
    if (this.currentRole === "SALES" || this.currentRole === "WAREHOUSE") {
      throw new Error(`Chưa được phân quyền truy cập: ${this.currentRole} bị chặn.`);
    }
    if (this.currentRole === "ACCOUNTING") {
      if (tableName !== "reconciliation_entries") {
        throw new Error(`Kế toán chỉ được cập nhật số liệu đối chiếu trên reconciliation_entries.`);
      }
    } else if (this.currentRole !== "OWNER") {
      throw new Error(`Chỉ Chủ cửa hàng mới có quyền UPDATE trên ${tableName}.`);
    }

    const table = this._getTable(tableName);
    const matched = table.filter(filterFn);
    const now = new Date().toISOString();

    for (const row of matched) {
      if (tableName === "reconciliation_entries") {
        const period = this.reconciliation_periods.find((p) => p.id === row.period_id);
        if (period && period.status === "LOCKED") {
          throw new Error("Kỳ đối chiếu đã đóng, không thể sửa đổi số liệu.");
        }
      }
      Object.assign(row, updates);
      if ("updated_at" in row) {
        row.updated_at = now;
      }
      if (tableName === "reconciliation_entries") {
        this.triggerCalcDiff(row);
      }
    }
    return matched;
  }

  public _delete(tableName: string, filterFn: (row: any) => boolean): any[] {
    this.assertOwnerMutation("DELETE", tableName);
    if (tableName === "cash_funds" || tableName === "cash_movements") {
      throw new Error(`Operation not permitted: DELETE on ${tableName} is blocked by business policy.`);
    }
    const table = this._getTable(tableName);
    const removed: any[] = [];
    for (let i = table.length - 1; i >= 0; i--) {
      if (filterFn(table[i])) {
        if (tableName === "cash_categories" && table[i].is_system) {
          throw new Error("Không thể xoá danh mục chi phí mặc định của hệ thống.");
        }
        removed.push(table.splice(i, 1)[0]);
      }
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// PostgREST Query Builder Emulator
// ---------------------------------------------------------------------------
class PostgrestQueryBuilder {
  private db: InMemoryDB;
  private tableName: string;
  private filters: Array<(row: any) => boolean> = [];
  private orderConfig?: { col: string; ascending: boolean };
  private limitCount?: number;
  private operation: "select" | "insert" | "update" | "delete" = "select";
  private payload: any = null;
  private isSingle = false;
  private isMaybeSingle = false;

  constructor(db: InMemoryDB, tableName: string) {
    this.db = db;
    this.tableName = tableName;
  }

  public select(cols?: string): this {
    this.operation = "select";
    return this;
  }

  public insert(values: any | any[]): this {
    this.operation = "insert";
    this.payload = values;
    return this;
  }

  public update(values: any): this {
    this.operation = "update";
    this.payload = values;
    return this;
  }

  public delete(): this {
    this.operation = "delete";
    return this;
  }

  public eq(column: string, value: any): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  public neq(column: string, value: any): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  public in(column: string, values: any[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  public order(column: string, opts?: { ascending?: boolean }): this {
    this.orderConfig = { col: column, ascending: opts?.ascending ?? true };
    return this;
  }

  public limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  public single(): Promise<{ data: any; error: any }> {
    this.isSingle = true;
    return this.execute();
  }

  public maybeSingle(): Promise<{ data: any; error: any }> {
    this.isMaybeSingle = true;
    return this.execute();
  }

  public then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: any; error: any }> {
    try {
      const matchFilter = (row: any) => this.filters.every((fn) => fn(row));

      if (this.operation === "insert") {
        const result = this.db._insert(this.tableName, this.payload);
        return { data: result, error: null };
      }

      if (this.operation === "update") {
        const updated = this.db._update(this.tableName, this.payload, matchFilter);
        return { data: updated, error: null };
      }

      if (this.operation === "delete") {
        const deleted = this.db._delete(this.tableName, matchFilter);
        return { data: deleted, error: null };
      }

      // SELECT
      let rows = [...this.db._getTable(this.tableName)];
      if (this.filters.length > 0) {
        rows = rows.filter(matchFilter);
      }

      if (this.orderConfig) {
        const { col, ascending } = this.orderConfig;
        rows.sort((a, b) => {
          if (a[col] < b[col]) return ascending ? -1 : 1;
          if (a[col] > b[col]) return ascending ? 1 : -1;
          return 0;
        });
      }

      if (this.limitCount !== undefined) {
        rows = rows.slice(0, this.limitCount);
      }

      if (this.isSingle) {
        if (rows.length === 0) {
          throw new Error(`PGRST116: The result contains 0 rows when 1 row was expected.`);
        }
        if (rows.length > 1) {
          throw new Error(`PGRST116: The result contains ${rows.length} rows when 1 row was expected.`);
        }
        return { data: rows[0], error: null };
      }

      if (this.isMaybeSingle) {
        return { data: rows.length > 0 ? rows[0] : null, error: null };
      }

      return { data: rows, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }
}
