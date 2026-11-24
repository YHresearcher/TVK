import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, btnCls, inputCls, labelCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import UserAdminPanel from "@/components/UserAdminPanel";
import { assignUserBusinessLineAction, createCashFundAction, createWarehouseAction, revokeUserBusinessLineAction, updateCashFundAction, updateProductBusinessLineAction, updateWarehouseAction, updateVatModeAction } from "@/lib/actions";
import { listBusinessLines, listUnclassifiedProducts, listUserBusinessLines } from "@/lib/business-lines";
import { getCashFundBalances, getCurrentProfile, listCashFunds, listLocations } from "@/lib/queries";
import { formatVND } from "@/lib/format";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_LINE_LABELS, ROLE_LABELS, isReadOnlyRole, type AnyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { ok?: string; edit?: string; editFund?: string };
}) {
  const locations = await listLocations();
  const funds = await listCashFunds();
  const fundBalances = await getCashFundBalances();
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
  // P2 (chỉ OWNER): phân quyền ngành + hàng chờ phân loại.
  const isOwner = me?.role === "OWNER";
  const [lines, assignments, unclassified] = isOwner
    ? await Promise.all([listBusinessLines(), listUserBusinessLines(), listUnclassifiedProducts()])
    : [[], [], []] as [Awaited<ReturnType<typeof listBusinessLines>>, Awaited<ReturnType<typeof listUserBusinessLines>>, Awaited<ReturnType<typeof listUnclassifiedProducts>>];
  const linesByUser = new Map<string, { lineId: string; lineCode: string }[]>();
  for (const a of assignments) {
    const list = linesByUser.get(a.userId) ?? [];
    list.push({ lineId: a.lineId, lineCode: a.lineCode });
    linesByUser.set(a.userId, list);
  }
  // Sửa kho theo đúng quyền ghi của RLS bảng locations: Chủ cửa hàng + Thủ kho.
  const canEditWarehouse = ["OWNER", "WAREHOUSE"].includes(me?.role ?? "");
  const editingWarehouse = canEditWarehouse
    ? warehouses.find((l) => l.id === searchParams.edit)
    : undefined;
  // Quỹ tiền: chỉ Chủ cửa hàng + Kế toán thấy và sửa (tiền chỉ 2 vai trò này đụng).
  const canEditFunds = ["OWNER", "ACCOUNTING"].includes(me?.role ?? "");
  const fundBalance = new Map(fundBalances.data.map((f) => [f.fund_id, f]));
  const editingFund = canEditFunds
    ? funds.data.find((f) => f.id === searchParams.editFund)
    : undefined;

  return (
    <>
      <PageHeader title="Cài đặt" description="Các cài đặt dùng chung cho cả hệ thống. Cách ghi hoá đơn GTGT phải theo đúng quyết định của kế toán và hợp đồng ký gửi đã ký." />
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
        <Card title="Chế độ hoá đơn GTGT (theo dõi nội bộ)">
          <form action={updateVatModeAction} className="space-y-3">
            <div>
              <label className={labelCls}>Cách gộp hoá đơn khi ghi nhận</label>
              <select name="vat_invoice_mode" defaultValue={vatMode} className={inputCls}>
                <option value="COMBINED">COMBINED — một hoá đơn GTGT, mỗi tính chất một dòng</option>
                <option value="SEPARATE">SEPARATE — hai hoá đơn GTGT, mỗi tính chất một hoá đơn</option>
              </select>
            </div>
            <p className="text-xs text-slate-500">
              Đây là chế độ MẶC ĐỊNH khi mở form ghi nhận hoá đơn — người ghi vẫn chọn lại Gộp/Tách ngay trên form cho từng lần ghi nhận, nên đối tác nào cần cách riêng vẫn xử lý được. Dù chọn cách nào, các phiếu bán nội bộ (BH / KG) luôn tách riêng và mỗi
              dòng hoá đơn luôn gắn với đúng một phiếu bán. Cài đặt này chỉ quyết định cách
              nhóm các dòng khi ghi nhận hoá đơn.
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
              Kho của đối tác trên hệ thống ({partnerWarehouses.length}) được tạo tự động khi phiếu gửi ký gửi đầu tiên cho một đối tác được xác nhận.
            </p>
          )}
        </Card>

        {canEditFunds && (
        <Card title="Quỹ tiền">
          <p className="mb-3 text-xs leading-relaxed text-slate-500">
            Két tiền mặt và tài khoản ngân hàng của TVK. Số dư đầu kỳ là số
            tiền thực tế trong quỹ tại thời điểm nhập — đã bao gồm ảnh hưởng
            của các phiếu thu/chi cũ (chưa gắn quỹ). Từ nay mỗi lần ghi thu
            (PT) hay chi (PC) phải chọn quỹ, số dư tự cập nhật theo.
          </p>
          {funds.data.length === 0 ? <EmptyState message="Chưa có quỹ tiền." /> : (
            <ul className="space-y-1 text-sm">
              {funds.data.map((f) => {
                const b = fundBalance.get(f.id);
                return (
                  <li key={f.id} className="flex items-baseline justify-between gap-2">
                    <span>
                      <span className="font-medium">{f.name}</span>{" "}
                      <span className="text-xs text-slate-500">({f.kind === "CASH" ? "Tiền mặt" : "Ngân hàng"}){!f.is_active ? " · đã tắt" : ""}</span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="font-bold">{formatVND(b?.balance ?? f.opening_balance)}</span>
                      <Link href={`/settings?editFund=${f.id}`} className="font-medium text-blue-700 hover:underline">
                        Sửa
                      </Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <form
            key={editingFund?.id ?? "new-fund"}
            action={editingFund ? updateCashFundAction : createCashFundAction}
            className="mt-4 space-y-2 border-t border-slate-100 pt-3"
          >
            {editingFund && <input type="hidden" name="id" value={editingFund.id} />}
            <div><label className={labelCls}>Tên quỹ *</label><input name="name" required placeholder="Két tiền mặt / Vietcombank — 1234" defaultValue={editingFund?.name ?? ""} className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-3">
              {editingFund ? (
                <div><label className={labelCls}>Loại quỹ</label><input value={editingFund.kind === "CASH" ? "Tiền mặt" : "Ngân hàng"} disabled className={inputCls} /></div>
              ) : (
                <div><label className={labelCls}>Loại quỹ</label>
                  <select name="kind" className={inputCls}>
                    <option value="CASH">Tiền mặt (két)</option>
                    <option value="BANK">Ngân hàng</option>
                  </select></div>
              )}
              <div><label className={labelCls}>Số dư đầu kỳ *</label><input name="opening_balance" type="number" step="1" required defaultValue={editingFund?.opening_balance ?? 0} className={inputCls} /></div>
            </div>
            {editingFund && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="is_active" defaultChecked={editingFund.is_active} className="h-4 w-4" />
                Đang dùng (bỏ tick để tắt quỹ, giữ nguyên lịch sử)
              </label>
            )}
            <div className="flex items-center gap-3">
              <SubmitButton className={btnCls}>{editingFund ? "Lưu thay đổi" : "Thêm quỹ"}</SubmitButton>
              {editingFund && (
                <Link href="/settings" className="text-sm text-slate-500 hover:underline">
                  Huỷ
                </Link>
              )}
            </div>
          </form>
        </Card>
        )}

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

        {/* P2: phân quyền ngành hàng + hàng chờ phân loại (chỉ OWNER). */}
        {me?.role === "OWNER" && (
          <Card title="Ngành hàng của tài khoản" className="lg:col-span-2">
            <p className="mb-4 text-xs leading-relaxed text-slate-500">
              Ai được làm việc với ngành nào. Tài khoản chưa gán ngành thì
              không xem được dữ liệu (fail-closed); Chủ cửa hàng và CEO luôn
              xem được toàn doanh nghiệp, kể cả khi chưa gán. Gán mặc định:
              cả 5 tài khoản hiện có đều thấy Phụ tùng.
            </p>
            <ul className="space-y-3 text-sm">
              {profiles.map((u) => {
                const assigned = linesByUser.get(u.id) ?? [];
                const assignedIds = new Set(assigned.map((a) => a.lineId));
                const isAllSeeing = ["OWNER", "CEO"].includes(u.role);
                return (
                  <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{u.full_name ?? u.username ?? "—"}</span>{" "}
                      <span className="text-xs text-slate-500">({ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}{isAllSeeing ? " · xem toàn doanh nghiệp" : ""})</span>
                    </span>
                    <span className="ml-auto flex flex-wrap items-center gap-2">
                      {assigned.map((a) => (
                        <span key={a.lineId} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                          {BUSINESS_LINE_LABELS[a.lineCode as keyof typeof BUSINESS_LINE_LABELS] ?? a.lineCode}
                          <form action={revokeUserBusinessLineAction.bind(null, u.id, a.lineId)}>
                            <button type="submit" className="font-bold text-emerald-600 hover:text-red-600" aria-label={`Thu hồi ngành ${BUSINESS_LINE_LABELS[a.lineCode as keyof typeof BUSINESS_LINE_LABELS] ?? a.lineCode} của ${u.full_name ?? u.username}`}>
                              ×
                            </button>
                          </form>
                        </span>
                      ))}
                      {lines.filter((l) => !assignedIds.has(l.id)).map((l) => (
                        <form key={l.id} action={assignUserBusinessLineAction.bind(null, u.id, l.id)}>
                          <SubmitButton className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                            + Gán {BUSINESS_LINE_LABELS[l.code]}
                          </SubmitButton>
                        </form>
                      ))}
                      {assigned.length === 0 && !isAllSeeing && (
                        <span className="text-xs font-medium text-amber-700">Chưa gán ngành — không xem được dữ liệu</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {me?.role === "OWNER" && (
          <Card title="Sản phẩm chưa phân loại ngành" className="lg:col-span-2">
            <p className="mb-4 text-xs leading-relaxed text-slate-500">
              Sản phẩm chưa xếp ngành thì chưa bán, chưa gửi ký gửi được —
              chứng từ có ngành chỉ nhận dòng cùng ngành. Phân loại ở đây
              trước khi tạo chứng từ cho chúng. Sản phẩm đã có giao dịch thì
              không đổi được ngành (hệ thống chặn để sổ sách không lệch).
            </p>
            {unclassified.length === 0 ? (
              <EmptyState message="Không còn sản phẩm chưa phân loại." />
            ) : (
              <ul className="space-y-2 text-sm">
                {unclassified.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-mono text-xs">{p.sku}</span>{" "}
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-slate-500"> · {p.product_group ?? "chưa xếp nhóm"}</span>
                    </span>
                    <span className="ml-auto flex flex-wrap items-center gap-2">
                      {lines.map((l) => (
                        <form key={l.id} action={updateProductBusinessLineAction.bind(null, p.id, l.id)}>
                          <SubmitButton className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                            Gán {BUSINESS_LINE_LABELS[l.code]}
                          </SubmitButton>
                        </form>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
      )}
    </>
  );
}
