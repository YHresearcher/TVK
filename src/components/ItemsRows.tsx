"use client";

import { useRef, useState } from "react";
import { inputCls, labelCls } from "@/components/ui";

export interface ItemField {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  step?: string;
  placeholder?: string;
}

interface ScanRow {
  rowId: number;
  /** Value for the select field filled by the scan (product_id or batch_id). */
  selectValue: string;
  qty: number;
  /** Price to prefill on the scanned row (when the pick carries one). */
  price?: number;
}

/** Scan-to-line resolution for forms whose lines pick something by code. */
export interface ScanPick {
  /** Name of the select field the scan fills, e.g. "batch_id". */
  selectField: string;
  /** Normalized code → picked select value (FIFO batch for counter sales). */
  picks: Record<string, string>;
  /** Normalized code → price to prefill on the picked line. */
  prices?: Record<string, number>;
  /** Name of the price input, e.g. "unit_price". */
  priceField?: string;
  /** Normalized code → max qty that re-scans may accumulate (batch stock). */
  maxQty?: Record<string, number>;
  /** Normalized codes that exist but have no pick (e.g. out of stock). */
  known?: Record<string, boolean>;
}

/**
 * Dynamic line-item rows for document forms. Every field name is repeated per
 * row, so the server action reads them with formData.getAll(name) in row order.
 *
 * When `codeMap` is given (normalized product code → product_id) and the fields
 * contain a product_id select, a barcode scan box appears above the rows:
 * USB/Bluetooth scanners act as keyboards, so scanning types the code and
 * presses Enter — we catch that, add (or increment) a row for the product,
 * and keep the parent form from being submitted.
 *
 * `scanPick` is the same box for forms whose lines pick something else by
 * code: the scan resolves straight to the select value (e.g. the FIFO batch
 * for counter sales) and prefills the price. Re-scanning the same code
 * increments the row quantity, capped at the picked batch's stock.
 */
export default function ItemsRows({
  fields,
  initialRows = 3,
  addLabel = "+ Thêm dòng",
  codeMap,
  priceFill,
  scanPick,
}: {
  fields: ItemField[];
  initialRows?: number;
  addLabel?: string;
  codeMap?: Record<string, string>;
  /** Scan that resolves a code straight to a line value (FIFO batch). */
  scanPick?: ScanPick;
  /**
   * Tự điền giá: khi ô select `selectName` đổi giá trị, điền giá tương ứng
   * vào ô `priceField` cùng dòng (chỉ điền khi giá > 0; người dùng vẫn sửa
   * tay được sau đó). Dùng cho form bán hàng: chọn lô → đơn giá theo loại
   * giá đang chọn (lẻ / đại lý).
   */
  priceFill?: {
    selectName: string;
    priceField: string;
    prices: Record<string, number>;
  };
}) {
  const [rows, setRows] = useState<number[]>(() =>
    Array.from({ length: initialRows }, (_, i) => i)
  );
  const [nextId, setNextId] = useState(initialRows);
  const [scanRows, setScanRows] = useState<ScanRow[]>([]);
  const [scanText, setScanText] = useState("");
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const scanSelectField = scanPick?.selectField ?? "product_id";
  const scanEnabled =
    (!!codeMap || !!scanPick) &&
    fields.some((f) => f.name === scanSelectField && f.type === "select");
  const qtyFieldName =
    fields.find((f) => f.name === "qty")?.name ??
    fields.find((f) => f.name.startsWith("qty"))?.name;
  const normalizedMap: Record<string, string> = {};
  if (codeMap) {
    for (const [k, v] of Object.entries(codeMap)) {
      normalizedMap[k.trim().toUpperCase()] = v;
    }
  }

  function handleScanKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault(); // never submit the parent form from the scan box
    const code = scanText.trim().toUpperCase();
    setScanText("");
    scanRef.current?.focus();
    if (!code) return;
    // Resolve the scan: a product (codeMap) or a picked line value
    // (scanPick: FIFO batch + retail price for counter sales).
    const selectValue = scanPick ? scanPick.picks[code] : normalizedMap[code];
    if (!selectValue) {
      setScanMsg(
        scanPick?.known?.[code]
          ? { ok: false, text: `Mã này hiện hết hàng tại kho: ${code}` }
          : { ok: false, text: `Không tìm thấy mã: ${code}` }
      );
      return;
    }
    const price = scanPick?.prices?.[code];
    const max = scanPick?.maxQty?.[code];
    const existing = scanRows.find((r) => r.selectValue === selectValue);
    if (existing) {
      const nextQty =
        max !== undefined ? Math.min(existing.qty + 1, max) : existing.qty + 1;
      setScanMsg(
        nextQty === existing.qty
          ? { ok: true, text: `Lô này chỉ còn ${max} — đã giữ đủ số lượng.` }
          : { ok: true, text: `Đã thêm: ${code}` }
      );
      // Remount with a fresh rowId so the uncontrolled inputs re-read
      // their defaultValue with the incremented quantity.
      setScanRows((prev) =>
        prev.map((r) =>
          r.selectValue === selectValue
            ? { rowId: nextId, selectValue, qty: nextQty, price }
            : r
        )
      );
    } else {
      setScanMsg({ ok: true, text: `Đã thêm: ${code}` });
      setScanRows((prev) => [
        ...prev,
        { rowId: nextId, selectValue, qty: 1, price },
      ]);
    }
    setNextId((n) => n + 1);
  }

  function renderRow(
    rowId: number,
    onRemove: () => void,
    defaults?: { selectValue: string; qty: number; price?: number }
  ) {
    // Default for an uncontrolled input on a scan-added row: quantity, or
    // the picked price (only when a real price > 0 was resolved).
    const inputDefault = (f: ItemField): string | number | undefined => {
      if (!defaults) return undefined;
      if (f.name === qtyFieldName) return defaults.qty;
      if (
        scanPick?.priceField &&
        f.name === scanPick.priceField &&
        defaults.price !== undefined &&
        defaults.price > 0
      )
        return defaults.price;
      return undefined;
    };
    return (
      <div
        key={rowId}
        className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-12"
      >
        {fields.map((f) => (
          <div key={f.name} className="md:col-span-3">
            <label className={labelCls}>{f.label}</label>
            {f.type === "select" ? (
              <select
                name={f.name}
                className={inputCls}
                defaultValue={
                  defaults && f.name === scanSelectField
                    ? defaults.selectValue
                    : ""
                }
                onChange={
                  priceFill && f.name === priceFill.selectName
                    ? (e) => {
                        const row = e.currentTarget.closest("div.grid");
                        const input = row?.querySelector<HTMLInputElement>(
                          `input[name="${priceFill.priceField}"]`
                        );
                        const price = priceFill.prices[e.currentTarget.value];
                        if (input && price !== undefined && price > 0)
                          input.value = String(price);
                      }
                    : undefined
                }
              >
                <option value="">— Chọn —</option>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={f.name}
                type={f.type}
                step={f.step}
                placeholder={f.placeholder}
                className={inputCls}
                defaultValue={inputDefault(f)}
              />
            )}
          </div>
        ))}
        <div className="flex items-end md:col-span-3">
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-red-500 hover:underline"
          >
            Xoá dòng
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {scanEnabled && (
        <div className="rounded-md border border-dashed border-blue-300 bg-blue-50/60 p-3">
          <label className={labelCls}>Quét mã vạch / nhập mã hàng</label>
          <input
            ref={scanRef}
            value={scanText}
            onChange={(e) => setScanText(e.target.value)}
            onKeyDown={handleScanKey}
            placeholder="Quét barcode hoặc gõ mã hàng rồi nhấn Enter"
            autoComplete="off"
            className={inputCls}
          />
          {scanMsg ? (
            <p
              className={`mt-1 text-xs font-medium ${
                scanMsg.ok ? "text-green-600" : "text-red-600"
              }`}
            >
              {scanMsg.text}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              Máy quét sẽ tự nhập mã và thêm dòng; quét lại cùng một mã để cộng
              thêm số lượng.
            </p>
          )}
        </div>
      )}
      {rows.map((rowId) =>
        renderRow(rowId, () => setRows(rows.filter((r) => r !== rowId)))
      )}
      {scanRows.map((r) =>
        renderRow(
          r.rowId,
          () => setScanRows(scanRows.filter((s) => s.rowId !== r.rowId)),
          { selectValue: r.selectValue, qty: r.qty, price: r.price }
        )
      )}
      <button
        type="button"
        onClick={() => {
          setRows([...rows, nextId]);
          setNextId(nextId + 1);
        }}
        className="text-sm font-medium text-blue-600 hover:underline"
      >
        {addLabel}
      </button>
    </div>
  );
}
