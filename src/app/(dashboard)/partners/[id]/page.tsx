import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, tdCls, thCls } from "@/components/ui";
import { getPartnerDetail } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { PARTNER_KIND_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

function StatBox({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

export default async function PartnerDetailPage({ params }: { params: { id: string } }) {
  const detail = await getPartnerDetail(params.id);
  const { partner, consignment, receivables, invoices, stats } = detail.data;

  if (!detail.configured) {
    return (
      <>
        <PageHeader title="Chi tiết đối tác" description="Hồ sơ và thống kê của đối tác." />
        <NotConfigured />
      </>
    );
  }
  if (!partner) {
    return (
      <>
        <PageHeader title="Chi tiết đối tác" description="Hồ sơ và thống kê của đối tác." />
        <EmptyState message="Không tìm thấy đối tác." />
        <p className="mt-4 text-sm"><Link href="/partners" className="font-medium text-blue-700 hover:underline">← Quay lại danh sách đối tác</Link></p>
      </>
    );
  }

  const sent = Number(consignment?.qty_sent ?? 0);
  const consumed = Number(consignment?.qty_consumed ?? 0);
  const returned = Number(consignment?.qty_returned ?? 0);
  const still = Number(consignment?.qty_still_at_partner ?? 0);
  const balanced = sent === consumed + returned + still;

  return (
    <>
      <PageHeader title={partner.name} description="Hồ sơ và thống kê của đối tác — bấm tên đối tác ở bất kỳ bảng nào để mở trang này." />
      <p className="mb-4 text-sm"><Link href="/partners" className="font-medium text-blue-700 hover:underline">← Quay lại danh sách đối tác</Link></p>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatBox label="Số dư còn phải thu" value={formatVND(stats.outstanding)} sub="Đối tác còn nợ chúng ta" />
        <StatBox label="Đã thanh toán" value={formatVND(stats.totalPaid)} sub="Tổng tiền đã thu" />
        <StatBox label="Hoá đơn đã xuất" value={formatNumber(stats.invoiceCount)} sub="Hoá đơn đang hiệu lực" />
        <StatBox label="Giá trị hoá đơn" value={formatVND(stats.invoiceTotal)} sub="Tổng tiền hoá đơn đang hiệu lực" />
        <StatBox label="Hàng còn ở đối tác" value={formatNumber(stats.stillAtPartner)} sub="Số cái đang ở chỗ đối tác" />
      </div>

      <div className="space-y-6">
        <Card title="Hồ sơ đối tác">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-slate-500">Loại</dt><dd className="font-medium">{PARTNER_KIND_LABELS[partner.partner_kind] ?? partner.partner_kind}</dd></div>
            <div><dt className="text-slate-500">Người liên hệ</dt><dd className="font-medium">{partner.contact_name ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Điện thoại</dt><dd className="font-medium">{partner.phone ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Email</dt><dd className="font-medium">{partner.email ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Mã số thuế</dt><dd className="font-medium">{partner.tax_code ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Địa chỉ</dt><dd className="font-medium">{partner.address ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Số ngày thanh toán</dt><dd className="font-medium">{partner.payment_days}</dd></div>
            <div><dt className="text-slate-500">Hạn mức tín dụng</dt><dd className="font-medium">{formatVND(partner.credit_limit)}</dd></div>
            <div><dt className="text-slate-500">Hạn mức ký gửi</dt><dd className="font-medium">{formatVND(partner.consignment_limit)}</dd></div>
          </dl>
          {partner.notes && <p className="mt-3 text-sm text-slate-600">Ghi chú: {partner.notes}</p>}
        </Card>

        <Card title="Đối soát ký gửi — đã gửi = đã tiêu thụ + đã trả + còn giữ">
          <TableWrap>
            <thead><tr><th className={thCls}>Đã gửi</th><th className={thCls}>Đã tiêu thụ</th><th className={thCls}>Đã trả</th><th className={thCls}>Còn giữ</th><th className={thCls}>Kiểm tra</th></tr></thead>
            <tbody>
              <tr className="border-t border-slate-100">
                <td className={tdCls}>{formatNumber(sent)}</td>
                <td className={tdCls}>{formatNumber(consumed)}</td>
                <td className={tdCls}>{formatNumber(returned)}</td>
                <td className={tdCls}>{formatNumber(still)}</td>
                <td className={`${tdCls} ${balanced ? "text-green-600" : "font-semibold text-red-600"}`}>{balanced ? "Khớp" : "LỆCH"}</td>
              </tr>
            </tbody>
          </TableWrap>
        </Card>

        <Card title="Khoản phải thu">
          {receivables.length === 0 ? <EmptyState message="Chưa có khoản phải thu." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Số tiền</th><th className={thCls}>Đã thu</th><th className={thCls}>Còn phải thu</th><th className={thCls}>Hạn thu</th><th className={thCls}>Trạng thái</th></tr></thead>
              <tbody>
                {receivables.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className={tdCls}>{formatVND(r.amount)}</td>
                    <td className={tdCls}>{formatVND(r.amount_paid)}</td>
                    <td className={`${tdCls} font-medium`}>{formatVND(Number(r.amount) - Number(r.amount_paid))}</td>
                    <td className={tdCls}>{formatDate(r.due_date)}</td>
                    <td className={tdCls}><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card title="Hoá đơn GTGT đã xuất">
          {invoices.length === 0 ? <EmptyState message="Chưa có hoá đơn." /> : (
            <>
              <TableWrap>
                <thead><tr><th className={thCls}>Số hoá đơn</th><th className={thCls}>Ký hiệu</th><th className={thCls}>Ngày</th><th className={thCls}>Giá trị</th><th className={thCls}>Trạng thái</th></tr></thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-t border-slate-100">
                      <td className={tdCls}>{inv.invoice_no}</td>
                      <td className={tdCls}>{inv.symbol}</td>
                      <td className={tdCls}>{formatDate(inv.invoice_date)}</td>
                      <td className={tdCls}>{formatVND(inv.total_amount)}</td>
                      <td className={tdCls}><StatusBadge status={inv.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <p className="mt-2 text-xs text-slate-500">Số lượng và giá trị hoá đơn ở phần thống kê chỉ tính hoá đơn đang hiệu lực — hoá đơn đã huỷ không tính.</p>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
