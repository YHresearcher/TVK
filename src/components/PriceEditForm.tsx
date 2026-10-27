"use client";

import { useState } from "react";
import { btnCls, inputCls, labelCls } from "@/components/ui";

/**
 * Price-edit form for the product detail "Bảng giá" card. The suggestion
 * button only fills the Giá lẻ input (Giá đại lý × 1,50/1,35, i.e. the
 * 50% retail / 35% dealer margin pair on the same cost) — nothing is saved
 * until the user presses "Lưu giá".
 */
export default function PriceEditForm({
  action,
  retailPrice,
  garagePrice,
  wholesalePrice,
}: {
  action: (formData: FormData) => void | Promise<void>;
  retailPrice: number;
  garagePrice: number;
  wholesalePrice: number;
}) {
  const [retail, setRetail] = useState(retailPrice);
  const [garage, setGarage] = useState(garagePrice);
  const [wholesale, setWholesale] = useState(wholesalePrice);
  const suggestRetail = () => {
    if (wholesale > 0) setRetail(Math.round((wholesale * 1.5) / 1.35));
  };
  return (
    <form action={action} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
      <div className="grid grid-cols-3 gap-2">
        <div><label className={labelCls}>Giá lẻ</label><input name="retail_price" type="number" step="1000" min="0" value={retail} onChange={(e) => setRetail(Number(e.target.value))} className={inputCls} /></div>
        <div><label className={labelCls}>Cho gara</label><input name="garage_price" type="number" step="1000" min="0" value={garage} onChange={(e) => setGarage(Number(e.target.value))} className={inputCls} /></div>
        <div><label className={labelCls}>Giá đại lý</label><input name="wholesale_price" type="number" step="1000" min="0" value={wholesale} onChange={(e) => setWholesale(Number(e.target.value))} className={inputCls} /></div>
      </div>
      <button type="button" onClick={suggestRetail} disabled={wholesale <= 0} className="text-sm text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">
        Gợi ý: Giá lẻ = Giá đại lý × 1,50/1,35
      </button>
      <button type="submit" className={`${btnCls} w-full`}>Lưu giá</button>
    </form>
  );
}
