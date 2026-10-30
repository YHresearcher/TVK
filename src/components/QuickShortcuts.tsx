import Link from "next/link";

/**
 * Hàng lối tắt theo vai trò, chỉ hiện trên màn hình nhỏ (dưới lg — cùng
 * ngưỡng với ngăn kéo điều hướng). Mỗi lối tắt trỏ vào một trang đã có;
 * không lối tắt nào mở thêm quyền — chặn quyền vẫn ở RLS và server.
 * "Quét mã vạch" và "Xuất kho" độc lập chưa tồn tại nên không có trong
 * danh sách này.
 */
const SHORTCUTS: Record<string, { label: string; href: string }[]> = {
  OWNER: [
    { label: "Bán hàng", href: "/sales" },
    { label: "Nhập kho", href: "/stock-in" },
    { label: "Gửi ký gửi", href: "/consignment-out" },
    { label: "Phải thu", href: "/receivables" },
    { label: "Báo cáo", href: "/reports" },
    { label: "Sổ cái kho", href: "/ledger" },
  ],
  SALES: [
    { label: "Nhập đơn bán", href: "/sales" },
    { label: "Tìm sản phẩm", href: "/products" },
    { label: "Kiểm tra tồn kho", href: "/inventory" },
    { label: "Đối tác", href: "/partners" },
  ],
  WAREHOUSE: [
    { label: "Nhập kho", href: "/stock-in" },
    { label: "Tồn kho theo lô", href: "/inventory" },
    { label: "Gửi ký gửi", href: "/consignment-out" },
    { label: "Sản phẩm", href: "/products" },
  ],
  ACCOUNTING: [
    { label: "Phải thu", href: "/receivables" },
    { label: "Phải trả", href: "/payables" },
    { label: "Hoá đơn GTGT", href: "/invoices" },
    { label: "Báo cáo", href: "/reports" },
  ],
  CEO: [
    { label: "Báo cáo", href: "/reports" },
    { label: "Sổ cái kho", href: "/ledger" },
    { label: "Phải thu", href: "/receivables" },
    { label: "Phải trả", href: "/payables" },
  ],
};

export default function QuickShortcuts({ role }: { role: string }) {
  const items = SHORTCUTS[role] ?? [];
  if (items.length === 0) return null;
  return (
    <nav aria-label="Lối tắt" className="mb-6 lg:hidden">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Lối tắt</p>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <Link
            key={item.href + item.label}
            href={item.href}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 shadow-sm"
          >
            {item.label}
            <span aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
