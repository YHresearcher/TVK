import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import LabelPrintButton from "@/components/LabelPrintButton";
import { createProductAction } from "@/lib/actions";
import { getCurrentProfile, listProductGroups, listProductStock, listProducts } from "@/lib/queries";
import { formatNumber, formatVND } from "@/lib/format";
import { isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; ok?: string; noRetail?: string; group?: string };
}) {
  const [products, stock, profile, groups] = await Promise.all([listProducts(), listProductStock(), getCurrentProfile(), listProductGroups()]);
  const configured = products.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
  const stockMap = new Map(stock.data.map((s) => [s.product_id, s]));
  const q = (searchParams.q ?? "").toLowerCase();
  const onlyNoRetail = searchParams.noRetail === "1";
  const group = searchParams.group ?? "";
  const rows = products.data.filter(
    (p) =>
      (!q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)) &&
      (!onlyNoRetail || !Number(p.retail_price ?? 0)) &&
      (!group || (group === "__none" ? !p.product_group : p.product_group === group))
  );

  return (
    <>
      <PageHeader
        title="Sản phẩm"
        description="Danh mục kèm mã OEM / mã tương đương và xe tương thích. Tồn kho tách biệt: của mình và ký gửi."
      />
      {!configured && <NotConfigured />}
      {searchParams.ok && (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
            <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Tìm theo tên hoặc SKU…" className={inputCls} />
            <select name="group" defaultValue={group} className={inputCls} aria-label="Lọc theo nhóm hàng">
              <option value="">Tất cả nhóm</option>
              {groups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
              <option value="__none">Chưa xếp nhóm</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" name="noRetail" value="1" defaultChecked={onlyNoRetail} />
              Chỉ hiện hàng chưa có giá lẻ
            </label>
            <button className={btnCls} type="submit">Tìm kiếm</button>
          </form>
          <div className="mb-4 flex justify-end">
            <LabelPrintButton
              products={rows.map((p) => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                retail_price: Number(p.retail_price ?? 0),
                totalQty: Number(stockMap.get(p.id)?.total_qty ?? 0),
              }))}
            />
          </div>
          {rows.length === 0 ? (
            <EmptyState message="Chưa có sản phẩm." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={`${thCls} text-right`}>STT</th><th className={thCls}>SKU</th><th className={thCls}>Tên</th><th className={thCls}>Thương hiệu</th><th className={thCls}>Nhóm</th>
                  <th className={`${thCls} text-right`}>Giá lẻ</th><th className={`${thCls} text-right`}>Giá đại lý</th><th className={thCls}>Của mình</th><th className={thCls}>Ký gửi</th>
                  <th className={thCls}>Tại đối tác</th><th className={thCls}>Tổng</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => {
                  const s = stockMap.get(p.id);
                  const totalQty = Number(s?.total_qty ?? 0);
                  return (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className={`${tdCls} text-right text-slate-400`}>{i + 1}</td>
                      <td className={tdCls}>
                        <Link href={`/products/${p.id}`} className="font-medium text-blue-600 hover:underline">{p.sku}</Link>
                      </td>
                      <td className={tdCls}>{p.name}</td>
                      <td className={tdCls}>{p.brand ?? "—"}</td>
                      <td className={tdCls}>{p.product_group ?? "—"}</td>
                      <td className={`${tdCls} text-right`}>
                        {!Number(p.retail_price ?? 0) ? (
                          <span className="font-semibold text-amber-700">Chưa có giá</span>
                        ) : (
                          formatVND(p.retail_price)
                        )}
                      </td>
                      <td className={`${tdCls} text-right`}>{formatVND(p.wholesale_price)}</td>
                      <td className={tdCls}>{formatNumber(s?.owned_at_own_wh ?? 0)}</td>
                      <td className={tdCls}>{formatNumber(s?.consigned_at_own_wh ?? 0)}</td>
                      <td className={tdCls}>{formatNumber(Number(s?.owned_at_partners ?? 0) + Number(s?.consigned_at_partners ?? 0))}</td>
                      <td className={`${tdCls} font-medium`}>
                        {formatNumber(totalQty)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
        {!readOnly && (
        <Card title="Sản phẩm mới" className="h-fit min-w-0">
          <form action={createProductAction} className="space-y-3">
            <div><label className={labelCls}>SKU *</label><input name="sku" required className={inputCls} /></div>
            <div><label className={labelCls}>Tên *</label><input name="name" required className={inputCls} /></div>
            <div><label className={labelCls}>Thương hiệu</label><input name="brand" className={inputCls} /></div>
            <div>
              <label className={labelCls}>Nhóm hàng</label>
              <input name="product_group" list="tvk-product-groups" placeholder="VD: Linh kiện ô tô tải" className={inputCls} />
              <datalist id="tvk-product-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={labelCls}>Đơn vị</label><input name="unit" defaultValue="cái" className={inputCls} /></div>
              <div><label className={labelCls}>Tồn tối thiểu</label><input name="min_stock" type="number" defaultValue="0" className={inputCls} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label className={labelCls}>Giá lẻ</label><input name="retail_price" type="number" step="1000" defaultValue="0" className={inputCls} /></div>
              <div><label className={labelCls}>Giá cho gara</label><input name="garage_price" type="number" step="1000" defaultValue="0" className={inputCls} /></div>
              <div><label className={labelCls}>Giá đại lý</label><input name="wholesale_price" type="number" step="1000" defaultValue="0" className={inputCls} /></div>
            </div>
            <div>
              <label className={labelCls}>Mã tra cứu (mỗi dòng một mã, định dạng: MÃ hoặc MÃ|LOẠI — LOẠI: OEM, MANUFACTURER, AFTERMARKET, EQUIVALENT)</label>
              <textarea name="codes" rows={3} className={inputCls} placeholder={"90915-YZZD4|OEM\n90915-20001|EQUIVALENT"} />
            </div>
            <SubmitButton className={`${btnCls} w-full`}>Tạo sản phẩm</SubmitButton>
          </form>
        </Card>
        )}
      </div>
    </>
  );
}
