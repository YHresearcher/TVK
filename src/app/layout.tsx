import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TVK — Quản lý kho phụ tùng ô tô",
  description:
    "Quản lý kho cho cửa hàng phụ tùng ô tô: hàng của mình và hàng ký gửi, ký gửi hai chiều, xuất hoá đơn theo phân bổ.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
