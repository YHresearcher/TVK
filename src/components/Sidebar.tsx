"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/lib/actions";

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
}

const TOP_ITEM: NavItem = { href: "/dashboard", label: "Tổng quan" };

const GROUPS: NavGroup[] = [
  {
    id: "hang-hoa-kho",
    title: "Hàng hoá & Kho",
    items: [
      { href: "/products", label: "Sản phẩm" },
      { href: "/inventory", label: "Tồn kho theo lô" },
      { href: "/stock-in", label: "Nhập kho" },
    ],
  },
  {
    id: "ky-gui",
    title: "Ký gửi",
    items: [
      { href: "/consignment-out", label: "Gửi ký gửi" },
      { href: "/partner-consumption", label: "Tiêu thụ của đối tác" },
    ],
  },
  {
    id: "ban-hang-hoa-don",
    title: "Bán hàng & Hoá đơn",
    items: [
      { href: "/sales", label: "Bán hàng" },
      { href: "/invoices", label: "Hoá đơn GTGT" },
      { href: "/returns", label: "Trả hàng & bảo hành" },
    ],
  },
  {
    id: "cong-no-bao-cao",
    title: "Công nợ & Báo cáo",
    items: [
      { href: "/payables", label: "Phải trả nhà cung cấp" },
      { href: "/receivables", label: "Phải thu đối tác" },
      { href: "/reports", label: "Báo cáo" },
    ],
  },
  {
    id: "danh-muc",
    title: "Danh mục",
    items: [
      { href: "/suppliers", label: "Nhà cung cấp" },
      { href: "/partners", label: "Đối tác" },
    ],
  },
];

const BOTTOM_ITEM: NavItem = { href: "/settings", label: "Cài đặt" };

const STORAGE_KEY = "tvk-nav-open-groups";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

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

  // Nhóm chứa trang đang xem luôn mở; các nhóm khác theo lựa chọn đã lưu
  // của người dùng (localStorage), mặc định đóng cho gọn.
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    currentGroup ? { [currentGroup]: true } : {}
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, boolean>;
        setOpen((prev) => {
          const next = { ...saved, ...prev };
          if (currentGroup) next[currentGroup] = true;
          return next;
        });
      }
    } catch {
      // Không đọc được localStorage: dùng trạng thái mặc định.
    }
    // Chỉ chạy một lần khi nạp thanh điều hướng.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!currentGroup) return;
    setOpen((prev) => (prev[currentGroup] ? prev : { ...prev, [currentGroup]: true }));
  }, [currentGroup]);

  function toggleGroup(id: string) {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Bỏ qua nếu trình duyệt chặn lưu trữ.
      }
      return next;
    });
  }

  const itemCls = (href: string) =>
    `block rounded-md px-3 py-2 text-sm ${
      isActive(pathname, href)
        ? "bg-blue-600 font-medium text-white"
        : "text-slate-300 hover:bg-slate-800 hover:text-white"
    }`;

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-200">
      <div className="border-b border-slate-700 px-5 py-4">
        <p className="text-lg font-bold tracking-wide text-white">TVK</p>
        <p className="text-xs text-slate-400">Quản lý kho phụ tùng</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          <li>
            <Link href={TOP_ITEM.href} className={itemCls(TOP_ITEM.href)}>
              {TOP_ITEM.label}
            </Link>
          </li>
        </ul>

        {GROUPS.map((group) => {
          const expanded = !!open[group.id];
          const containsActive = group.id === currentGroup;
          return (
            <div key={group.id} className="mt-3">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={expanded}
                className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${
                  containsActive
                    ? "text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>{group.title}</span>
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
                <ul className="mt-1 space-y-1 pl-2">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className={itemCls(item.href)}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        <ul className="mt-3 space-y-1 border-t border-slate-700 pt-3">
          <li>
            <Link href={BOTTOM_ITEM.href} className={itemCls(BOTTOM_ITEM.href)}>
              {BOTTOM_ITEM.label}
            </Link>
          </li>
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
