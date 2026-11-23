import Link from "next/link";
import { Card, EmptyState, NotConfigured, PageHeader, TableWrap, tdCls, thCls } from "@/components/ui";
import { getBusinessLineContext } from "@/lib/business-lines";
import { getCurrentProfile, getLineComparison, getPartnerRemainingEstimates, listPartnerConsignment, listProductStock, listSupplierConsignment } from "@/lib/queries";
import { checkLineTotals } from "@/lib/reporting";
import { formatNumber, formatVND } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const [suppliers, partners, stock, estimates, profile, ctx] = await Promise.all([
    listSupplierConsignment(),
    listPartnerConsignment(),
    listProductStock(),
    getPartnerRemainingEstimates(),
    getCurrentProfile(),
    getBusinessLineContext(),
  ]);
  const configured = suppliers.configured;
  // Phải trả NCC: chỉ Chủ/Kế toán/CEO. Ước tính theo giá chuyển giao là
  // giá ký gửi: Bán hàng và Thủ kho không được coi. Phải thu đối tác thì
  // Bán hàng được coi (đúng policy bảng), Thủ kho thì không.
  const role = profile.data?.role;
  const canSeePayables = ["OWNER", "ACCOUNTING", "CEO"].includes(role ?? "");
  const canSeeEstimates = ["OWNER", "ACCOUNTING", "CEO"].includes(role ?? "");
  const canSeeReceivables = ["OWNER", "ACCOUNTING", "CEO", "SALES"].includes(role ?? "");
  // P5: bảng so sánh theo ngành chỉ vai trò xem được tiền, và chỉ ở chế
  // độ ALL (khi đã chọn một ngành thì các số trên trang đã là của ngành
  // đó — giống 2 bảng theo ngành ở tầng 1 dashboard).
  const canSeeMoney = canSeePayables;
  const showLineComparison = canSeeMoney && ctx.mode === "ALL";
  const lineComparison = showLineComparison ? await getLineComparison() : [];
  const comparisonOil = lineComparison.find((r) => r.lineCode === "OIL");
  const comparisonParts = lineComparison.find((r) => r.lineCode === "AUTO_PARTS");
  const comparisonAll = lineComparison.find((r) => r.lineCode === "ALL");
  const revenueCheck = checkLineTotals(
    [comparisonOil?.revenue ?? 0, comparisonParts?.revenue ?? 0],
    comparisonAll?.revenue ?? 0,
  );

  return (
    <>
      <PageHeader title="Báo cáo" description="Các bảng này lấy thẳng từ số liệu đã ghi. Bấm xuất CSV ở đầu mỗi phần." />
      {!configured && <NotConfigured />}
      <div className="space-y-8">
        {showLineComparison && lineComparison.length > 0 && (<section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Doanh thu, lãi và tồn kho theo ngành</h2>
          </div>
          <TableWrap>
            <thead><tr><th className={thCls}>Ngành</th><th className={thCls}>Doanh thu</th><th className={thCls}>Lãi gộp</th><th className={thCls}>Số đơn</th><th className={thCls}>Tồn kho (giá vốn)</th><th className={thCls}>Phải thu còn nợ</th><th className={thCls}>Phải trả còn nợ</th></tr></thead>
            <tbody>
              {lineComparison.map((r) => (
                <tr key={r.lineLabel} className={`border-t border-slate-100 ${r.lineCode === "ALL" ? "bg-slate-50 font-bold" : ""}`}>
                  <td className={tdCls}>{r.lineLabel}</td>
                  <td className={tdCls}>{formatVND(r.revenue)}</td>
                  <td className={tdCls}>{formatVND(r.profit)}</td>
                  <td className={tdCls}>{formatNumber(r.orders)}</td>
                  <td className={tdCls}>{formatVND(r.inventoryValue)}</td>
                  <td className={tdCls}>{formatVND(r.receivableOutstanding)}</td>
                  <td className={tdCls}>{formatVND(r.payableOutstanding)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {revenueCheck.matches
              ? "Tổng các ngành = toàn doanh nghiệp (BL-020: khớp, chênh lệch 0đ)."
              : `Tổng Dầu nhớt + Phụ tùng lệch ${formatVND(Math.abs(revenueCheck.diff))} so với toàn doanh nghiệp — đúng bằng doanh thu chưa phân loại ngành (BL-020).`}
            {" "}Doanh thu là doanh thu thuần (đã trừ giảm giá); tồn kho tính theo giá vốn lô, chỉ hàng TVK sở hữu.
          </p>
        </section>)}
        {canSeePayables && (<section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Đối chiếu hàng ký gửi với nhà cung cấp (đã nhận – đã bán – đã trả – còn giữ – còn nợ)</h2>
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
        </section>)}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Đối chiếu hàng gửi đối tác (số đã gửi phải bằng số đã bán + đã trả lại + còn giữ)</h2>
            {canSeeReceivables && (<a href="/api/export?view=v_partner_consignment" className="text-sm text-blue-600 hover:underline">Xuất CSV</a>)}
          </div>
          {canSeeEstimates && (<p className="mb-3 text-sm leading-relaxed text-slate-600">
            Cột “Giá trị còn giữ (ước tính)” tính theo giá chuyển giao của phiếu gửi gần nhất — là số tiền sẽ thu
            khi đối tác bán hết số hàng còn giữ. Đây chỉ là ước tính để dễ hình dung, chưa phải khoản phải thu:
            phải thu chỉ phát sinh khi đối tác bán hàng.
          </p>)}
          {partners.data.length === 0 ? <EmptyState message="Chưa có dữ liệu." /> : (
            <TableWrap>
              <thead><tr><th className={thCls}>Đối tác</th><th className={thCls}>Đã gửi</th><th className={thCls}>Đã bán</th><th className={thCls}>Đã trả</th><th className={thCls}>Còn giữ</th>{canSeeEstimates && (<th className={thCls}>Giá trị còn giữ (ước tính)</th>)}<th className={thCls}>Kiểm tra</th>{canSeeReceivables && (<th className={thCls}>Còn phải thu</th>)}</tr></thead>
              <tbody>
                {partners.data.map((r) => {
                  const ok = Number(r.qty_sent) === Number(r.qty_consumed) + Number(r.qty_returned) + Number(r.qty_still_at_partner);
                  const est = estimates.get(String(r.partner_id)) ?? 0;
                  return (
                    <tr key={r.partner_id} className="border-t border-slate-100">
                      <td className={tdCls}><Link href={`/partners/${r.partner_id}`} className="font-medium text-blue-700 hover:underline">{r.partner_name}</Link></td>
                      <td className={tdCls}>{formatNumber(r.qty_sent)}</td>
                      <td className={tdCls}>{formatNumber(r.qty_consumed)}</td>
                      <td className={tdCls}>{formatNumber(r.qty_returned)}</td>
                      <td className={tdCls}>{formatNumber(r.qty_still_at_partner)}</td>
                      {canSeeEstimates && (<td className={`${tdCls} font-medium`}>{est > 0 ? (<>{formatVND(est)} <span className="text-slate-400">(ước tính)</span></>) : formatVND(0)}</td>)}
                      <td className={`${tdCls} ${ok ? "text-green-600" : "font-semibold text-red-600"}`}>{ok ? "Khớp" : "LỆCH"}</td>
                      {canSeeReceivables && (<td className={`${tdCls} font-medium`}>{formatVND(r.receivable_outstanding)}</td>)}
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
            mua về, của mình), <strong className="text-slate-800">được ký gửi</strong> (nhà cung cấp gửi mình giữ/bán hộ),
            {" "}<strong className="text-slate-800">gửi ký gửi</strong> (mình gửi cho đối tác bán hộ, vẫn là của mình),
            {" "}<strong className="text-slate-800">KG tầng 2</strong> (hàng của nhà cung cấp mà mình gửi tiếp cho đối tác —
            tầng ký gửi thứ hai, mặc định khoá, chỉ mở khi nhà cung cấp đó đồng ý).
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
                  <th className={thCls}>Được ký gửi</th>
                  <th className={thCls}>Gửi ký gửi</th>
                  <th className={thCls}>KG tầng 2</th>
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
            <li>Mọi lô đều tra lại được đầu-cuối trong lịch sử di chuyển (Tồn kho theo lô → lô → các lần di chuyển đã ghi).</li>
            <li>Số lệch nghĩa là: số đã gửi không bằng số đã bán + đã trả lại + còn giữ — cần hỏi lại đối tác trước lần đối chiếu sau.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
