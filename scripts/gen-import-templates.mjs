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
    // DonGiaVND để trống = giá đại lý của sản phẩm (dòng 1); ghi số =
    // bán đúng giá đó (dòng 2). Mã hàng là SKU thật đã đăng ký — hệ
    // thống tự phân bổ FIFO theo lô, không nhập mã lô.
    file: "public/mau-import-ban-dai-ly.xlsx",
    rows: [
      ["MaHang", "SoLuong", "DonGiaVND"],
      ["AZ1664430120-SMS-30759", 10, ""],
      ["AZ1664440069-SMS-30705", 5, 1200000],
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
