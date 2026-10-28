import Link from "next/link";
import { Card, EmptyState, PageHeader, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { listLedgerMovements } from "@/lib/queries";
import { formatNumber } from "@/lib/format";
import { MOVEMENT_KIND_LABELS, REF_DOC_TYPE_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export default async function LedgerPage({ searchParams }: { searchParams: { q?: string; kind?: string } }) {
  const ledger = await listLedgerMovements(200);
  let rows = ledger.data;
  const q = (searchParams.q ?? "").trim();
  if (q) {
    const needle = fold(q);
    rows = rows.filter((r) =>
      fold(
        [r.sku, r.product_name, r.batch_code, r.from_name ?? "", r.to_name ?? "", r.created_by_name ?? ""].join(" "),
      ).includes(needle),
    );
  }
  if (searchParams.kind) rows = rows.filter((r) => r.movement_kind === searchParams.kind);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sổ cái kho"
        description="Mọi lần hàng vào, ra, chuyển kho, gửi ký gửi hay bán hàng đều để lại một bút toán. Sổ cái chỉ ghi thêm, không sửa, không xoá."
      />
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label className={labelCls} htmlFor="q">
              Tìm theo mã hàng, tên, lô, kho, người làm
            </label>
            <input id="q" name="q" defaultValue={q} className={inputCls} placeholder="VD: AZ1664440069, Bầu hơi, Kho TVK…" />
          </div>
          <div>
            <label className={labelCls} htmlFor="kind">
              Loại bút toán
            </label>
            <select id="kind" name="kind" defaultValue={searchParams.kind ?? ""} className={inputCls}>
              <option value="">Tất cả loại</option>
              {Object.entries(MOVEMENT_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={btnCls}>
            Tìm kiếm
          </button>
          {(q || searchParams.kind) && (
            <Link href="/ledger" className={btnCls}>
              Xoá lọc
            </Link>
          )}
        </form>
      </Card>
      <Card title={`200 bút toán mới nhất${rows.length < 200 ? ` — đang hiện ${rows.length}` : ""}`}>
        {rows.length === 0 ? (
          <EmptyState message="Chưa có bút toán nào. Bút toán xuất hiện khi một chứng từ được xác nhận." />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className={thCls}>Thời gian</th>
                  <th className={thCls}>Loại</th>
                  <th className={thCls}>Sản phẩm</th>
                  <th className={thCls}>Lô</th>
                  <th className={thCls}>Từ</th>
                  <th className={thCls}>Đến</th>
                  <th className={`${thCls} text-right`}>Số lượng</th>
                  <th className={thCls}>Chứng từ</th>
                  <th className={thCls}>Người làm</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className={`${tdCls} whitespace-nowrap`}>
                      {new Date(r.created_at).toLocaleString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className={tdCls}>
                      {MOVEMENT_KIND_LABELS[r.movement_kind] ?? r.movement_kind}
                      {r.reversal_of_id && <div className="text-xs text-slate-500">Đảo bút toán trước</div>}
                    </td>
                    <td className={tdCls}>
                      <div className="font-medium">{r.product_name}</div>
                      <div className="text-xs text-slate-500">{r.sku}</div>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>{r.batch_code}</td>
                    <td className={tdCls}>{r.from_name ?? "Ngoài hệ thống"}</td>
                    <td className={tdCls}>{r.to_name ?? "Ra khỏi hệ thống"}</td>
                    <td className={`${tdCls} text-right font-medium`}>{formatNumber(r.qty)}</td>
                    <td className={tdCls}>{r.ref_doc_type ? (REF_DOC_TYPE_LABELS[r.ref_doc_type] ?? r.ref_doc_type) : "—"}</td>
                    <td className={tdCls}>{r.created_by_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
