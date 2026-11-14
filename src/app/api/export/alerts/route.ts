import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getExecutiveAlerts } from "@/lib/audit";
import { todayISO } from "@/lib/format";
import { getCurrentProfile } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getCurrentProfile();
  const role = profile.data?.role ?? "";
  const canAccess = ["OWNER", "ACCOUNTING", "CEO"].includes(role);

  if (!canAccess) {
    return NextResponse.json(
      { error: "Bạn không có quyền truy cập báo cáo sai lệch điều hành." },
      { status: 403 }
    );
  }

  const result = await getExecutiveAlerts();
  if (!result.configured) {
    return NextResponse.json({ error: "Cơ sở dữ liệu chưa được cấu hình" }, { status: 503 });
  }

  const rows = result.excelRows;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [
    {
      "Thời gian": todayISO(),
      "Loại cảnh báo": "XANH (Bình thường)",
      "Đối tác/NCC": "—",
      "Mã chứng từ/Lô hàng": "—",
      "Số lượng/Số tiền chênh lệch": "0",
      "Lý do cảnh báo": "Không có cảnh báo sai lệch nào tại thời điểm kiểm tra.",
    }
  ]);

  // Thiết lập độ rộng cột trực quan dễ đọc
  ws["!cols"] = [
    { wch: 14 }, // Thời gian
    { wch: 18 }, // Loại cảnh báo
    { wch: 28 }, // Đối tác/NCC
    { wch: 24 }, // Mã chứng từ/Lô hàng
    { wch: 26 }, // Số lượng/Số tiền chênh lệch
    { wch: 65 }, // Lý do cảnh báo
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Danh sách sai lệch");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `TVK_Danh_sach_sai_lech_${todayISO()}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
