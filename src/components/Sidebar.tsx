"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/lib/actions";
import SubmitButton from "@/components/SubmitButton";

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  id: string;
  title: string;
  /** Màu chấm nhấn riêng cho từng nhóm. */
  dot: string;
  items: NavItem[];
}

const TOP_ITEM: NavItem = { href: "/dashboard", label: "Tổng quan" };

/** Mục đang chọn: xanh dương điện tử trên nền navy. */
const NAV_ACTIVE = "bg-blue-600 text-white shadow";

const GROUPS: NavGroup[] = [
  {
    id: "hang-hoa-kho",
    title: "Hàng hoá & Kho",
    dot: "bg-sky-500",
    items: [
      { href: "/products", label: "Sản phẩm" },
      { href: "/inventory", label: "Tồn kho theo lô" },
      { href: "/stock-in", label: "Nhập kho" },
    ],
  },
  {
    id: "ky-gui",
    title: "Ký gửi",
    dot: "bg-amber-500",
    items: [
      { href: "/consignment-out", label: "Gửi ký gửi" },
      { href: "/partner-consumption", label: "Tiêu thụ của đối tác" },
    ],
  },
  {
    id: "ban-hang-hoa-don",
    title: "Bán hàng & Hoá đơn",
    dot: "bg-emerald-500",
    items: [
      { href: "/sales", label: "Bán hàng" },
      { href: "/invoices", label: "Hoá đơn GTGT" },
      { href: "/returns", label: "Trả hàng & bảo hành" },
    ],
  },
  {
    id: "cong-no-bao-cao",
    title: "Công nợ & Báo cáo",
    dot: "bg-violet-500",
    items: [
      { href: "/payables", label: "Phải trả nhà cung cấp" },
      { href: "/receivables", label: "Phải thu đối tác" },
      { href: "/reports", label: "Báo cáo" },
    ],
  },
  {
    id: "danh-muc",
    title: "Danh mục",
    dot: "bg-rose-500",
    items: [
      { href: "/suppliers", label: "Nhà cung cấp" },
      { href: "/partners", label: "Đối tác" },
    ],
  },
];

const BOTTOM_ITEM: NavItem = { href: "/settings", label: "Cài đặt" };

const STORAGE_KEY = "tvk-nav-open-group";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Thanh trên cùng cho màn hình nhỏ — do layout (server component) render
 * tách khỏi Sidebar (client component). Nút hamburger phát sự kiện này để
 * Sidebar mở/đóng ngăn kéo điều hướng mà hai bên không cần dùng chung state.
 */
export const MOBILE_NAV_TOGGLE_EVENT = "tvk:toggle-mobile-nav";

function activeGroupId(pathname: string): string | null {
  for (const g of GROUPS) {
    if (g.items.some((i) => isActive(pathname, i.href))) return g.id;
  }
  return null;
}

export default function Sidebar({
  userName,
  role,
}: {
  userName: string;
  role: string;
}) {
  const pathname = usePathname();
  const currentGroup = activeGroupId(pathname);

  // Kiểu accordion: tại một thời điểm chỉ MỘT nhóm mở — mở nhóm khác thì
  // nhóm đang mở tự thu lại. Nhóm chứa trang đang xem tự mở khi chuyển
  // trang; lựa chọn mở/thu của người dùng được nhớ trong localStorage.
  const [openId, setOpenId] = useState<string | null>(currentGroup);

  useEffect(() => {
    if (currentGroup) return;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setOpenId(saved);
    } catch {
      // Không đọc được localStorage: dùng trạng thái mặc định.
    }
    // Chỉ chạy một lần khi nạp thanh điều hướng.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentGroup) setOpenId(currentGroup);
  }, [currentGroup]);

  // Ngăn kéo điều hướng trên màn hình nhỏ (< lg): mặc định đóng, mở bằng
  // nút hamburger trên thanh trên cùng (layout render). Chuyển trang thì
  // tự đóng; bấm phím Escape cũng đóng.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onToggle = () => setMobileOpen((v) => !v);
    window.addEventListener(MOBILE_NAV_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(MOBILE_NAV_TOGGLE_EVENT, onToggle);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  function toggleGroup(id: string) {
    setOpenId((prev) => {
      const next = prev === id ? null : id;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ?? "");
      } catch {
        // Bỏ qua nếu trình duyệt chặn lưu trữ.
      }
      return next;
    });
  }

  // Navy tối giản: chữ xám nhạt trên nền navy, mục đang chọn tô đặc
  // xanh dương điện tử — nhìn là biết đang ở đâu.
  const itemCls = (href: string) =>
    `block rounded-md px-3 py-2 text-sm ${
      isActive(pathname, href)
        ? `font-medium ${NAV_ACTIVE}`
        : "text-slate-300 hover:bg-white/10 hover:text-white"
    }`;

  return (
    <>
      {/* Lớp phủ tối sau ngăn kéo trên màn hình nhỏ — bấm vào để đóng. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col border-r border-slate-900 bg-slate-900 text-slate-300 transition-transform duration-300 lg:static lg:z-auto lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
      <div className="border-b border-white/10 px-5 py-4">
        <p className="text-lg font-bold tracking-wide text-white">TVK</p>
        <p className="text-xs text-slate-400">Quản lý kho phụ tùng</p>
      </div>
      <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        <div>
          <Link
            href={TOP_ITEM.href}
            className={itemCls(TOP_ITEM.href)}
            onClick={() => setMobileOpen(false)}
          >
            {TOP_ITEM.label}
          </Link>
        </div>

        {GROUPS.map((group) => {
          const expanded = openId === group.id;
          const containsActive = group.id === currentGroup;
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={expanded}
                className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${
                  containsActive
                    ? "text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${group.dot}`} />
                  {group.title}
                </span>
                <svg
                  className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {expanded && (
                <ul className="mt-1 space-y-1">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={itemCls(item.href)}
                        onClick={() => setMobileOpen(false)}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        <div>
          <Link
            href={BOTTOM_ITEM.href}
            className={itemCls(BOTTOM_ITEM.href)}
            onClick={() => setMobileOpen(false)}
          >
            {BOTTOM_ITEM.label}
          </Link>
        </div>
      </nav>
      <div className="border-t border-white/10 px-5 py-4">
        <p className="truncate text-sm font-medium text-white">{userName}</p>
        <p className="text-xs text-slate-400">{role}</p>
        <form action={signOutAction} className="mt-3">
          <SubmitButton
            className="w-full rounded-md border border-white/20 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
          >
            Đăng xuất
          </SubmitButton>
        </form>
        <div className="mt-4 border-t border-white/10 pt-3 text-center">
          <p className="text-[11px] text-slate-500">TVK management system by Thanh Phan</p>
          <p className="mt-0.5 text-[11px] text-slate-500">version 1.0</p>
        </div>
      </div>
      </aside>
    </>
  );
}
