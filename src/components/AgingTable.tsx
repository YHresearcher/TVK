import { Card, TableWrap, tdCls, thCls } from "@/components/ui";
import { formatVND } from "@/lib/format";
import { AGING_BAND_LABELS, type AgingRow } from "@/lib/aging";

export default function AgingTable({
  title,
  partyLabel,
  rows,
}: {
  title: string;
  partyLabel: string;
  rows: AgingRow[];
}) {
  if (rows.length === 0) return null;
  const totals = rows.reduce(
    (a, r) => ({
      notDue: a.notDue + r.notDue,
      band1: a.band1 + r.band1,
      band2: a.band2 + r.band2,
      band3: a.band3 + r.band3,
      over6: a.over6 + r.over6,
      total: a.total + r.total,
    }),
    { notDue: 0, band1: 0, band2: 0, band3: 0, over6: 0, total: 0 },
  );
  const money = (v: number) => (v === 0 ? "—" : formatVND(v));
  return (
    <Card title={title}>
      <TableWrap>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className={thCls}>{partyLabel}</th>
              {AGING_BAND_LABELS.map((label) => (
                <th key={label} className={`${thCls} text-right`}>
                  {label}
                </th>
              ))}
              <th className={`${thCls} text-right`}>Tổng còn nợ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.partyId} className="border-t border-slate-100">
                <td className={tdCls}>{r.partyName}</td>
                <td className={`${tdCls} text-right`}>{money(r.notDue)}</td>
                <td className={`${tdCls} text-right`}>{money(r.band1)}</td>
                <td className={`${tdCls} text-right`}>{money(r.band2)}</td>
                <td className={`${tdCls} text-right`}>{money(r.band3)}</td>
                <td className={`${tdCls} text-right`}>{money(r.over6)}</td>
                <td className={`${tdCls} text-right font-medium`}>{formatVND(r.total)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 font-medium">
              <td className={tdCls}>Tổng cộng</td>
              <td className={`${tdCls} text-right`}>{money(totals.notDue)}</td>
              <td className={`${tdCls} text-right`}>{money(totals.band1)}</td>
              <td className={`${tdCls} text-right`}>{money(totals.band2)}</td>
              <td className={`${tdCls} text-right`}>{money(totals.band3)}</td>
              <td className={`${tdCls} text-right`}>{money(totals.over6)}</td>
              <td className={`${tdCls} text-right`}>{formatVND(totals.total)}</td>
            </tr>
          </tbody>
        </table>
      </TableWrap>
      <p className="mt-2 text-xs text-slate-500">
        Nhóm tuổi tính từ ngày quá hạn: 1–2 tháng = quá hạn 1–60 ngày; 3–4 tháng = 61–120 ngày; 5–6 tháng = 121–180 ngày; trên 6
        tháng = quá hạn trên 180 ngày. Khoản chưa đặt hạn thu/trả được xếp vào cột Chưa đến hạn.
      </p>
    </Card>
  );
}
