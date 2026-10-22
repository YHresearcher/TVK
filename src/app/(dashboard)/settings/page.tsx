import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import UserAdminPanel from "@/components/UserAdminPanel";
import UsernameForm from "@/components/UsernameForm";
import { createWarehouseAction, updateVatModeAction } from "@/lib/actions";
import { getCurrentProfile, listLocations } from "@/lib/queries";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type AnyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const locations = await listLocations();
  const me = (await getCurrentProfile()).data;
  const supabase = await createClient();
  let vatMode = "COMBINED";
  let profiles: AnyRow[] = [];
  if (supabase) {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "vat_invoice_mode")
      .maybeSingle();
    if (data?.value) vatMode = String(data.value);
    const { data: p } = await supabase.from("profiles").select("*").order("full_name");
    profiles = p ?? [];
  }
  const warehouses = locations.data.filter((l) => l.location_kind === "OWN_WAREHOUSE");
  const partnerWarehouses = locations.data.filter((l) => l.location_kind === "PARTNER_VIRTUAL");

  return (
    <>
      <PageHeader title="Cài đặt" description="Các tuỳ chọn toàn hệ thống. Chế độ hoá đơn GTGT phải khớp với quyết định của kế toán cùng với mô hình hợp đồng ký gửi." />
      {!locations.configured && <NotConfigured />}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Chế độ hoá đơn GTGT">
          <form action={updateVatModeAction} className="space-y-3">
            <div>
              <label className={labelCls}>Cách phát hành hoá đơn gộp</label>
              <select name="vat_invoice_mode" defaultValue={vatMode} className={inputCls}>
                <option value="COMBINED">COMBINED — một hoá đơn GTGT, mỗi tính chất một dòng</option>
                <option value="SEPARATE">SEPARATE — hai hoá đơn GTGT, mỗi tính chất một hoá đơn</option>
              </select>
            </div>
            <p className="text-xs text-slate-500">
              Dù chọn cách nào, các chứng từ quản lý nội bộ (BH / KG) luôn tách riêng và mỗi
              dòng hoá đơn luôn liên kết với đúng một chứng từ. Cài đặt này chỉ quyết định cách
              nhóm các dòng khi phát hành hoá đơn pháp lý.
            </p>
            <button type="submit" className={btnCls}>Lưu</button>
          </form>
        </Card>

        <Card title="Kho / địa điểm của chúng ta">
          {warehouses.length === 0 ? <EmptyState message="Chưa có kho — hãy tạo kho đầu tiên." /> : (
            <ul className="space-y-1 text-sm">
              {warehouses.map((l) => (
                <li key={l.id} className="flex justify-between"><span>{l.name}</span><span className="text-slate-500">{l.detail ?? ""}</span></li>
              ))}
            </ul>
          )}
          <form action={createWarehouseAction} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div className="flex gap-2">
              <input name="name" required placeholder="Tên kho (Kho chính)" className={inputCls} />
              <input name="detail" placeholder="Chi tiết (địa chỉ / khu vực kệ)" className={inputCls} />
            </div>
            <button type="submit" className={`${btnCls} w-full`}>Thêm kho</button>
          </form>
          {partnerWarehouses.length > 0 && (
            <p className="mt-4 text-xs text-slate-500">
              Kho ảo của đối tác ({partnerWarehouses.length}) được tạo tự động khi phiếu gửi ký gửi đầu tiên cho một đối tác được xác nhận.
            </p>
          )}
        </Card>

        <Card title="Người dùng & vai trò" className="lg:col-span-2">
          {profiles.length === 0 ? (
            <EmptyState message="Chưa có hồ sơ người dùng. Tạo hồ sơ OWNER đầu tiên theo hướng dẫn trong supabase/README.md." />
          ) : (
            <TableWrap>
              <thead><tr><th className={thCls}>Tên</th><th className={thCls}>Email</th><th className={thCls}>Tên đăng nhập</th><th className={thCls}>Vai trò</th><th className={thCls}>Đang hoạt động</th></tr></thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className={tdCls}>{p.full_name}</td>
                    <td className={tdCls}>{p.email ?? "—"}</td>
                    <td className={tdCls}>
                      <UsernameForm
                        profileId={p.id}
                        username={p.username ?? null}
                        canEdit={!!me && (me.role === "OWNER" || me.id === p.id)}
                      />
                    </td>
                    <td className={tdCls}>{ROLE_LABELS[p.role as keyof typeof ROLE_LABELS] ?? p.role}</td>
                    <td className={tdCls}>{p.is_active ? "Có" : "Không"}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-500">
            <li>Tên đăng nhập — tên đăng nhập ngắn tuỳ chọn (3–32 ký tự). Người dùng đăng nhập bằng tên đăng nhập hoặc email; OWNER đặt được tên đăng nhập cho mọi người, người dùng tự đặt cho mình.</li>
            <li>Chủ cửa hàng (OWNER) — toàn quyền, xem được giá ký gửi và lợi nhuận.</li>
            <li>Bán hàng (SALES) — bán hàng và xuất hoá đơn; không xem được giá ký gửi, giá vốn hay lợi nhuận (bảng tài chính bị chặn bởi RLS; giao diện bán hàng dùng khung nhìn lô không có giá vốn).</li>
            <li>Kho (WAREHOUSE) — nhập/xuất kho, kiểm kê, trả hàng; không có dữ liệu tiền.</li>
            <li>Kế toán (ACCOUNTING) — phải trả, phải thu, đối soát, hoá đơn và báo cáo; không sửa kho trực tiếp.</li>
          </ul>
        </Card>

        {me?.role === "OWNER" && (
          <Card title="Quản lý tài khoản" className="lg:col-span-2">
            <p className="mb-4 text-xs text-slate-500">
              Chỉ Chủ cửa hàng thấy mục này. Tạo tài khoản cho nhân viên, đổi vai
              trò, khoá/mở khoá, gửi email đặt lại mật khẩu hoặc xoá tài khoản.
              Các chốt an toàn: không tự đổi vai trò, tự khoá hay tự xoá chính
              mình; hệ thống luôn giữ ít nhất một Chủ cửa hàng.
            </p>
            <UserAdminPanel
              users={profiles}
              meId={me.id}
              adminReady={isAdminConfigured()}
            />
          </Card>
        )}
      </div>
    </>
  );
}
