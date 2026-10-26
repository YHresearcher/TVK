"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ItemsRows from "@/components/ItemsRows";
import { inputCls, labelCls } from "@/components/ui";

/**
 * Khối dòng hàng của form bán hàng tại quầy, kèm chọn loại giá.
 *
 * - "Bán đại lý" (mặc định): chọn lô → đơn giá tự điền bằng giá đại lý
 *   (wholesale_price) của sản phẩm trong lô.
 * - "Bán lẻ": chọn lô → đơn giá tự điền bằng giá lẻ (retail_price).
 * - Các lựa chọn khác ngoài bán lẻ đều lấy giá đại lý.
 *
 * Đơn giá tự điền vẫn sửa tay được; đổi loại giá sau khi đã chọn lô cũng
 * cập nhật lại đơn giá các dòng đã có lô (chỉ khi giá > 0 — sản phẩm chưa
 * đặt giá thì để trống cho người bán tự nhập).
 */
export default function SalePriceSection({
  batchOptions,
  batchPrices,
}: {
  batchOptions: { value: string; label: string }[];
  batchPrices: Record<string, { retail: number; wholesale: number }>;
}) {
  const [basis, setBasis] = useState<"wholesale" | "retail">("wholesale");
  const rootRef = useRef<HTMLDivElement>(null);

  const prices = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [batchId, p] of Object.entries(batchPrices)) {
      out[batchId] = basis === "retail" ? p.retail : p.wholesale;
    }
    return out;
  }, [basis, batchPrices]);

  // Đổi loại giá: cập nhật lại đơn giá các dòng đã chọn lô.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root
      .querySelectorAll<HTMLSelectElement>('select[name="batch_id"]')
      .forEach((sel) => {
        if (!sel.value) return;
        const price = prices[sel.value];
        const row = sel.closest("div.grid");
        const input = row?.querySelector<HTMLInputElement>(
          'input[name="unit_price"]'
        );
        if (input && price !== undefined && price > 0)
          input.value = String(price);
      });
  }, [basis, prices]);

  return (
    <div ref={rootRef} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label className={labelCls}>Loại giá</label>
          <select
            value={basis}
            onChange={(e) =>
              setBasis(e.target.value === "retail" ? "retail" : "wholesale")
            }
            className={inputCls}
          >
            <option value="wholesale">Bán đại lý</option>
            <option value="retail">Bán lẻ</option>
          </select>
        </div>
      </div>
      <ItemsRows
        fields={[
          { name: "batch_id", label: "Lô", type: "select", options: batchOptions },
          { name: "qty", label: "Số lượng", type: "number" },
          { name: "unit_price", label: "Đơn giá (₫)", type: "number", step: "1000" },
        ]}
        initialRows={2}
        priceFill={{
          selectName: "batch_id",
          priceField: "unit_price",
          prices,
        }}
      />
    </div>
  );
}
