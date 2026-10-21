import Link from "next/link";
import type { ReactNode } from "react";

export const inputCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white";
export const labelCls = "block text-xs font-medium text-slate-600 mb-1";
export const btnCls =
  "inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";
export const btnGhostCls =
  "inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50";
export const thCls =
  "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
export const tdCls = "px-3 py-2 text-sm text-slate-700";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {title && (
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
          {title}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function NotConfigured() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
      <p className="font-semibold">Supabase is not configured yet.</p>
      <p className="mt-1">
        Create a Supabase project, run the SQL files in{" "}
        <code className="rounded bg-amber-100 px-1">supabase/migrations/</code> (in
        order 0001 → 0002 → 0003), then set{" "}
        <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
        and{" "}
        <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
        in <code className="rounded bg-amber-100 px-1">.env.local</code> and restart
        the app. See <code className="rounded bg-amber-100 px-1">supabase/README.md</code>.
      </p>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="py-6 text-center text-sm text-slate-400">{message}</p>;
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-600",
    CONFIRMED: "bg-green-100 text-green-700",
    CANCELLED: "bg-red-100 text-red-700",
    ISSUED: "bg-green-100 text-green-700",
    UNPAID: "bg-red-100 text-red-700",
    PARTIAL: "bg-amber-100 text-amber-700",
    PAID: "bg-green-100 text-green-700",
    ACTIVE: "bg-green-100 text-green-700",
    DEPLETED: "bg-slate-100 text-slate-500",
    NOT_INVOICED: "bg-amber-100 text-amber-700",
    INVOICED: "bg-green-100 text-green-700",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-slate-100 text-slate-600"}`}
    >
      {status}
    </span>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm text-blue-600 hover:underline">
      ← {label}
    </Link>
  );
}
