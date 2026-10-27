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
    file: "public/mau-import-bao-cao-tieu-thu.xlsx",
    rows: [
      ["MaHang", "SoLuongTieuThu"],
      ["VG1246060108", 5],
      ["611600080113", 20],
    ],
  },
  {
    file: "public/mau-import-phan-bo.xlsx",
    rows: [
      ["MaHang", "MaLo", "NguonHang", "SoLuong", "DonGiaVND"],
      ["VG1246060108", "OWN-2610-0001", "Ký gửi", 5, 1500000],
      ["611600080113", "OWN-2610-0002", "Mua đứt", 10, 800000],
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
