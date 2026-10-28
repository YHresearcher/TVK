import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import { createSupplierAction, updateSupplierAction } from "@/lib/actions";
import { getCurrentProfile, listSuppliers } from "@/lib/queries";
import { isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Vai trò được sửa nhà cung cấp — khớp quyền ghi UPDATE của RLS (migration 0003). */
const EDIT_ROLES = ["OWNER", "ACCOUNTING"];

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: { ok?: string; edit?: string };
}) {
  const [suppliers, profile] = await Promise.all([listSuppliers(), getCurrentProfile()]);
  const readOnly = isReadOnlyRole(profile.data?.role);
  const canEdit = EDIT_ROLES.includes(profile.data?.role ?? "");
  const editing = canEdit ? suppliers.data.find((s) => s.id === searchParams.edit) : undefined;
  return (
    <>
      <PageHeader title="Nhà cung cấp" description="Nhà cung cấp là người cung cấp hàng cho cửa hàng, hoặc ký gửi hàng cho cửa hàng bán hộ — khác với đối tác là người nhận ký gửi từ cửa hàng. Điều khoản ký gửi nằm ở đây: sau khi bán phải thanh toán trong bao nhiêu ngày, hàng ký gửi chưa bán được giữ bao lâu, và nhà cung cấp này có cho phép ký gửi tiếp (ô D) hay không." />
      {!suppliers.configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {suppliers.data.length === 0 ? <EmptyState message="Chưa có nhà cung cấp." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Tên</th><th className={thCls}>Điện thoại</th><th className={thCls}>Mã số thuế</th><th className={thCls}>Thanh toán sau bán (ngày)</th><th className={thCls}>Thời hạn trả hàng (ngày)</th><th className={thCls}>Ký gửi tiếp</th>{canEdit && <th className={thCls}>Thao tác</th>}</tr></thead>
              <tbody>
                {suppliers.data.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className={`${tdCls} font-medium`}>{s.name}</td>
                    <td className={tdCls}>{s.phone ?? "—"}</td>
                    <td className={tdCls}>{s.tax_code ?? "—"}</td>
                    <td className={tdCls}>{s.consignment_pay_days}</td>
                    <td className={tdCls}>{s.consignment_return_days}</td>
                    <td className={tdCls}>{s.allow_sub_consignment ? "Cho phép" : "Khoá"}</td>
                    {canEdit && (
                      <td className={tdCls}>
                        <Link href={`/suppliers?edit=${s.id}`} className="font-medium text-blue-700 hover:underline">
                          Sửa
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
        {!readOnly && (
        <Card title={editing ? "Sửa nhà cung cấp" : "Nhà cung cấp mới"} className="h-fit">
          <form key={editing?.id ?? "new"} action={editing ? updateSupplierAction : createSupplierAction} className="space-y-3">
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <div><label className={labelCls}>Tên *</label><input name="name" required defaultValue={editing?.name ?? ""} className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Người liên hệ</label><input name="contact_name" defaultValue={editing?.contact_name ?? ""} className={inputCls} /></div>
              <div><label className={labelCls}>Điện thoại</label><input name="phone" defaultValue={editing?.phone ?? ""} className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Email</label><input name="email" type="email" defaultValue={editing?.email ?? ""} className={inputCls} /></div>
              <div><label className={labelCls}>Mã số thuế</label><input name="tax_code" defaultValue={editing?.tax_code ?? ""} className={inputCls} /></div>
            </div>
            <div><label className={labelCls}>Địa chỉ</label><input name="address" defaultValue={editing?.address ?? ""} className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Thanh toán sau bán (ngày)</label><input name="consignment_pay_days" type="number" defaultValue={editing?.consignment_pay_days ?? 30} className={inputCls} /></div>
              <div><label className={labelCls}>Thời hạn trả hàng (ngày)</label><input name="consignment_return_days" type="number" defaultValue={editing?.consignment_return_days ?? 90} className={inputCls} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="allow_sub_consignment" defaultChecked={editing?.allow_sub_consignment ?? false} className="h-4 w-4" />
              Cho phép ký gửi tiếp hàng của nhà cung cấp này (ô D)
            </label>
            <div><label className={labelCls}>Ghi chú</label><textarea name="notes" rows={2} defaultValue={editing?.notes ?? ""} className={inputCls} /></div>
            <SubmitButton className={`${btnCls} w-full`}>{editing ? "Lưu thay đổi" : "Tạo nhà cung cấp"}</SubmitButton>
            {editing && (
              <Link href="/suppliers" className="block text-center text-sm font-medium text-slate-600 hover:underline">
                Huỷ — quay lại tạo mới
              </Link>
            )}
          </form>
        </Card>
        )}
      </div>
    </>
  );
}
