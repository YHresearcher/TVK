import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, tdCls, thCls } from "@/components/ui";
import { listPartnerConsignment, listProductStock, listSupplierConsignment } from "@/lib/queries";
import { formatNumber, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const [suppliers, partners, stock] = await Promise.all([
    listSupplierConsignment(),
    listPartnerConsignment(),
    listProductStock(),
  ]);
  const configured = suppliers.configured;

  return (
    <>
      <PageHeader title="Báo cáo" description="Các báo cáo đối soát lấy thẳng từ cơ sở dữ liệu. Liên kết xuất CSV ở đầu mỗi phần." />
      {!configured && <NotConfigured />}
      <div className="space-y-8">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Đối soát ký gửi nhà cung cấp (đã nhận – đã bán – đã trả – còn trên kệ – còn nợ)</h2>
            <a href="/api/export?view=v_supplier_consignment" className="text-sm text-blue-600 hover:underline">Xuất CSV</a>
          </div>
          {suppliers.data.length === 0 ? <EmptyState message="Chưa có dữ liệu." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Nhà cung cấp</th><th className={thCls}>Đã nhận</th><th className={thCls}>Đã bán</th><th className={thCls}>Đã trả</th><th className={thCls}>Còn tại Kho TVK</th><th className={thCls}>Còn nợ phải trả</th></tr></thead>
              <tbody>
                {suppliers.data.map((r) => (
                  <tr key={r.supplier_id} className="border-t border-slate-100">
                    <td className={tdCls}>{r.supplier_name}</td>
                    <td className={tdCls}>{formatNumber(r.qty_received)}</td>
                    <td className={tdCls}>{formatNumber(r.qty_sold)}</td>
                    <td className={tdCls}>{formatNumber(r.qty_returned)}</td>
                    <td className={tdCls}>{formatNumber(r.qty_on_hand_own_wh)}</td>
                    <td className={`${tdCls} font-medium`}>{formatVND(r.payable_outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Đối soát ký gửi đối tác — kiểm soát: đã gửi = đã tiêu thụ + đã trả + còn giữ</h2>
            <a href="/api/export?view=v_partner_consignment" className="text-sm text-blue-600 hover:underline">Xuất CSV</a>
          </div>
          {partners.data.length === 0 ? <EmptyState message="Chưa có dữ liệu." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Đối tác</th><th className={thCls}>Đã gửi</th><th className={thCls}>Đã tiêu thụ</th><th className={thCls}>Đã trả</th><th className={thCls}>Còn giữ</th><th className={thCls}>Kiểm tra</th><th className={thCls}>Còn phải thu</th></tr></thead>
              <tbody>
                {partners.data.map((r) => {
                  const ok = Number(r.qty_sent) === Number(r.qty_consumed) + Number(r.qty_returned) + Number(r.qty_still_at_partner);
                  return (
                    <tr key={r.partner_id} className="border-t border-slate-100">
                      <td className={tdCls}><Link href={`/partners/${r.partner_id}`} className="font-medium text-blue-700 hover:underline">{r.partner_name}</Link></td>
                      <td className={tdCls}>{formatNumber(r.qty_sent)}</td>
                      <td className={tdCls}>{formatNumber(r.qty_consumed)}</td>
                      <td className={tdCls}>{formatNumber(r.qty_returned)}</td>
                      <td className={tdCls}>{formatNumber(r.qty_still_at_partner)}</td>
                      <td className={`${tdCls} ${ok ? "text-green-600" : "font-semibold text-red-600"}`}>{ok ? "Khớp" : "LỆCH"}</td>
                      <td className={`${tdCls} font-medium`}>{formatVND(r.receivable_outstanding)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Tổng hợp tồn kho theo sản phẩm</h2>
            <a href="/api/export?view=v_product_stock" className="text-sm text-blue-600 hover:underline">Xuất CSV</a>
          </div>
          <p className="mb-3 text-sm leading-relaxed text-slate-600">
            Mỗi hàng là một sản phẩm, chia theo 2 chiều: hàng đang ở <strong className="text-slate-800">kho TVK</strong> hay
            ở <strong className="text-slate-800">kho đối tác</strong> — và hàng là <strong className="text-slate-800">tự nhập</strong> (mình
            mua về, của mình), <strong className="text-slate-800">được ký gởi</strong> (nhà cung cấp gửi mình giữ/bán hộ),
            {" "}<strong className="text-slate-800">gửi ký gởi</strong> (mình gửi cho đối tác bán hộ, vẫn là của mình),
            {" "}<strong className="text-slate-800">ký gởi tiếp</strong> (hàng của nhà cung cấp mà mình gửi tiếp cho đối tác —
            mặc định khoá, chỉ mở khi nhà cung cấp đó đồng ý).
          </p>
          {stock.data.length === 0 ? <EmptyState message="Chưa có dữ liệu." /> : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={thCls} rowSpan={2}>SKU</th>
                  <th className={thCls} rowSpan={2}>Sản phẩm</th>
                  <th className={`${thCls} text-center`} colSpan={2}>Tại kho TVK</th>
                  <th className={`${thCls} text-center`} colSpan={2}>Kho đối tác</th>
                  <th className={thCls} rowSpan={2}>Tổng</th>
                </tr>
                <tr>
                  <th className={thCls}>Tự nhập</th>
                  <th className={thCls}>Được ký gởi</th>
                  <th className={thCls}>Gửi ký gởi</th>
                  <th className={thCls}>Ký gởi tiếp</th>
                </tr>
              </thead>
              <tbody>
                {stock.data.map((r) => (
                  <tr key={r.product_id} className="border-t border-slate-100">
                    <td className={tdCls}>{r.sku}</td>
                    <td className={tdCls}>{r.name}</td>
                    <td className={tdCls}>{formatNumber(r.owned_at_own_wh)}</td>
                    <td className={tdCls}>{formatNumber(r.consigned_at_own_wh)}</td>
                    <td className={tdCls}>{formatNumber(r.owned_at_partners)}</td>
                    <td className={tdCls}>{formatNumber(r.consigned_at_partners)}</td>
                    <td className={`${tdCls} font-medium`}>{formatNumber(r.total_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </section>

        <Card title="Ghi chú">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Doanh thu & lợi nhuận theo nguồn (của mình vs ký gửi) chỉ vai trò Chủ cửa hàng mới xem được, theo quy tắc vai trò trong tài liệu đặc tả.</li>
            <li>Mọi lô đều truy vết được đầu-cuối trong sổ cái di chuyển (Tồn kho theo lô → lô → các di chuyển được ghi trong <code>stock_movements</code>).</li>
            <li>LỆCH trong kiểm tra đối tác nghĩa là: đã gửi ≠ đã tiêu thụ + đã trả + còn giữ — cần làm rõ với đối tác trước đợt đối soát tiếp theo.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
