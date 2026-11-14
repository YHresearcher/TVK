import { BackLink, Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import { confirmAllocationAction, confirmAndIssueVatInvoiceAction, createAllocationDocumentsAction } from "@/lib/actions";
import { getAllocationDetail, getCurrentProfile, listProducts } from "@/lib/queries";
import { formatNumber, formatVND } from "@/lib/format";
import { NATURE_LABELS, isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AllocationDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { ok?: string };
}) {
  const [detail, products, profile] = await Promise.all([getAllocationDetail(params.id), listProducts(), getCurrentProfile()]);
  if (!detail.configured) return (<><PageHeader title="Phân bổ" /><NotConfigured /></>);
  if (!detail.slip) return (<><BackLink href="/partner-consumption" label="Quay lại" /><EmptyState message="Không tìm thấy phiếu phân bổ." /></>);
  const slip = detail.slip;
  const readOnly = isReadOnlyRole(profile.data?.role);
  const productName = new Map(products.data.map((p) => [p.id, `${p.sku} — ${p.name}`]));
  const documented = new Set(detail.documentedLineIds);
  const pendingCount = detail.lines.filter((l) => !documented.has(l.id)).length;
  const hasUninvoiced = detail.lines.some((l) => l.invoice_status !== "INVOICED");

  return (
    <>
      <BackLink href="/partner-consumption" label="Quay lại Tiêu thụ của đối tác" />
      <PageHeader
        title={`Phân bổ ${slip.doc_code}`}
        description="Mỗi dòng gán một lượng đã tiêu thụ vào đúng một lô và một tính chất nguồn. Chứng từ (BH/KG) được tạo từ các dòng này — không bao giờ nhập lại trên hoá đơn."
        action={<StatusBadge status={slip.status} />}
      />
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      <Card title="Các dòng">
        {detail.lines.length === 0 ? <EmptyState message="Chưa có dòng nào." /> : (
          <TableWrap>
            <thead>
              <tr>
                <th className={thCls}>Sản phẩm</th>
                <th className={thCls}>Tính chất</th>
                <th className={`${thCls} text-right`}>Số lượng</th>
                <th className={`${thCls} text-right`}>Đơn giá</th>
                <th className={`${thCls} text-right`}>Thành tiền</th>
                <th className={thCls}>Chứng từ</th>
                <th className={thCls}>Trạng thái hoá đơn</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                  <td className={tdCls}>{productName.get(l.product_id) ?? l.product_id}</td>
                  <td className={tdCls}>{NATURE_LABELS[l.nature] ?? l.nature}</td>
                  <td className={`${tdCls} text-right font-mono`}>{formatNumber(l.qty)}</td>
                  <td className={`${tdCls} text-right font-mono`}>{formatVND(l.unit_price)}</td>
                  <td className={`${tdCls} text-right font-mono font-medium text-slate-900`}>{formatVND(Number(l.qty) * Number(l.unit_price))}</td>
                  <td className={tdCls}>{documented.has(l.id) ? "Đã tạo" : "Chờ tạo"}</td>
                  <td className={tdCls}><StatusBadge status={l.invoice_status} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!readOnly && hasUninvoiced && (
            <form action={confirmAndIssueVatInvoiceAction}>
              <input type="hidden" name="id" value={slip.id} />
              <SubmitButton className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                ⚡ Xác nhận &amp; Xuất Hoá đơn GTGT (1-Click)
              </SubmitButton>
            </form>
          )}
          {!readOnly && slip.status === "DRAFT" && (
            <form action={confirmAllocationAction}>
              <input type="hidden" name="id" value={slip.id} />
              <SubmitButton className={btnCls}>Xác nhận phân bổ (kiểm tra 3 chốt)</SubmitButton>
            </form>
          )}
          {!readOnly && slip.status === "CONFIRMED" && pendingCount > 0 && (
            <form action={createAllocationDocumentsAction}>
              <input type="hidden" name="id" value={slip.id} />
              <SubmitButton className={btnCls}>
                Tạo chứng từ BH/KG cho {pendingCount} dòng đang chờ
              </SubmitButton>
            </form>
          )}
          {slip.status === "CONFIRMED" && !hasUninvoiced && (
            <p className="text-sm text-emerald-600 font-medium">Mọi dòng đều đã có chứng từ BH/KG và đã xuất Hoá đơn GTGT.</p>
          )}
          <a href="/invoices" className={btnGhostCls}>Đi tới Hoá đơn GTGT (theo dõi nội bộ)</a>
        </div>
      </Card>
    </>
  );
}
