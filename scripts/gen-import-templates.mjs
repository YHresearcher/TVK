// Generates the Excel import templates for consignment-out (GK),
// consumption reports (BT) and allocations (PB). Run: node scripts/gen-import-templates.mjs
// Example rows mirror the stock-in template style: realistic values the user
// replaces with their own rows (each import card tells them to delete them).
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";

const templates = [
  {
    file: "public/mau-import-gui-ky-gui.xlsx",
    rows: [
      ["MaLo", "SoLuong", "DieuKhoan", "GiaChuyenGiaoVND"],
      ["OWN-2610-0001", 10, "Ký gửi", 500000],
      ["OWN-2610-0002", 5, "Mua đứt", 1200000],
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
    // STT chỉ để đếm. Khớp hàng theo tên + dòng xe (dòng xe để trống
    // thì khớp theo tên). Đơn giá để trống = giá theo loại khách chọn ở
    // form (dòng 1); ghi số = bán đúng giá đó (dòng 2). Tên hàng và
    // dòng xe là giá trị thật đã đăng ký — hệ thống tự phân bổ FIFO
    // theo lô, không nhập mã hàng hay mã lô.
    file: "public/mau-import-ban-dai-ly.xlsx",
    rows: [
      ["STT", "Dòng xe", "Tên phụ tùng", "Số lượng", "Đơn giá"],
      [1, "420", "Bầu hơi cabin trước", 10, ""],
      [2, "420", "Bầu hơi cabin sau", 5, 1200000],
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
