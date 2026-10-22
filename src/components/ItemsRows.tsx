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
  productId: string;
  qty: number;
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
 */
export default function ItemsRows({
  fields,
  initialRows = 3,
  addLabel = "+ Thêm dòng",
  codeMap,
}: {
  fields: ItemField[];
  initialRows?: number;
  addLabel?: string;
  codeMap?: Record<string, string>;
}) {
  const [rows, setRows] = useState<number[]>(() =>
    Array.from({ length: initialRows }, (_, i) => i)
  );
  const [nextId, setNextId] = useState(initialRows);
  const [scanRows, setScanRows] = useState<ScanRow[]>([]);
  const [scanText, setScanText] = useState("");
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const scanEnabled =
    !!codeMap && fields.some((f) => f.name === "product_id" && f.type === "select");
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
    const productId = normalizedMap[code];
    if (!productId) {
      setScanMsg({ ok: false, text: `Không tìm thấy mã: ${code}` });
      return;
    }
    setScanMsg({ ok: true, text: `Đã thêm: ${code}` });
    setScanRows((prev) => {
      const existing = prev.find((r) => r.productId === productId);
      if (existing) {
        // Remount with a fresh rowId so the uncontrolled inputs re-read
        // their defaultValue with the incremented quantity.
        return prev.map((r) =>
          r.productId === productId
            ? { rowId: nextId, productId, qty: r.qty + 1 }
            : r
        );
      }
      return [...prev, { rowId: nextId, productId, qty: 1 }];
    });
    setNextId((n) => n + 1);
  }

  function renderRow(
    rowId: number,
    onRemove: () => void,
    defaults?: { productId: string; qty: number }
  ) {
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
                  defaults && f.name === "product_id" ? defaults.productId : ""
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
                defaultValue={
                  defaults && f.name === qtyFieldName ? defaults.qty : undefined
                }
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
          { productId: r.productId, qty: r.qty }
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
