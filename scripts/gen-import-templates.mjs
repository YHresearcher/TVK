// Generates the Excel import templates for consignment-out (GK),
// consumption reports (BT) and allocations (PB). Run: node scripts/gen-import-templates.mjs
// Example rows mirror the stock-in template style: realistic values the user
// replaces with their own rows (each import card tells them to delete them).
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";

const templates = [
  {
    // Cùng chuẩn như file bán hàng: khớp theo tên + dòng xe, mã hàng
    // tùy chọn (chỉ cần khi tên trùng); không nhập mã lô — hệ thống
    // tự phân bổ FIFO. Hai dòng "Lọc dầu" giữ mã để minh hoạ trường
    // hợp tên trùng nhau.
    file: "public/mau-import-gui-ky-gui.xlsx",
    rows: [
      ["STT", "Mã hàng", "Dòng xe", "Tên phụ tùng", "Số lượng", "Điều khoản", "Giá chuyển giao VND"],
      [1, "", "420", "Bầu hơi cabin trước", 2, "Ký gửi", ""],
      [2, "", "420", "Bầu hơi cabin sau", 2, "Ký gửi", 1200000],
      [3, "VG1540080110-CX1020 SMS-10452", "420", "Lọc dầu", 10, "Ký gửi", ""],
      [4, "WG1540080211-CX1017 SMS10453", "420", "Lọc dầu", 5, "Mua đứt", 1200000],
    ],
  },
  {
    // Example codes are REAL registered codes (from the live catalog):
    // short illustrative codes do NOT resolve — the real SKUs carry the
    // -SMS-xxxxx suffix, e.g. VG1246060108-SMS-10636, not VG1246060108.
    file: "public/mau-import-bao-cao-tieu-thu.xlsx",
    rows: [
      ["MaHang", "SoLuongTieuThu"],
      ["AZ1664430120-SMS-30759", 5],
      ["AZ1664440069-SMS-30705", 20],
    ],
  },
  {
    file: "public/mau-import-phan-bo.xlsx",
    rows: [
      ["MaHang", "MaLo", "NguonHang", "SoLuong", "DonGiaVND"],
      ["AZ1664430120-SMS-30759", "OWN-2610-0001", "Ký gửi", 5, 1500000],
      ["AZ1664440069-SMS-30705", "OWN-2610-0002", "Mua đứt", 10, 800000],
    ],
  },
  {
    // STT chỉ để đếm. Khớp hàng theo MÃ HÀNG — tên trùng nhau cũng
    // không sao vì mã khác nhau là món khác nhau (hai dòng "Lọc dầu"
    // dưới đây là ví dụ thật từ danh mục: cùng tên, cùng dòng xe, khác
    // mã). Đơn giá để trống = giá theo loại khách chọn ở form (dòng 1);
    // ghi số = bán đúng giá đó (dòng 2). Hệ thống tự phân bổ FIFO
    // theo lô, không nhập mã lô.
    file: "public/mau-import-ban-dai-ly.xlsx",
    rows: [
      ["STT", "Mã hàng", "Dòng xe", "Tên phụ tùng", "Số lượng", "Đơn giá"],
      [1, "AZ1664430120-SMS-30759", "420", "Bầu hơi cabin trước", 10, ""],
      [2, "AZ1664440069-SMS-30705", "420", "Bầu hơi cabin sau", 5, 1200000],
      [3, "VG1540080110-CX1020 SMS-10452", "420", "Lọc dầu", 10, ""],
      [4, "WG1540080211-CX1017 SMS10453", "420", "Lọc dầu", 5, 1200000],
    ],
  },
];

for (const t of templates) {
  const ws = XLSX.utils.aoa_to_sheet(t.rows);
  ws["!cols"] = t.rows[0].map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, t.file);
  console.log("wrote", t.file);
}
