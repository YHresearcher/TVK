"use client";

import { useState } from "react";
import { inputCls, labelCls } from "@/components/ui";

export interface ItemField {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  step?: string;
  placeholder?: string;
}

/**
 * Dynamic line-item rows for document forms. Every field name is repeated per
 * row, so the server action reads them with formData.getAll(name) in row order.
 */
export default function ItemsRows({
  fields,
  initialRows = 3,
  addLabel = "+ Add row",
}: {
  fields: ItemField[];
  initialRows?: number;
  addLabel?: string;
}) {
  const [rows, setRows] = useState<number[]>(() =>
    Array.from({ length: initialRows }, (_, i) => i)
  );
  const [nextId, setNextId] = useState(initialRows);

  return (
    <div className="space-y-3">
      {rows.map((rowId, idx) => (
        <div
          key={rowId}
          className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-12"
        >
          {fields.map((f) => (
            <div key={f.name} className="md:col-span-3">
              <label className={labelCls}>
                {f.label}
                {idx === 0 ? "" : ""}
              </label>
              {f.type === "select" ? (
                <select name={f.name} className={inputCls} defaultValue="">
                  <option value="">— Select —</option>
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
                />
              )}
            </div>
          ))}
          <div className="flex items-end md:col-span-3">
            <button
              type="button"
              onClick={() => setRows(rows.filter((r) => r !== rowId))}
              className="text-xs text-red-500 hover:underline"
            >
              Remove row
            </button>
          </div>
        </div>
      ))}
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
