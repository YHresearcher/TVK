import { todayISO } from "@/lib/format";

/** Một dòng tuổi nợ đã gom theo từng đối tác / nhà cung cấp. Số tiền là phần còn phải thu/trả. */
export interface AgingRow {
  partyId: string;
  partyName: string;
  notDue: number;
  band1: number;
  band2: number;
  band3: number;
  over6: number;
  total: number;
}

export const AGING_BAND_LABELS = [
  "Chưa đến hạn",
  "Quá hạn 1–2 tháng",
  "Quá hạn 3–4 tháng",
  "Quá hạn 5–6 tháng",
  "Quá hạn trên 6 tháng",
] as const;

/** Số ngày quá hạn (âm = chưa đến hạn). Tính theo ngày, không theo giờ. */
function daysOverdue(dueDate: string | null, today: string): number {
  if (!dueDate) return -1;
  const due = Date.UTC(Number(dueDate.slice(0, 4)), Number(dueDate.slice(5, 7)) - 1, Number(dueDate.slice(8, 10)));
  const now = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return Math.floor((now - due) / 86400000);
}

export function buildAging(
  rows: { partyId: string; due_date: string | null; amount: number | string; amount_paid: number | string }[],
  nameMap: Map<string, string>,
): AgingRow[] {
  const today = todayISO();
  const byParty = new Map<string, AgingRow>();
  for (const r of rows) {
    const remaining = Number(r.amount) - Number(r.amount_paid);
    if (remaining <= 0) continue;
    let row = byParty.get(r.partyId);
    if (!row) {
      row = { partyId: r.partyId, partyName: nameMap.get(r.partyId) ?? "—", notDue: 0, band1: 0, band2: 0, band3: 0, over6: 0, total: 0 };
      byParty.set(r.partyId, row);
    }
    const overdue = daysOverdue(r.due_date, today);
    if (overdue <= 0) row.notDue += remaining;
    else if (overdue <= 60) row.band1 += remaining;
    else if (overdue <= 120) row.band2 += remaining;
    else if (overdue <= 180) row.band3 += remaining;
    else row.over6 += remaining;
    row.total += remaining;
  }
  return Array.from(byParty.values()).sort((a, b) => b.total - a.total);
}
