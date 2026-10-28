import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { cancelVatInvoiceAction, createVatInvoiceAction } from "@/lib/actions";
import ExportExcelButton from "@/components/ExportExcelButton";
import { getCurrentProfile, getVatInvoiceMode, listPartners, listUninvoicedLines, listVatInvoices } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { STATUS_LABELS, isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [invoices, uninvoiced, partners, profile, vatMode] = await Promise.all([
    listVatInvoices(),
    listUninvoicedLines(),
    listPartners(),
    getCurrentProfile(),
    getVatInvoiceMode(),
  ]);
  const defaultCombine = vatMode !== "SEPARATE";
  const configured = invoices.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
  const partnerName = new Map(partners.data.map((p) => [p.id, p.name]));
  const invoiceRows = invoices.data.map((inv) => ({
    "Số hoá đơn": inv.invoice_no,
    "Ký hiệu": inv.symbol,
    "Đối tác": inv.partner_id ? partnerName.get(inv.partner_id) ?? "—" : "—",
    "Ngày": formatDate(inv.invoice_date),
    "Tổng": Number(inv.total_amount) || 0,
    "Trạng thái": STATUS_LABELS[inv.status] ?? inv.status,
  }));
  const partnerOptions = partners.data.map((p) => ({ value: p.id, label: p.name }));

  return (
    <>
      <PageHeader
        title="Hoá đơn GTGT"
        description="Lớp hoá đơn pháp lý. Hoá đơn được tạo từ các dòng chứng từ BH/KG đã xác nhận — mỗi dòng chỉ xuất hoá đơn đúng một lần, và mỗi dòng trên hoá đơn luôn liên kết với chứng từ quản lý của nó, nên tiền ký gửi và tiền bán trực tiếp không bao giờ trộn lẫn. Ngay trên form phát hành, bạn chọn Gộp (1 hoá đơn) hoặc Tách (2 hoá đơn: BH riêng, KG riêng) cho từng lần xuất; ô chọn được đặt sẵn theo mặc định ở Cài đặt."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã tạo hoá đơn.</p>}
      <div className="space-y-6">
        {!readOnly && (
        <Card title="Phát hành hoá đơn GTGT từ dòng chứng từ">
          {uninvoiced.data.length === 0 ? (
            <EmptyState message="Chưa có dòng chứng từ chưa xuất hoá đơn. Hãy xác nhận chứng từ bán hàng hoặc chứng từ phân bổ trước." />
          ) : (
            <form action={createVatInvoiceAction} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <div><label className={labelCls}>Đối tác</label>
                  <select name="partner_id" className={inputCls}><option value="">— Chọn —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Số hoá đơn *</label><input name="invoice_no" required className={inputCls} /></div>
                <div><label className={labelCls}>Ký hiệu *</label><input name="symbol" required className={inputCls} placeholder="1C25T…" /></div>
                <div><label className={labelCls}>Ngày hoá đơn *</label><input name="invoice_date" type="date" required className={inputCls} /></div>
                <div><label className={labelCls}>Nhà cung cấp hoá đơn điện tử</label><input name="provider" className={inputCls} placeholder="MISA / Viettel…" /></div>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                <input type="checkbox" name="combine" value="1" defaultChecked={defaultCombine} className="mt-0.5 h-4 w-4" />
                <span>
                  <strong>Gộp thành 1 hoá đơn GTGT</strong> cho cả phần bán thẳng (BH) và phần ký gửi (KG).
                  Bỏ chọn = <strong>tách thành 2 hoá đơn</strong>: hoá đơn BH dùng Số hoá đơn / Ký hiệu ở trên,
                  hoá đơn KG dùng hai ô phần ký gửi bên dưới.
                  <span className="block text-xs text-slate-500">Ô này đang đặt theo mặc định ở Cài đặt ({defaultCombine ? "Gộp" : "Tách"}) — đổi tại đây chỉ áp dụng cho lần xuất này.</span>
                </span>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <div><label className={labelCls}>Số hoá đơn phần ký gửi (chỉ khi tách)</label><input name="invoice_no_kg" className={inputCls} /></div>
                <div><label className={labelCls}>Ký hiệu phần ký gửi (chỉ khi tách)</label><input name="symbol_kg" className={inputCls} placeholder="1C25T…" /></div>
              </div>
              <div className="space-y-2">
                <p className={labelCls}>Các dòng chứng từ đưa vào hoá đơn (mỗi dòng chỉ xuất được một lần)</p>
                {uninvoiced.data.map((l) => (
                  <label key={l.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                    <input type="checkbox" name="line_id" value={l.id} className="h-4 w-4" />
                    <span className="font-mono text-xs">{l.document?.doc_code}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{l.document?.doc_kind}</span>
                    <span>{l.products?.sku} — {l.products?.name}</span>
                    <span className="ml-auto">{formatNumber(l.qty)} × {formatVND(l.unit_price)} = <strong>{formatVND(Number(l.qty) * Number(l.unit_price))}</strong></span>
                  </label>
                ))}
              </div>
              <button type="submit" className={btnCls}>Phát hành hoá đơn</button>
            </form>
          )}
        </Card>
        )}

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Hoá đơn đã xuất</h2>
          {invoices.data.length > 0 && <ExportExcelButton filename="hoa-don-gtgt.xlsx" rows={invoiceRows} />}
        </div>
        {invoices.data.length === 0 ? <EmptyState message="Chưa có hoá đơn GTGT." /> : (
          <TableWrap>
            <thead><tr><th className={thCls}>Số hoá đơn</th><th className={thCls}>Ký hiệu</th><th className={thCls}>Đối tác</th><th className={thCls}>Ngày</th><th className={thCls}>Tổng</th><th className={thCls}>Trạng thái</th><th className={thCls}></th></tr></thead>
            <tbody>
              {invoices.data.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className={`${tdCls} font-mono text-xs`}>{inv.invoice_no}</td>
                  <td className={tdCls}>{inv.symbol}</td>
                  <td className={tdCls}>{inv.partner_id ? partnerName.get(inv.partner_id) ?? "—" : "—"}</td>
                  <td className={tdCls}>{formatDate(inv.invoice_date)}</td>
                  <td className={tdCls}>{formatVND(inv.total_amount)}</td>
                  <td className={tdCls}><StatusBadge status={inv.status} /></td>
                  <td className={tdCls}>
                    {inv.status === "ISSUED" && !readOnly && (
                      <form action={cancelVatInvoiceAction}>
                        <input type="hidden" name="id" value={inv.id} />
                        <button type="submit" className={btnGhostCls}>Huỷ hoá đơn</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <p className="text-xs text-slate-500">Huỷ hoá đơn chỉ mở lại các dòng phân bổ thuộc hoá đơn đó — các hoá đơn khác không bị ảnh hưởng.</p>
      </div>
    </>
  );
}
