import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, btnCls, inputCls, labelCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import UserAdminPanel from "@/components/UserAdminPanel";
import { createWarehouseAction, updateWarehouseAction, updateVatModeAction } from "@/lib/actions";
import { getCurrentProfile, listLocations } from "@/lib/queries";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isReadOnlyRole, type AnyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { ok?: string; edit?: string };
}) {
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
  // Sửa kho theo đúng quyền ghi của RLS bảng locations: Chủ cửa hàng + Thủ kho.
  const canEditWarehouse = ["OWNER", "WAREHOUSE"].includes(me?.role ?? "");
  const editingWarehouse = canEditWarehouse
    ? warehouses.find((l) => l.id === searchParams.edit)
    : undefined;

  return (
    <>
      <PageHeader title="Cài đặt" description="Các tuỳ chọn toàn hệ thống. Chế độ hoá đơn GTGT phải khớp với quyết định của kế toán cùng với mô hình hợp đồng ký gửi." />
      {!locations.configured && <NotConfigured />}
      {isReadOnlyRole(me?.role) ? (
        <Card title="Vai trò chỉ xem">
          <p className="text-sm leading-relaxed text-slate-600">
            Tài khoản của bạn mang vai trò <strong>CEO (chỉ xem)</strong>: bạn
            xem được toàn bộ số liệu kho và tài chính ở Tổng quan, Báo cáo và
            các danh sách, nhưng không thay đổi được dữ liệu. Các mục cài đặt
            hệ thống, quản lý kho và quản lý tài khoản chỉ dành cho Chủ cửa
            hàng (OWNER) nên không hiển thị ở đây — và cơ sở dữ liệu cũng
            không cấp quyền ghi cho vai trò của bạn.
          </p>
        </Card>
      ) : (
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
              Đây là chế độ MẶC ĐỊNH khi mở form Phát hành hoá đơn — người xuất vẫn chọn lại Gộp/Tách ngay trên form cho từng lần xuất, nên đối tác nào cần cách riêng vẫn xử lý được. Dù chọn cách nào, các chứng từ quản lý nội bộ (BH / KG) luôn tách riêng và mỗi
              dòng hoá đơn luôn liên kết với đúng một chứng từ. Cài đặt này chỉ quyết định cách
              nhóm các dòng khi phát hành hoá đơn pháp lý.
            </p>
            <SubmitButton className={btnCls}>Lưu</SubmitButton>
          </form>
        </Card>

        <Card title="Kho / địa điểm của TVK">
          {warehouses.length === 0 ? <EmptyState message="Chưa có kho — hãy tạo kho đầu tiên." /> : (
            <ul className="space-y-1 text-sm">
              {warehouses.map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-2">
                  <span>{l.name}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="text-slate-500">{l.detail ?? ""}</span>
                    {canEditWarehouse && (
                      <Link href={`/settings?edit=${l.id}`} className="font-medium text-blue-700 hover:underline">
                        Sửa
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEditWarehouse && (
            <form
              key={editingWarehouse?.id ?? "new"}
              action={editingWarehouse ? updateWarehouseAction : createWarehouseAction}
              className="mt-4 space-y-2 border-t border-slate-100 pt-3"
            >
              {editingWarehouse && <input type="hidden" name="id" value={editingWarehouse.id} />}
              <div className="flex gap-2">
                <input name="name" required placeholder="Tên kho (Kho chính)" defaultValue={editingWarehouse?.name ?? ""} className={inputCls} />
                <input name="detail" placeholder="Chi tiết (địa chỉ / khu vực kệ)" defaultValue={editingWarehouse?.detail ?? ""} className={inputCls} />
              </div>
              <div className="flex items-center gap-3">
                <SubmitButton className={btnCls}>{editingWarehouse ? "Lưu thay đổi" : "Thêm kho"}</SubmitButton>
                {editingWarehouse && (
                  <Link href="/settings" className="text-sm text-slate-500 hover:underline">
                    Huỷ
                  </Link>
                )}
              </div>
            </form>
          )}
          {partnerWarehouses.length > 0 && (
            <p className="mt-4 text-xs text-slate-500">
              Kho ảo của đối tác ({partnerWarehouses.length}) được tạo tự động khi phiếu gửi ký gửi đầu tiên cho một đối tác được xác nhận.
            </p>
          )}
        </Card>

        {me?.role === "OWNER" && (
          <Card title="Quản lý tài khoản" className="lg:col-span-2">
            <p className="mb-4 text-xs text-slate-500">
              Chỉ Chủ cửa hàng thấy mục này. Tạo tài khoản cho nhân viên, sửa
              họ tên và tên đăng nhập, đổi vai trò, khoá/mở khoá, gửi email
              đặt lại mật khẩu hoặc xoá tài khoản.
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
      )}
    </>
  );
}
