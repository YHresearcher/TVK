import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBusinessLineContext } from "@/lib/business-lines";

const ALLOWED_VIEWS = new Set([
  "v_supplier_consignment",
  "v_partner_consignment",
  "v_product_stock",
  "v_batch_stock",
  "v_consumption_progress",
]);

/** Các view có cột business_line_id nên lọc được theo ngành (§18.6). */
const LINE_FILTERABLE_VIEWS = new Set(["v_product_stock", "v_batch_stock"]);

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
    return NextResponse.json({ error: "Không được phép xem báo cáo này" }, { status: 400 });
  }
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Hệ thống chưa cài đặt xong — hãy báo chủ cửa hàng." }, { status: 503 });
  }
  // P2 §18.6: xuất theo ngành (?line=OIL | AUTO_PARTS | ALL, mặc định
  // ALL). Chỉ lọc được trên view có cột business_line_id; các view đối
  // soát ký gửi gộp nhiều ngành nên luôn xuất hợp nhất (quy chiếu theo
  // ngành là việc của P5). Ngành yêu cầu phải nằm trong quyền của user.
  const ctx = await getBusinessLineContext();
  if (ctx.mode === "NONE") {
    return NextResponse.json({ error: "Tài khoản chưa được gán ngành hàng." }, { status: 403 });
  }
  const lineParam = (request.nextUrl.searchParams.get("line") ?? "ALL").toUpperCase();
  let lineId: string | null = null;
  if (lineParam !== "ALL") {
    const { data: line } = await supabase
      .from("business_lines")
      .select("id, code")
      .eq("code", lineParam)
      .eq("is_active", true)
      .maybeSingle();
    if (!line) {
      return NextResponse.json({ error: `Ngành hàng "${lineParam}" không tồn tại hoặc đang tắt.` }, { status: 400 });
    }
    if (ctx.mode === "LINE" && line.id !== ctx.lineId) {
      return NextResponse.json({ error: "Không được xuất dữ liệu ngành khác." }, { status: 403 });
    }
    lineId = line.id as string;
  }
  let q = supabase.from(view).select("*").limit(5000);
  if (lineId && LINE_FILTERABLE_VIEWS.has(view)) {
    q = q.eq("business_line_id", lineId);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const csv = toCsv((data ?? []) as Record<string, unknown>[]);
  const fileName = lineId ? `${view}-${lineParam.toLowerCase()}.csv` : `${view}.csv`;
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
