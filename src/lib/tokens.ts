/**
 * Semantic Color Tokens theo chuẩn Dashboard v1.1
 * Phân tách rõ ràng giữa Giá vốn (cogs) và Hàng nhận ký gửi (supplierConsignment)
 */
export const SEMANTIC_COLORS = {
  // Doanh thu thuần & Bán hàng (Blue)
  revenue: "#2563EB",

  // Lợi nhuận gộp & Biên lợi nhuận (Emerald)
  profit: "#10B981",

  // Giá vốn hàng bán (Amber)
  cogs: "#F59E0B",

  // Công nợ phải thu đối tác / gara (Violet)
  receivable: "#8B5CF6",

  // Hàng TVK gửi tại đối tác (Cyan / Sky-500)
  partnerInventory: "#0EA5E9",

  // Hàng NCC ký gửi TVK nhận giữ (Sky-600 #0284C7 - tách biệt rõ ràng khỏi cogs #F59E0B)
  supplierConsignment: "#0284C7",

  // Cảnh báo rủi ro cao / Nợ quá hạn / Nguy cơ thiếu hụt (Red)
  danger: "#EF4444",

  // Cảnh báo vận hành / Nhắc nhở (Orange)
  warning: "#F97316",

  // Thông tin trung tính / Nhãn phụ (Slate)
  neutral: "#64748B",

  // Nền trang & Nền thẻ
  background: "#F8FAFC",
  surface: "#FFFFFF",
  border: "#E2E8F0",
} as const;

export type SemanticColorToken = keyof typeof SEMANTIC_COLORS;
