"use client";

/** Nút tải bảng đang hiện trên trang xuống file .xlsx — dữ liệu lấy đúng
 * các dòng server đã tải cho trang, không gọi thêm, không mở rộng quyền
 * xem: ai thấy bảng thì mới thấy nút này. Thư viện xlsx chỉ tải khi bấm. */
export default function ExportExcelButton({
  filename,
  rows,
}: {
  filename: string;
  rows: Record<string, string | number>[];
}) {
  async function download() {
    if (!rows.length) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0]).map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, filename);
  }
  return (
    <button type="button" onClick={download} className="text-sm font-medium text-blue-600 hover:underline">
      Xuất Excel
    </button>
  );
}
