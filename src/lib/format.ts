/** Số tiền VNĐ: chỉ hiện số đã nhóm nghìn, không thêm hậu tố đơn vị. */
export function formatVND(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString("vi-VN");
}

/** Số tiền USD: ký hiệu $ ở phía trước (vd $100, $3.88). */
export function formatUSD(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatNumber(value: number | string | null | undefined): string {
  return Number(value ?? 0).toLocaleString("vi-VN");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("vi-VN");
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
