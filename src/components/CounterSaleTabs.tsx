"use client";

import { useMemo, useState } from "react";
import ItemsRows from "@/components/ItemsRows";
import { Card, btnCls, inputCls, labelCls } from "@/components/ui";

type Basis = "retail" | "wholesale";

const TABS: {
  basis: Basis;
  label: string;
  title: string;
  hint: string;
  priceLabel: string;
  submitLabel: string;
}[] = [
  {
    basis: "retail",
    label: "Bán lẻ",
    title: "Bán lẻ",
    hint: "Đơn giá tự điền theo giá lẻ của sản phẩm trong lô. Khách lẻ thì để trống đối tác.",
    priceLabel: "Giá lẻ (₫)",
    submitLabel: "Hoàn tất bán lẻ",
  },
  {
    basis: "wholesale",
    label: "Bán đại lý",
    title: "Bán đại lý",
    hint: "Đơn giá tự điền theo giá đại lý của sản phẩm trong lô. Bán cho đối tác/gara thì chọn đối tác.",
    priceLabel: "Giá đại lý (₫)",
    submitLabel: "Hoàn tất bán đại lý",
  },
];

/**
 * Hai tab bán hàng tại quầy, mỗi tab một form riêng với loại giá cố định.
 *
 * Trước đây một form chung dùng ô "Loại giá" để đổi qua lại giữa giá lẻ và
 * giá đại lý — hai cách trình bày gom chung nên dễ nhầm. Nay tab nào dùng
 * giá đó: chọn lô → đơn giá tự điền theo giá của tab (vẫn sửa tay được),
 * và cả hai form đều giữ trong DOM (tab không active chỉ ẩn đi) nên
 * chuyển tab không mất các dòng đã nhập.
 */
export default function CounterSaleTabs({
  batchOptions,
  batchPrices,
  partnerOptions,
  action,
}: {
  batchOptions: { value: string; label: string }[];
  batchPrices: Record<string, { retail: number; wholesale: number }>;
  partnerOptions: { value: string; label: string }[];
  action: (formData: FormData) => Promise<void>;
}) {
  // Mặc định mở tab Bán đại lý như ô Loại giá trước đây.
  const [active, setActive] = useState<Basis>("wholesale");

  const pricesByBasis = useMemo(() => {
    const out: Record<Basis, Record<string, number>> = {
      retail: {},
      wholesale: {},
    };
    for (const [batchId, p] of Object.entries(batchPrices)) {
      out.retail[batchId] = p.retail;
      out.wholesale[batchId] = p.wholesale;
    }
    return out;
  }, [batchPrices]);

  return (
    <div className="space-y-4">
      <div
        className="inline-flex rounded-xl bg-slate-100 p-1"
        role="tablist"
        aria-label="Hình thức bán"
      >
        {TABS.map((t) => (
          <button
            key={t.basis}
            type="button"
            role="tab"
            aria-selected={active === t.basis}
            onClick={() => setActive(t.basis)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              active === t.basis
                ? "bg-slate-900 text-white shadow"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {TABS.map((t) => (
        <div key={t.basis} className={active === t.basis ? "" : "hidden"}>
          <Card title={t.title}>
            <p className="mb-4 text-sm text-slate-500">{t.hint}</p>
            <form action={action} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <label className={labelCls}>Đối tác (không bắt buộc)</label>
                  <select name="partner_id" className={inputCls}>
                    <option value="">— Khách lẻ —</option>
                    {partnerOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Tên khách hàng</label>
                  <input name="customer_name" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Giảm giá cho phần BH (₫)</label>
                  <input
                    name="discount_amount"
                    type="number"
                    step="1000"
                    defaultValue="0"
                    className={inputCls}
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="is_credit"
                      className="h-4 w-4"
                    />{" "}
                    Bán chịu (tạo phải thu)
                  </label>
                </div>
              </div>
              <ItemsRows
                fields={[
                  {
                    name: "batch_id",
                    label: "Lô",
                    type: "select",
                    options: batchOptions,
                  },
                  { name: "qty", label: "Số lượng", type: "number" },
                  {
                    name: "unit_price",
                    label: t.priceLabel,
                    type: "number",
                    step: "1000",
                  },
                ]}
                initialRows={2}
                priceFill={{
                  selectName: "batch_id",
                  priceField: "unit_price",
                  prices: pricesByBasis[t.basis],
                }}
              />
              <button type="submit" className={btnCls}>
                {t.submitLabel}
              </button>
            </form>
          </Card>
        </div>
      ))}
    </div>
  );
}
