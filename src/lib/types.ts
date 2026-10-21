/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyRow = Record<string, any>;

export type AppRole = "OWNER" | "SALES" | "WAREHOUSE" | "ACCOUNTING";
export type Ownership = "OWNED" | "CONSIGNED";
export type DocStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";
export type BalanceStatus = "UNPAID" | "PARTIAL" | "PAID" | "CANCELLED";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string;
  role: AppRole;
  is_active: boolean;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  OWNER: "Owner",
  SALES: "Sales",
  WAREHOUSE: "Warehouse",
  ACCOUNTING: "Accounting",
};

export const PARTNER_KINDS = [
  "RETAIL",
  "GARAGE",
  "TRANSPORT",
  "SHOP",
  "OTHER",
] as const;

export const CODE_KINDS = [
  "OEM",
  "MANUFACTURER",
  "AFTERMARKET",
  "EQUIVALENT",
] as const;

export const RETURN_KINDS = [
  "CUSTOMER_RETURN",
  "PARTNER_RETURN",
  "SUPPLIER_RETURN",
] as const;

export const RETURN_REASONS = [
  "DEFECT",
  "WRONG_ITEM",
  "WARRANTY",
  "UNSOLD",
  "OTHER",
] as const;
