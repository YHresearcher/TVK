import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, StatusBadge, TableWrap, btnCls, btnGhostCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import ItemsRows from "@/components/ItemsRows";
import ImportAllocation from "@/components/ImportAllocation";
import ImportConsumptionReport from "@/components/ImportConsumptionReport";
import {
  createAllocationAction,
  createConsumptionReportAction,
  importAllocationAction,
  importConsumptionReportAction,
  setConsumptionReportStatusAction,
} from "@/lib/actions";
import { buildProductCodeMap, getCurrentProfile, listAllocations, listBatchesForSales, listConsumptionReports, listPartners, listProductCodes, listProducts } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PartnerConsumptionPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const [reports, allocations, partners, products, batchStock, productCodes, profile] = await Promise.all([
    listConsumptionReports(),
    listAllocations(),
    listPartners(),
    listProducts(),
    listBatchesForSales(),
    listProductCodes(),
    getCurrentProfile(),
  ]);
  const readOnly = isReadOnlyRole(profile.data?.role);
  const codeMap = buildProductCodeMap(products.data, productCodes.data);
  const configured = reports.configured;
  const partnerName = new Map(partners.data.map((p) => [p.id, p.name]));
  const partnerOptions = partners.data.map((p) => ({ value: p.id, label: p.name }));
  const productOptions = products.data.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }));
  const reportOptions = reports.data.map((r) => ({
    value: r.id,
    label: `${r.doc_code} — ${partnerName.get(r.partner_id) ?? ""} (${formatDate(r.period_from)} → ${formatDate(r.period_to)})`,
  }));
  const partnerBatches = Array.from(
    new Map(
      batchStock.data
        .filter((r) => r.location_kind === "PARTNER_VIRTUAL")
        .map((r) => [r.batch_id, r])
    ).values()
  );
  // Tất cả dòng lô tại kho đối tác (không gộp theo lô — một lô có thể nằm
  // ở kho của nhiều đối tác cùng lúc) cho import phân bổ.
  const partnerBatchRows = batchStock.data
    .filter((r) => r.location_kind === "PARTNER_VIRTUAL")
    .map((r) => ({
      batch_id: r.batch_id,
      batch_code: r.batch_code,
      product_id: r.product_id,
      product_name: r.product_name,
      location_name: r.location_name,
      partner_id: r.partner_id,
      qty: Number(r.qty),
    }));
  const reportOptionsData = reports.data.map((r) => ({
    id: r.id,
    doc_code: r.doc_code,
    partner_id: r.partner_id,
    period_from: r.period_from ?? null,
    period_to: r.period_to ?? null,
  }));
  const batchOptions = partnerBatches.map((r) => ({
    value: r.batch_id,
    label: `${r.batch_code} — ${r.product_name} · tại ${r.location_name}`,
  }));

  return (
    <>
      <PageHeader
        title="Tiêu thụ của đối tác & Phân bổ"
        description="Quy trình: đối tác báo tiêu thụ (BT) → phiếu phân bổ gán mọi số lượng vào một nguồn — MUA ĐỨT hoặc KÝ GỬI (PB) → chứng từ BH/KG → hoá đơn GTGT. Phân bổ thực hiện TRƯỚC khi xuất hoá đơn, và mỗi số lượng chỉ được xuất hoá đơn đúng một lần."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      <div className="space-y-8">
        <section className="space-y-4">
          {!readOnly && (
          <>
          <Card title="Báo cáo tiêu thụ mới (BT)">
            <form action={createConsumptionReportAction} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div><label className={labelCls}>Đối tác *</label>
                  <select name="partner_id" required className={inputCls}><option value="">— Chọn —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Từ ngày *</label><input name="period_from" type="date" required className={inputCls} /></div>
                <div><label className={labelCls}>Đến ngày *</label><input name="period_to" type="date" required className={inputCls} /></div>
              </div>
              <ItemsRows codeMap={codeMap} fields={[
                { name: "product_id", label: "Sản phẩm", type: "select", options: productOptions },
                { name: "qty_consumed", label: "Số lượng đã tiêu thụ", type: "number" },
              ]} initialRows={2} />
              <SubmitButton className={btnCls}>Tạo báo cáo nháp</SubmitButton>
            </form>
          </Card>
          <Card title="Nhập từ Excel (BT)">
            <ImportConsumptionReport partners={partners.data} products={products.data.map((p) => ({ id: p.id, sku: p.sku, name: p.name }))} codes={productCodes.data.map((c) => ({ code: c.code, product_id: c.product_id }))} action={importConsumptionReportAction} />
          </Card>
          </>
          )}
          {reports.data.length === 0 ? <EmptyState message="Chưa có báo cáo tiêu thụ." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Mã</th><th className={thCls}>Đối tác</th><th className={thCls}>Kỳ</th><th className={thCls}>Trạng thái</th><th className={thCls}></th></tr></thead>
              <tbody>
                {reports.data.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className={`${tdCls} font-mono text-xs`}>{r.doc_code}</td>
                    <td className={tdCls}>{partnerName.get(r.partner_id) ?? "—"}</td>
                    <td className={tdCls}>{formatDate(r.period_from)} → {formatDate(r.period_to)}</td>
                    <td className={tdCls}><StatusBadge status={r.status} /></td>
                    <td className={tdCls}>
                      {r.status === "DRAFT" && !readOnly && (
                        <form action={setConsumptionReportStatusAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="status" value="CONFIRMED" />
                          <SubmitButton className={btnGhostCls}>Xác nhận báo cáo</SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </section>

        <section className="space-y-4">
          {!readOnly && (
          <>
          <Card title="Phiếu phân bổ mới (PB)">
            <form action={createAllocationAction} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div><label className={labelCls}>Đối tác *</label>
                  <select name="partner_id" required className={inputCls}><option value="">— Chọn —</option>{partnerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                <div><label className={labelCls}>Báo cáo tiêu thụ (không bắt buộc)</label>
                  <select name="report_id" className={inputCls}><option value="">— Không —</option>{reportOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              </div>
              <ItemsRows codeMap={codeMap} fields={[
                { name: "product_id", label: "Sản phẩm", type: "select", options: productOptions },
                { name: "batch_id", label: "Lô tại đối tác", type: "select", options: batchOptions },
                { name: "nature", label: "Nguồn hàng", type: "select", options: [
                  { value: "PURCHASED", label: "Mua đứt (PURCHASED)" },
                  { value: "CONSIGNED", label: "Ký gửi (CONSIGNED)" },
                ] },
                { name: "qty", label: "Số lượng", type: "number" },
                { name: "unit_price", label: "Đơn giá (₫)", type: "number", step: "1000" },
              ]} initialRows={2} />
              <p className="text-xs text-slate-500">Khi xác nhận, cơ sở dữ liệu kiểm tra 3 chốt: không vượt quá lượng tiêu thụ đã báo, không vượt quá hạn mức đã giao theo từng tính chất, và lô phải còn đủ hàng tại đối tác.</p>
              <SubmitButton className={btnCls}>Tạo phiếu phân bổ nháp</SubmitButton>
            </form>
          </Card>
          <Card title="Nhập từ Excel (PB)">
            <ImportAllocation partners={partners.data} products={products.data.map((p) => ({ id: p.id, sku: p.sku, name: p.name }))} codes={productCodes.data.map((c) => ({ code: c.code, product_id: c.product_id }))} partnerBatches={partnerBatchRows} reports={reportOptionsData} action={importAllocationAction} />
          </Card>
          </>
          )}
          {allocations.data.length === 0 ? <EmptyState message="Chưa có phiếu phân bổ." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Mã</th><th className={thCls}>Đối tác</th><th className={thCls}>Ngày</th><th className={thCls}>Trạng thái</th><th className={thCls}></th></tr></thead>
              <tbody>
                {allocations.data.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className={`${tdCls} font-mono text-xs`}>{a.doc_code}</td>
                    <td className={tdCls}>{partnerName.get(a.partner_id) ?? "—"}</td>
                    <td className={tdCls}>{formatDate(a.alloc_date)}</td>
                    <td className={tdCls}><StatusBadge status={a.status} /></td>
                    <td className={tdCls}>
                      <Link href={`/partner-consumption/allocations/${a.id}`} className="text-blue-600 hover:underline text-sm">Mở</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </section>
      </div>
    </>
  );
}
