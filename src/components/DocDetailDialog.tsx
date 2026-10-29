"use client";

import { Fragment, useEffect, useState } from "react";
import { tdCls, thCls } from "@/components/ui";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { getDocumentDetailAction, type DetailKind } from "@/lib/detail-actions";
import type { DocumentDetail } from "@/lib/queries";

/** Nút mã chứng từ / phiếu / hoá đơn: bấm thì mở cửa sổ bật lên hiện danh
 *  sách hàng hoá, số tiền bán (hoặc dự kiến với hàng ký gửi) và tổng lợi
 *  nhuận (hoặc dự kiến). Chi tiết chỉ tải khi bấm. */
export default function DocDetailDialog({
  kind,
  id,
  label,
  sub,
}: {
  kind: DetailKind;
  id: string;
  label: string;
  sub?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [canSeeCost, setCanSeeCost] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  async function openDialog() {
    setOpen(true);
    setLoading(true);
    setFailed(false);
    try {
      const res = await getDocumentDetailAction(kind, id);
      setDetail(res.detail);
      setCanSeeCost(res.canSeeCost);
      if (!res.detail) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const isSlip = detail?.kind === "SLIP";
  const grouped = detail?.kind === "INV";
  const groups: { code: string; date: string; lines: NonNullable<DocumentDetail["lines"]> }[] = [];
  if (detail && grouped) {
    for (const l of detail.lines) {
      const code = l.docCode ?? "—";
      const date = l.docDate ?? "";
      const g = groups.find((x) => x.code === code);
      if (g) g.lines.push(l);
      else groups.push({ code, date, lines: [l] });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="touch-control text-left font-medium text-blue-700 hover:underline"
        title="Bấm để xem chi tiết hàng hoá"
      >
        {label}
        {sub && <span className="block text-xs font-normal text-slate-500">{sub}</span>}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{detail ? detail.kindLabel : "Chi tiết hàng hoá"}</h2>
                <p className="text-sm text-slate-500">
                  {label}
                  {detail && ` · ${formatDate(detail.date)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Đóng"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-slate-500 hover:bg-slate-100"
              >
                ×
              </button>
            </div>
            {loading && <p className="py-6 text-center text-sm text-slate-500">Đang tải chi tiết…</p>}
            {failed && !loading && (
              <p className="py-6 text-center text-sm text-red-600">Không tải được chi tiết. Đóng cửa sổ rồi thử lại.</p>
            )}
            {detail && !loading && (
              <>
                {detail.lines.length === 0 ? (
                  <p className="py-4 text-sm text-slate-500">Chứng từ này không có dòng hàng hoá nào.</p>
                ) : isSlip ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="text-left">
                          <th className={thCls}>Sản phẩm</th>
                          <th className={thCls}>Lô</th>
                          <th className={thCls}>Đã gửi</th>
                          <th className={thCls}>Đã tiêu thụ</th>
                          <th className={thCls}>Còn giữ</th>
                          <th className={thCls}>Giá chuyển giao</th>
                          <th className={thCls}>Tiền đã bán</th>
                          <th className={thCls}>Tiền dự kiến</th>
                          {canSeeCost && <th className={thCls}>Lãi đã bán</th>}
                          {canSeeCost && <th className={thCls}>Lãi dự kiến</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.lines.map((l, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className={tdCls}>
                              {l.productName}
                              <span className="block text-xs text-slate-500">{l.sku}</span>
                            </td>
                            <td className={tdCls}>{l.batchCode}</td>
                            <td className={tdCls}>{formatNumber(l.qty)}</td>
                            <td className={tdCls}>{formatNumber(l.consumedQty ?? 0)}</td>
                            <td className={tdCls}>{formatNumber(l.remainingQty ?? 0)}</td>
                            <td className={tdCls}>{formatVND(l.unitPrice)}</td>
                            <td className={tdCls}>{formatVND(l.consumedAmount ?? 0)}</td>
                            <td className={tdCls}>{formatVND(l.remainingEstimate ?? 0)}</td>
                            {canSeeCost && <td className={tdCls}>{formatVND(l.consumedProfit ?? 0)}</td>}
                            {canSeeCost && <td className={tdCls}>{formatVND(l.remainingProfitEstimate ?? 0)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead>
                        <tr className="text-left">
                          <th className={thCls}>Sản phẩm</th>
                          <th className={thCls}>Lô</th>
                          <th className={thCls}>Số lượng</th>
                          <th className={thCls}>Đơn giá</th>
                          <th className={thCls}>Thành tiền</th>
                          {canSeeCost && <th className={thCls}>Giá vốn</th>}
                          {canSeeCost && <th className={thCls}>Lãi gộp</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {(grouped ? groups : [{ code: "", date: "", lines: detail.lines }]).map((g) => (
                          <Fragment key={g.code || "all"}>
                            {grouped && (
                              <tr key={`g-${g.code}`} className="border-t border-slate-100 bg-slate-50">
                                <td colSpan={canSeeCost ? 7 : 5} className={`${tdCls} font-medium`}>
                                  Chứng từ {g.code}
                                  {g.date && ` · ${formatDate(g.date)}`}
                                </td>
                              </tr>
                            )}
                            {g.lines.map((l, i) => (
                              <tr key={`${g.code}-${i}`} className="border-t border-slate-100">
                                <td className={tdCls}>
                                  {l.productName}
                                  <span className="block text-xs text-slate-500">{l.sku}</span>
                                </td>
                                <td className={tdCls}>{l.batchCode}</td>
                                <td className={tdCls}>{formatNumber(l.qty)}</td>
                                <td className={tdCls}>{formatVND(l.unitPrice)}</td>
                                <td className={tdCls}>{formatVND(l.amount)}</td>
                                {canSeeCost && <td className={tdCls}>{formatVND(l.qty * l.unitCost)}</td>}
                                {canSeeCost && <td className={tdCls}>{formatVND(l.profit)}</td>}
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <dl className="mt-4 space-y-1 text-sm">
                  {isSlip ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Tiền đã bán (đã tiêu thụ)</dt>
                        <dd className="font-medium">{formatVND(detail.consumedAmount ?? 0)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Tiền dự kiến (còn giữ tại đối tác)</dt>
                        <dd className="font-medium">{formatVND(detail.remainingEstimate ?? 0)}</dd>
                      </div>
                      <div className="flex justify-between gap-3 border-t border-slate-100 pt-1">
                        <dt className="text-slate-500">Tổng dự kiến (đã bán + còn giữ)</dt>
                        <dd className="font-semibold">{formatVND(detail.totalAmount)}</dd>
                      </div>
                      {canSeeCost && (
                        <>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Lãi đã bán</dt>
                            <dd className="font-medium">{formatVND(detail.consumedProfit ?? 0)}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Lãi dự kiến (còn giữ)</dt>
                            <dd className="font-medium">{formatVND(detail.remainingProfitEstimate ?? 0)}</dd>
                          </div>
                          <div className="flex justify-between gap-3 border-t border-slate-100 pt-1">
                            <dt className="text-slate-500">Tổng lãi dự kiến</dt>
                            <dd className="font-semibold">{formatVND(detail.totalProfit)}</dd>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Tổng tiền bán</dt>
                        <dd className="font-semibold">{formatVND(detail.totalAmount)}</dd>
                      </div>
                      {canSeeCost && (
                        <>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Tổng giá vốn</dt>
                            <dd className="font-medium">{formatVND(detail.totalCost)}</dd>
                          </div>
                          <div className="flex justify-between gap-3 border-t border-slate-100 pt-1">
                            <dt className="text-slate-500">Tổng lợi nhuận gộp</dt>
                            <dd className="font-semibold">{formatVND(detail.totalProfit)}</dd>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </dl>
                {detail.note && <p className="mt-3 text-xs leading-relaxed text-slate-500">{detail.note}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
