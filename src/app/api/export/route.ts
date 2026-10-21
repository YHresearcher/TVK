import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_VIEWS = new Set([
  "v_supplier_consignment",
  "v_partner_consignment",
  "v_product_stock",
  "v_batch_stock",
  "v_consumption_progress",
]);

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n");
}

export async function GET(request: NextRequest) {
  const view = request.nextUrl.searchParams.get("view") ?? "";
  if (!ALLOWED_VIEWS.has(view)) {
    return NextResponse.json({ error: "View not allowed" }, { status: 400 });
  }
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const { data, error } = await supabase.from(view).select("*").limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const csv = toCsv((data ?? []) as Record<string, unknown>[]);
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${view}.csv"`,
    },
  });
}
