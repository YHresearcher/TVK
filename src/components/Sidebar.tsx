"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/lib/actions";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/products", label: "Products" },
  { href: "/inventory", label: "Inventory (by batch)" },
  { href: "/stock-in", label: "Stock In" },
  { href: "/consignment-out", label: "Consignment Out" },
  { href: "/sales", label: "Sales" },
  { href: "/partner-consumption", label: "Partner Consumption" },
  { href: "/invoices", label: "VAT Invoices" },
  { href: "/payables", label: "Payables (Suppliers)" },
  { href: "/receivables", label: "Receivables (Partners)" },
  { href: "/returns", label: "Returns & Warranty" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/partners", label: "Partners" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
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
        <p className="text-xs text-slate-400">Auto Parts Inventory</p>
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
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
