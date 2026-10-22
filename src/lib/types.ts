/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyRow = Record<string, any>;

export type AppRole = "OWNER" | "SALES" | "WAREHOUSE" | "ACCOUNTING";
export type Ownership = "OWNED" | "CONSIGNED";
export type DocStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";
export type BalanceStatus = "UNPAID" | "PARTIAL" | "PAID" | "CANCELLED";

export interface Profile {
  id: string;
  email: string | null;
  username: string | null;
  full_name: string;
  role: AppRole;
  is_active: boolean;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  OWNER: "Chủ cửa hàng",
  SALES: "Bán hàng",
  WAREHOUSE: "Kho",
  ACCOUNTING: "Kế toán",
};

export const DOC_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Nháp",
  CONFIRMED: "Đã xác nhận",
  CANCELLED: "Đã huỷ",
};

export const BALANCE_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Chưa thanh toán",
  PARTIAL: "Thanh toán một phần",
  PAID: "Đã thanh toán",
  CANCELLED: "Đã huỷ",
};

/** Every status a badge can show, across documents, balances, batches, invoices. */
export const STATUS_LABELS: Record<string, string> = {
  ...DOC_STATUS_LABELS,
  ...BALANCE_STATUS_LABELS,
  ISSUED: "Đã phát hành",
  ACTIVE: "Đang hoạt động",
  DEPLETED: "Đã hết hàng",
  NOT_INVOICED: "Chưa xuất hoá đơn",
  INVOICED: "Đã xuất hoá đơn",
};

export const OWNERSHIP_LABELS: Record<string, string> = {
  OWNED: "Hàng của mình",
  CONSIGNED: "Hàng ký gửi",
};

export const PARTNER_KIND_LABELS: Record<string, string> = {
  RETAIL: "Khách lẻ",
  GARAGE: "Gara",
  TRANSPORT: "Vận tải",
  SHOP: "Cửa hàng",
  OTHER: "Khác",
};

export const CODE_KIND_LABELS: Record<string, string> = {
  OEM: "OEM",
  MANUFACTURER: "Hãng sản xuất",
  AFTERMARKET: "Hàng thay thế",
  EQUIVALENT: "Tương đương",
};

export const RETURN_KIND_LABELS: Record<string, string> = {
  CUSTOMER_RETURN: "Khách trả hàng",
  PARTNER_RETURN: "Đối tác trả hàng",
  SUPPLIER_RETURN: "Trả nhà cung cấp",
};

export const RETURN_REASON_LABELS: Record<string, string> = {
  DEFECT: "Lỗi / hỏng",
  WRONG_ITEM: "Sai hàng",
  WARRANTY: "Bảo hành",
  UNSOLD: "Không bán được",
  OTHER: "Khác",
};

export const NATURE_LABELS: Record<string, string> = {
  PURCHASED: "Mua đứt",
  CONSIGNED: "Ký gửi",
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
