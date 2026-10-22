import { redirect } from "next/navigation";

// Nhập từ Excel đã gộp vào trang Nhập kho (nút “Nhập từ Excel”).
// Giữ route này để các liên kết cũ tự chuyển tới đúng vị trí mới.
export default function ImportPage() {
  redirect("/stock-in?tab=import");
}
