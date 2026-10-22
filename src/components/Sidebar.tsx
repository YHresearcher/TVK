"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/lib/actions";

const NAV = [
  { href: "/dashboard", label: "Tổng quan" },
  { href: "/products", label: "Sản phẩm" },
  { href: "/inventory", label: "Tồn kho theo lô" },
  { href: "/stock-in", label: "Nhập kho" },
  { href: "/import", label: "Nhập từ Excel" },
  { href: "/consignment-out", label: "Gửi ký gửi" },
  { href: "/sales", label: "Bán hàng" },
  { href: "/partner-consumption", label: "Tiêu thụ của đối tác" },
  { href: "/invoices", label: "Hoá đơn GTGT" },
  { href: "/payables", label: "Phải trả nhà cung cấp" },
  { href: "/receivables", label: "Phải thu đối tác" },
  { href: "/returns", label: "Trả hàng & bảo hành" },
  { href: "/suppliers", label: "Nhà cung cấp" },
  { href: "/partners", label: "Đối tác" },
  { href: "/reports", label: "Báo cáo" },
  { href: "/settings", label: "Cài đặt" },
];

export default function Sidebar({
  userName,
  role,
}: {
  userName: string;
  role: string;
}) {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-200">
      <div className="border-b border-slate-700 px-5 py-4">
        <p className="text-lg font-bold tracking-wide text-white">TVK</p>
        <p className="text-xs text-slate-400">Quản lý kho phụ tùng</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-md px-3 py-2 text-sm ${
                    active
                      ? "bg-blue-600 font-medium text-white"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-slate-700 px-5 py-4">
        <p className="truncate text-sm font-medium text-white">{userName}</p>
        <p className="text-xs text-slate-400">{role}</p>
        <form action={signOutAction} className="mt-3">
          <button
            type="submit"
            className="w-full rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            Đăng xuất
          </button>
        </form>
      </div>
    </aside>
  );
}
