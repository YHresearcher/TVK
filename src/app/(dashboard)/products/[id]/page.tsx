import { BackLink, Card, EmptyState, NotConfigured, PageHeader, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import PriceEditForm from "@/components/PriceEditForm";
import { createFitmentAction, createProductCodeAction, updateProductInfoAction, updateProductPricesAction } from "@/lib/actions";
import { getCurrentProfile, getProductDetail, listProductGroups } from "@/lib/queries";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { CODE_KINDS, CODE_KIND_LABELS, OWNERSHIP_LABELS, isReadOnlyRole, type AnyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const [detail, profile, groups] = await Promise.all([getProductDetail(params.id), getCurrentProfile(), listProductGroups()]);
  if (!detail.configured) return (<><PageHeader title="Sản phẩm" /><NotConfigured /></>);
  if (!detail.product) return (<><BackLink href="/products" label="Quay lại danh sách sản phẩm" /><EmptyState message="Không tìm thấy sản phẩm." /></>);
  const p = detail.product;
  const readOnly = isReadOnlyRole(profile.data?.role);
  const addCode = createProductCodeAction.bind(null, p.id);
  const addFitment = createFitmentAction.bind(null, p.id);
  const updatePrices = updateProductPricesAction.bind(null, p.id);
  const updateInfo = updateProductInfoAction.bind(null, p.id);

  return (
    <>
      <BackLink href="/products" label="Quay lại danh sách sản phẩm" />
      <PageHeader title={`${p.sku} — ${p.name}`} description={`Thương hiệu: ${p.brand ?? "—"} · Đơn vị: ${p.unit} · Tồn tối thiểu: ${p.min_stock}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Thông tin hàng hoá">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Mã hàng (SKU)</dt><dd className="font-mono font-medium">{p.sku}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Tên</dt><dd className="font-medium">{p.name}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Thương hiệu</dt><dd className="font-medium">{p.brand ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Nhóm hàng</dt><dd className="font-medium">{p.product_group ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Độ nhớt SAE</dt><dd className="font-medium">{(p as AnyRow).sae_viscosity ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Chuẩn API/ACEA</dt><dd className="font-medium">{(p as AnyRow).api_standard ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Đơn vị</dt><dd className="font-medium">{p.unit}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Tồn tối thiểu</dt><dd className="font-medium">{formatNumber(p.min_stock)}</dd></div>
          </dl>
          {!readOnly && (
          <form action={updateInfo} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div>
              <label className={labelCls}>Tên hàng *</label>
              <input name="name" required defaultValue={p.name} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Thương hiệu</label>
              <input name="brand" defaultValue={p.brand ?? ""} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Nhóm hàng</label>
              <input name="product_group" list="tvk-product-groups" defaultValue={p.product_group ?? ""} placeholder="VD: Linh kiện ô tô tải" className={inputCls} />
              <datalist id="tvk-product-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Độ nhớt SAE (nhớt)</label>
                <input name="sae_viscosity" defaultValue={(p as AnyRow).sae_viscosity ?? ""} placeholder="VD: 15W-40" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Chuẩn API/ACEA (nhớt)</label>
                <input name="api_standard" defaultValue={(p as AnyRow).api_standard ?? ""} placeholder="VD: CI-4" className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Đơn vị *</label>
                <input name="unit" required defaultValue={p.unit} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Tồn tối thiểu</label>
                <input name="min_stock" type="number" min="0" defaultValue={p.min_stock} className={inputCls} />
              </div>
            </div>
            <p className="text-xs text-slate-500">Mã hàng (SKU) không sửa được — nó là chìa khoá khớp hàng của import, quầy bán và tem mã vạch.</p>
            <SubmitButton className={`${btnCls} w-full`}>Lưu thông tin</SubmitButton>
          </form>
          )}
        </Card>

        <Card title="Bảng giá">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Giá lẻ</dt><dd className="font-medium">{formatVND(p.retail_price)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Cho gara</dt><dd className="font-medium">{formatVND(p.garage_price)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Giá đại lý</dt><dd className="font-medium">{formatVND(p.wholesale_price)}</dd></div>
          </dl>
          {!readOnly && (
            <PriceEditForm
              action={updatePrices}
              retailPrice={Number(p.retail_price ?? 0)}
              garagePrice={Number(p.garage_price ?? 0)}
              wholesalePrice={Number(p.wholesale_price ?? 0)}
            />
          )}
        </Card>

        <Card title="Mã tra cứu">
          {detail.codes.length === 0 ? <EmptyState message="Chưa có mã." /> : (
            <ul className="space-y-1 text-sm">
              {detail.codes.map((c) => (
                <li key={c.id} className="flex justify-between"><span className="font-mono">{c.code}</span><span className="text-slate-500">{CODE_KIND_LABELS[c.code_kind] ?? c.code_kind}</span></li>
              ))}
            </ul>
          )}
          {!readOnly && (
          <form action={addCode} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div className="flex gap-2">
              <input name="code" required placeholder="Mã" className={inputCls} />
              <select name="code_kind" className={inputCls} defaultValue="OEM">
                {CODE_KINDS.map((k) => <option key={k} value={k}>{CODE_KIND_LABELS[k] ?? k}</option>)}
              </select>
            </div>
            <SubmitButton className={`${btnCls} w-full`}>Thêm mã</SubmitButton>
          </form>
          )}
        </Card>

        <Card title="Xe tương thích">
          {detail.fitments.length === 0 ? <EmptyState message="Chưa có xe tương thích." /> : (
            <ul className="space-y-1 text-sm">
              {detail.fitments.map((f) => (
                <li key={f.vehicle_id}>
                  {f.vehicles?.make} {f.vehicles?.model} {f.vehicles?.year_from}–{f.vehicles?.year_to} {f.vehicles?.engine ?? ""}
                </li>
              ))}
            </ul>
          )}
          {!readOnly && (
          <form action={addFitment} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <input name="make" required placeholder="Hãng (Toyota)" className={inputCls} />
              <input name="model" required placeholder="Dòng xe (Vios)" className={inputCls} />
              <input name="year_from" type="number" placeholder="Từ năm" className={inputCls} />
              <input name="year_to" type="number" placeholder="Đến năm" className={inputCls} />
            </div>
            <input name="engine" placeholder="Động cơ (1.5)" className={inputCls} />
            <SubmitButton className={`${btnCls} w-full`}>Thêm xe</SubmitButton>
          </form>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Các lô của sản phẩm này">
          {detail.batches.length === 0 ? <EmptyState message="Chưa có hàng." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Lô</th><th className={thCls}>Quyền sở hữu</th><th className={thCls}>Nhập từ</th><th className={thCls}>Vị trí</th><th className={thCls}>Số lượng</th><th className={thCls}>Ngày nhập</th><th className={thCls}>Hạn trả</th></tr></thead>
              <tbody>
                {detail.batches.map((b, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className={tdCls}>{b.batch_code}</td>
                    <td className={tdCls}>{OWNERSHIP_LABELS[b.ownership] ?? b.ownership}</td>
                    <td className={tdCls}>{b.supplier_name ?? "—"}</td>
                    <td className={tdCls}>{b.location_name}</td>
                    <td className={tdCls}>{formatNumber(b.qty)}</td>
                    <td className={tdCls}>{formatDate(b.received_date)}</td>
                    <td className={tdCls}>{formatDate(b.return_by_date)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
