"use client";

import { useEffect, useMemo, useState } from "react";
import BarcodeLabel, { LABEL_SIZES } from "@/components/BarcodeLabel";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { formatVND } from "@/lib/format";

export interface LabelProduct {
  id: string;
  sku: string;
  name: string;
  retail_price: number;
  totalQty: number;
}

interface PrintLabel {
  code: string;
  name: string;
  priceText?: string;
}

/** Tối đa tem mỗi lần in — tránh treo trình duyệt khi tồn kho lớn. */
const MAX_LABELS_PER_JOB = 500;

/**
 * In tem mã vạch từ trang Sản phẩm.
 *
 * Trình duyệt không điều khiển trực tiếp máy in tem; hệ thống tạo tờ tem
 * (mỗi tem một trang, khổ trang = khổ tem) rồi in qua hộp thoại in của hệ
 * điều hành — người dùng chọn đúng máy in tem đã cài driver + khổ tem ở đó.
 * Số lượng mặc định của mỗi mã bằng tồn kho (Tổng), sửa tay được.
 */
export default function LabelPrintButton({
  products,
}: {
  products: LabelProduct[];
}) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [qty, setQty] = useState<Record<string, number>>({});
  const [showPrice, setShowPrice] = useState(false);
  const [sizeId, setSizeId] = useState(LABEL_SIZES[0].id);
  const [printLabels, setPrintLabels] = useState<PrintLabel[] | null>(null);

  const size = LABEL_SIZES.find((s) => s.id === sizeId) ?? LABEL_SIZES[0];

  function openDialog() {
    const c: Record<string, boolean> = {};
    const q: Record<string, number> = {};
    for (const p of products) {
      c[p.id] = p.totalQty > 0;
      q[p.id] = p.totalQty;
    }
    setChecked(c);
    setQty(q);
    setOpen(true);
  }

  const totalLabels = useMemo(
    () =>
      products.reduce(
        (sum, p) => sum + (checked[p.id] ? Math.max(0, qty[p.id] ?? 0) : 0),
        0
      ),
    [products, checked, qty]
  );

  // Khi tờ tem đã render xong: đặt khổ trang = khổ tem rồi mở hộp thoại in.
  useEffect(() => {
    if (!printLabels) return;
    const style = document.createElement("style");
    style.textContent = `@page { size: ${size.w}mm ${size.h}mm; margin: 0; }`;
    document.head.appendChild(style);
    const t = window.setTimeout(() => window.print(), 150);
    const done = () => setPrintLabels(null);
    window.addEventListener("afterprint", done, { once: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", done);
      document.head.removeChild(style);
    };
  }, [printLabels, size]);

  function handlePrint() {
    const labels: PrintLabel[] = [];
    for (const p of products) {
      const n = checked[p.id] ? Math.max(0, qty[p.id] ?? 0) : 0;
      for (let i = 0; i < n; i++) {
        labels.push({
          code: p.sku,
          name: p.name,
          priceText:
            showPrice && p.retail_price > 0
              ? formatVND(p.retail_price)
              : undefined,
        });
      }
    }
    if (!labels.length) return;
    setOpen(false);
    setPrintLabels(labels);
  }

  return (
    <>
      <button type="button" onClick={openDialog} className={btnCls}>
        In tem mã vạch
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">In tem mã vạch</h2>
            <p className="mt-1 text-sm text-slate-500">
              Danh sách theo bộ lọc hiện tại. Số lượng mặc định bằng tồn kho
              (Tổng) của từng mã — sửa tay được. In qua hộp thoại của hệ điều
              hành: chọn đúng máy in tem đã cài khổ tem.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={btnGhostCls}
                onClick={() =>
                  setChecked(Object.fromEntries(products.map((p) => [p.id, true])))
                }
              >
                Chọn tất cả
              </button>
              <button
                type="button"
                className={btnGhostCls}
                onClick={() =>
                  setChecked(Object.fromEntries(products.map((p) => [p.id, false])))
                }
              >
                Bỏ chọn tất cả
              </button>
              <div className="ml-auto flex items-center gap-2">
                <label className={labelCls}>Khổ tem</label>
                <select
                  value={sizeId}
                  onChange={(e) => setSizeId(e.target.value)}
                  className={inputCls}
                >
                  {LABEL_SIZES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={showPrice}
                onChange={(e) => setShowPrice(e.target.checked)}
                className="h-4 w-4"
              />
              In giá lẻ lên tem
            </label>
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
              {products.length === 0 ? (
                <p className="text-sm text-slate-500">Không có sản phẩm nào.</p>
              ) : (
                products.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={!!checked[p.id]}
                      onChange={(e) =>
                        setChecked({ ...checked, [p.id]: e.target.checked })
                      }
                      className="h-4 w-4 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {p.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.sku} · Tồn: {p.totalQty}
                      </p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={qty[p.id] ?? 0}
                      disabled={!checked[p.id]}
                      onChange={(e) =>
                        setQty({
                          ...qty,
                          [p.id]: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                        })
                      }
                      className={`${inputCls} w-20 shrink-0`}
                      aria-label={`Số tem cho ${p.sku}`}
                    />
                  </div>
                ))
              )}
            </div>
            {totalLabels > MAX_LABELS_PER_JOB && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Tối đa {MAX_LABELS_PER_JOB} tem mỗi lần in — hãy giảm số lượng
                hoặc chia nhỏ rồi in nhiều lần.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={btnGhostCls}
                onClick={() => setOpen(false)}
              >
                Đóng
              </button>
              <button
                type="button"
                className={btnCls}
                disabled={totalLabels === 0 || totalLabels > MAX_LABELS_PER_JOB}
                onClick={handlePrint}
              >
                In {totalLabels} tem
              </button>
            </div>
          </div>
        </div>
      )}

      {printLabels && (
        <div className="label-print-area hidden print:block" aria-hidden>
          {printLabels.map((l, i) => (
            <BarcodeLabel
              key={i}
              code={l.code}
              name={l.name}
              priceText={l.priceText}
              size={size}
            />
          ))}
        </div>
      )}
    </>
  );
}
