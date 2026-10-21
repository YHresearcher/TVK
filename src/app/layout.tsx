import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TVK — Auto Parts Inventory",
  description:
    "Inventory management for an auto parts store: owned & consigned stock, two-way consignment, allocation-based invoicing.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
