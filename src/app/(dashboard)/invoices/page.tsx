import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import NoBusinessLineNotice from "@/components/NoBusinessLineNotice";
import { cancelVatInvoiceAction, createVatInvoiceAction } from "@/lib/actions";
import ExportExcelButton from "@/components/ExportExcelButton";
import { getBusinessLineContext } from "@/lib/business-lines";
import { getCurrentProfile, getVatInvoiceMode, listPartners, listUninvoicedLines, listVatInvoices } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { BUSINESS_LINE_LABELS, STATUS_LABELS, isReadOnlyRole } from "@/lib/types";
import type { AnyRow, BusinessLineCode } from "@/lib/types";
import { groupUninvoicedLinesByLine } from "@/lib/vat";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  // P4b: hoá đơn GTGT tách theo ngành — mỗi hoá đơn chỉ ghi cho một ngành.
  const ctx = await getBusinessLineContext();
  const lineFilter = ctx.mode === "LINE" ? ctx.lineId : ctx.mode === "NONE" ? null : undefined;
  const [invoices, uninvoiced, partners, profile, vatMode] = await Promise.all([
    listVatInvoices(lineFilter),
    listUninvoicedLines(lineFilter),
    listPartners(),
    getCurrentProfile(),
    getVatInvoiceMode(),
  ]);
  const defaultCombine = vatMode !== "SEPARATE";
  const configured = invoices.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
  const partnerName = new Map(partners.data.map((p) => [p.id, p.name]));
  const lineLabelById = new Map(ctx.lines.map((l) => [l.id, BUSINESS_LINE_LABELS[l.code as BusinessLineCode] ?? l.code]));
  const lineLabel = (lineId: string | null | undefined) =>
    lineId ? (lineLabelById.get(lineId) ?? "Ngành khác") : "Chưa phân loại";
  const invoiceRows = invoices.data.map((inv) => ({
    "Số hoá đơn": inv.invoice_no,
    "Ký hiệu": inv.symbol,
    "Đối tác": inv.partner_id ? partnerName.get(inv.partner_id) ?? "—" : "—",
    "Ngày": formatDate(inv.invoice_date),
    "Ngành": lineLabel(inv.business_line_id),
    "Trước thuế": Number(inv.total_before_tax) || 0,
    "VAT": Number(inv.total_vat) || 0,
    "Tổng": Number(inv.total_amount) || 0,
    "Trạng thái": STATUS_LABELS[inv.status] ?? inv.status,
  }));
  const partnerOptions = partners.data.map((p) => ({ value: p.id, label: p.name }));
  // Các dòng chưa ghi hoá đơn chia thẻ theo ngành (dòng thuộc sản phẩm
  // chưa phân loại gom riêng — phải phân loại trước khi ghi).
  type UninvoicedRow = AnyRow & { id: string; business_line_id: string | null };
  const lineGroups = groupUninvoicedLinesByLine<UninvoicedRow>(
    uninvoiced.data.map(
      (l) =>
        ({
          ...l,
          business_line_id: (l.products?.business_line_id as string | null) ?? null,
        }) as UninvoicedRow,
    ),
  );

  return (
    <>
      <PageHeader
        title="Hoá đơn GTGT (theo dõi nội bộ)"
        description="Theo dõi nội bộ các hoá đơn GTGT đã xuất từ hệ thống hoá đơn chính thức. Hoá đơn được ghi nhận từ các dòng phiếu bán đã xác nhận (bán hàng BH / hàng ký gửi KG) — mỗi dòng chỉ ghi nhận đúng một lần, và mỗi dòng trên hoá đơn luôn gắn với phiếu bán của nó, nên tiền ký gửi và tiền bán trực tiếp không bao giờ trộn lẫn. Mỗi hoá đơn GTGT chỉ ghi cho MỘT ngành (Dầu nhớt hoặc Phụ tùng): các dòng chưa ghi được chia thẻ theo ngành, ghi riêng từng ngành. Ngay trên form ghi nhận, bạn chọn Gộp (1 hoá đơn) hoặc Tách (2 hoá đơn: BH riêng, KG riêng) cho từng lần ghi nhận; ô chọn được đặt sẵn theo mặc định ở Cài đặt."
      />
      {!configured && <NotConfigured />}
      {ctx.mode === "NONE" && <NoBusinessLineNotice />}
      {ctx.mode === "NONE" ? null : (
      <>
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã ghi nhận hoá đơn.</p>}
      <div className="space-y-6">
        {!readOnly && (
        <>
        {uninvoiced.data.length === 0 ? (
          <Card title="Ghi nhận hoá đơn GTGT từ dòng chứng từ">
            <EmptyState message="Chưa có dòng phiếu chưa xuất hoá đơn. Hãy xác nhận phiếu bán hàng hoặc phiếu chia hàng trước." />
          </Card>
        ) : (
          lineGroups.map((g) => (
            <Card key={g.lineId ?? "unclassified"} title={`Ghi nhận hoá đơn GTGT — ${lineLabel(g.lineId)}`}>
              {g.lineId === null ? (
                <div className="space-y-2">
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Các dòng dưới đây thuộc sản phẩm chưa phân loại ngành — phân loại sản phẩm trước khi ghi hoá đơn (một hoá đơn GTGT chỉ ghi cho một ngành).
                  </p>
                  {g.lines.map((l) => (
                    <div key={l.id} className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
                      <span className="font-mono text-xs">{l.document?.doc_code}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{l.document?.doc_kind}</span>
                      <span>{l.products?.sku} — {l.products?.name}</span>
                      <span className="ml-auto">{formatNumber(l.qty)} × {formatVND(l.unit_price)} = <strong>{formatVND(Number(l.qty) * Number(l.unit_price))}</strong></span>
                    </div>
                  ))}
                </div>
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
                    {g.lines.map((l) => (
                      <label key={l.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                        <input type="checkbox" name="line_id" value={l.id} className="h-4 w-4" />
                        <span className="font-mono text-xs">{l.document?.doc_code}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{l.document?.doc_kind}</span>
                        <span>{l.products?.sku} — {l.products?.name}</span>
                        <span className="ml-auto">{formatNumber(l.qty)} × {formatVND(l.unit_price)} = <strong>{formatVND(Number(l.qty) * Number(l.unit_price))}</strong></span>
                      </label>
                    ))}
                  </div>
                  <SubmitButton className={btnCls}>Ghi nhận hoá đơn</SubmitButton>
                </form>
              )}
            </Card>
          ))
        )}
        </>
        )}

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Hoá đơn đã xuất</h2>
          {invoices.data.length > 0 && <ExportExcelButton filename="hoa-don-gtgt.xlsx" rows={invoiceRows} />}
        </div>
        {invoices.data.length === 0 ? <EmptyState message="Chưa có hoá đơn GTGT." /> : (
          <TableWrap>
            <thead><tr><th className={thCls}>Số hoá đơn</th><th className={thCls}>Ký hiệu</th><th className={thCls}>Đối tác</th><th className={thCls}>Ngày</th><th className={thCls}>Ngành</th><th className={`${thCls} text-right`}>Trước thuế</th><th className={`${thCls} text-right`}>VAT</th><th className={`${thCls} text-right`}>Tổng</th><th className={thCls}>Trạng thái</th><th className={thCls}></th></tr></thead>
            <tbody>
              {invoices.data.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                  <td className={`${tdCls} font-mono text-xs font-semibold text-slate-900`}>{inv.invoice_no}</td>
                  <td className={tdCls}>{inv.symbol}</td>
                  <td className={tdCls}>{inv.partner_id ? partnerName.get(inv.partner_id) ?? "—" : "—"}</td>
                  <td className={tdCls}>{formatDate(inv.invoice_date)}</td>
                  <td className={tdCls}>{lineLabel(inv.business_line_id)}</td>
                  <td className={`${tdCls} text-right font-mono text-slate-700`}>{formatVND(inv.total_before_tax)}</td>
                  <td className={`${tdCls} text-right font-mono text-slate-700`}>{formatVND(inv.total_vat)}</td>
                  <td className={`${tdCls} text-right font-mono font-medium text-slate-900`}>{formatVND(inv.total_amount)}</td>
                  <td className={tdCls}><StatusBadge status={inv.status} /></td>
                  <td className={tdCls}>
                    {inv.status === "ISSUED" && !readOnly && (
                      <form action={cancelVatInvoiceAction}>
                        <input type="hidden" name="id" value={inv.id} />
                        <SubmitButton className={btnGhostCls}>Huỷ ghi nhận</SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <p className="text-xs text-slate-500">Huỷ ghi nhận chỉ mở lại các dòng đã chia thuộc hoá đơn đó — các hoá đơn khác không bị ảnh hưởng.</p>
      </div>
      </>
      )}
    </>
  );
}
