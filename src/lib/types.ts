/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyRow = Record<string, any>;

export type AppRole = "OWNER" | "SALES" | "WAREHOUSE" | "ACCOUNTING" | "CEO";
export type Ownership = "OWNED" | "CONSIGNED";

/** Một đoạn của một vòng trong biểu đồ 3 vòng đồng tâm (cơ cấu tồn kho).
 *  value luôn tính theo giá vốn lô; qty là số cái. href là link lọc trang
 *  tồn kho, null khi vòng đó chưa có bộ lọc tương ứng. */
export interface RingSegment {
  key: string;
  label: string;
  color: string;
  qty: number;
  value: number;
  lots: number;
  skus: number;
  href: string | null;
}

/** Ba vòng độc lập của cùng một lượng hàng đang quản lý, cùng chuẩn giá vốn. */
export interface StockRings {
  ownership: RingSegment[];
  location: RingSegment[];
  status: RingSegment[];
}
export type DocStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";
export type BalanceStatus = "UNPAID" | "PARTIAL" | "PAID" | "CANCELLED";

export interface Profile {
  id: string;
  email: string | null;
  username: string | null;
  full_name: string;
  role: AppRole;
  is_active: boolean;
  /** TRUE = đang dùng mật khẩu tạm / vừa reset: phải đổi mật khẩu mới vào được hệ thống. */
  must_change_password?: boolean;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  OWNER: "Chủ cửa hàng",
  SALES: "Bán hàng",
  WAREHOUSE: "Kho",
  ACCOUNTING: "Kế toán",
  CEO: "CEO (chỉ xem)",
};

/**
 * Vai trò chỉ xem (CEO): xem được toàn bộ số liệu kho và tài chính nhưng
 * không tạo/sửa/xoá được gì — giao diện ẩn mọi form thao tác và RLS ở
 * cơ sở dữ liệu cũng không cấp bất kỳ quyền ghi nào cho vai trò này.
 */
export const isReadOnlyRole = (role?: string | null): boolean => role === "CEO";

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
  OWNED: "Hàng hoá của TVK",
  CONSIGNED: "Hàng được ký gửi",
};

export const PARTNER_KIND_LABELS: Record<string, string> = {
  RETAIL: "Khách lẻ",
  GARAGE: "Gara",
  TRANSPORT: "Vận tải",
  SHOP: "Cửa hàng",
  OTHER: "Khác",
};

/** Bậc giá áp dụng cho một khách hàng: lẻ / gara / đại lý. */
export type PriceTier = "retail" | "garage" | "wholesale";

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  retail: "Giá lẻ",
  garage: "Giá gara",
  wholesale: "Giá đại lý",
};

/** Gara thì giá gara, đối tác còn lại thì giá đại lý, khách lẻ (không có loại) thì giá lẻ. */
export function priceTierForKind(kind: string | null | undefined): PriceTier {
  if (!kind || kind === "RETAIL") return "retail";
  if (kind === "GARAGE") return "garage";
  return "wholesale";
}

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

export const MOVEMENT_KIND_LABELS: Record<string, string> = {
  IN_PURCHASE: "Nhập mua",
  IN_CONSIGNMENT: "Nhập ký gửi",
  IN_RETURN: "Nhập trả lại",
  OUT_SALE: "Xuất bán",
  OUT_CONSIGNMENT: "Xuất gửi ký gửi",
  OUT_RETURN_SUPPLIER: "Trả nhà cung cấp",
  TRANSFER: "Chuyển kho",
  ADJUSTMENT: "Điều chỉnh",
};

export const REF_DOC_TYPE_LABELS: Record<string, string> = {
  PURCHASE_RECEIPT: "Phiếu nhập kho",
  CONSIGNMENT_RECEIPT: "Phiếu nhận ký gửi",
  CONSIGNMENT_OUT: "Phiếu gửi ký gửi",
  SALES_DOCUMENT: "Chứng từ bán hàng",
  RETURN_DOCUMENT: "Phiếu trả hàng",
};
