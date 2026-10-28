import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import { createPartnerAction, updatePartnerAction } from "@/lib/actions";
import { getCurrentProfile, listPartners } from "@/lib/queries";
import { formatVND } from "@/lib/format";
import { PARTNER_KIND_LABELS, PARTNER_KINDS, isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Vai trò được sửa đối tác — khớp quyền ghi UPDATE của RLS (migration 0003). */
const EDIT_ROLES = ["OWNER", "ACCOUNTING", "SALES"];

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: { ok?: string; edit?: string };
}) {
  const [partners, profile] = await Promise.all([listPartners(), getCurrentProfile()]);
  const readOnly = isReadOnlyRole(profile.data?.role);
  const canEdit = EDIT_ROLES.includes(profile.data?.role ?? "");
  const editing = canEdit ? partners.data.find((p) => p.id === searchParams.edit) : undefined;
  return (
    <>
      <PageHeader title="Đối tác" description="Đối tác là người nhận ký gửi từ cửa hàng (đồng thời có thể mua đứt) — khác với nhà cung cấp là người giao hàng cho cửa hàng. Khách hàng, gara, công ty vận tải và cửa hàng khác. Một đối tác vừa mua đứt vừa nhận ký gửi — hệ thống theo dõi hai tính chất riêng biệt theo từng lô và từng chứng từ." />
      {!partners.configured && <NotConfigured />}
      {searchParams.ok && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Đã lưu thành công.</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {partners.data.length === 0 ? <EmptyState message="Chưa có đối tác." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Tên</th><th className={thCls}>Loại</th><th className={thCls}>Điện thoại</th><th className={thCls}>Mã số thuế</th><th className={thCls}>Số ngày thanh toán</th><th className={thCls}>Hạn mức tín dụng</th><th className={thCls}>Hạn mức ký gửi</th>{canEdit && <th className={thCls}>Thao tác</th>}</tr></thead>
              <tbody>
                {partners.data.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className={`${tdCls} font-medium`}><Link href={`/partners/${p.id}`} className="text-blue-700 hover:underline">{p.name}</Link></td>
                    <td className={tdCls}>{PARTNER_KIND_LABELS[p.partner_kind] ?? p.partner_kind}</td>
                    <td className={tdCls}>{p.phone ?? "—"}</td>
                    <td className={tdCls}>{p.tax_code ?? "—"}</td>
                    <td className={tdCls}>{p.payment_days}</td>
                    <td className={tdCls}>{formatVND(p.credit_limit)}</td>
                    <td className={tdCls}>{formatVND(p.consignment_limit)}</td>
                    {canEdit && (
                      <td className={tdCls}>
                        <Link href={`/partners?edit=${p.id}`} className="font-medium text-blue-700 hover:underline">
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
        <Card title={editing ? "Sửa đối tác" : "Đối tác mới"} className="h-fit">
          <form key={editing?.id ?? "new"} action={editing ? updatePartnerAction : createPartnerAction} className="space-y-3">
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <div><label className={labelCls}>Tên *</label><input name="name" required defaultValue={editing?.name ?? ""} className={inputCls} /></div>
            <div><label className={labelCls}>Loại</label>
              <select name="partner_kind" className={inputCls} defaultValue={editing?.partner_kind ?? "GARAGE"}>
                {PARTNER_KINDS.map((k) => <option key={k} value={k}>{PARTNER_KIND_LABELS[k] ?? k}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Người liên hệ</label><input name="contact_name" defaultValue={editing?.contact_name ?? ""} className={inputCls} /></div>
              <div><label className={labelCls}>Điện thoại</label><input name="phone" defaultValue={editing?.phone ?? ""} className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Email</label><input name="email" type="email" defaultValue={editing?.email ?? ""} className={inputCls} /></div>
              <div><label className={labelCls}>Mã số thuế</label><input name="tax_code" defaultValue={editing?.tax_code ?? ""} className={inputCls} /></div>
            </div>
            <div><label className={labelCls}>Địa chỉ</label><input name="address" defaultValue={editing?.address ?? ""} className={inputCls} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className={labelCls}>Số ngày thanh toán</label><input name="payment_days" type="number" defaultValue={editing?.payment_days ?? 0} className={inputCls} /></div>
              <div><label className={labelCls}>Hạn mức tín dụng (₫)</label><input name="credit_limit" type="number" step="100000" defaultValue={editing?.credit_limit ?? 0} className={inputCls} /></div>
              <div><label className={labelCls}>Hạn mức ký gửi (₫)</label><input name="consignment_limit" type="number" step="100000" defaultValue={editing?.consignment_limit ?? 0} className={inputCls} /></div>
            </div>
            <div><label className={labelCls}>Ghi chú</label><textarea name="notes" rows={2} defaultValue={editing?.notes ?? ""} className={inputCls} /></div>
            <SubmitButton className={`${btnCls} w-full`}>{editing ? "Lưu thay đổi" : "Tạo đối tác"}</SubmitButton>
            {editing && (
              <Link href="/partners" className="block text-center text-sm font-medium text-slate-600 hover:underline">
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
