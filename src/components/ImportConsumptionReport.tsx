"use client";

import { useMemo, useState } from "react";
import { TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import { formatNumber, todayISO } from "@/lib/format";
import { mapHeaderColumns, readFirstSheetAOA, toNum, toStr } from "@/lib/excel-parse";
import type { AnyRow } from "@/lib/types";

interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
}
interface CatalogCode {
  code: string;
  product_id: string;
}

interface RawRow {
  code: string;
  qty: number;
}

interface PreviewRow extends RawRow {
  stt: number;
  status: "ok" | "error";
  matchedName?: string;
  error?: string;
  duplicate?: boolean;
}

const FIELD_ALIASES: Record<string, string[]> = {
  code: ["mahang", "maso", "ma", "sku", "code", "mahanghoa"],
  qty: ["soluongtieuthu", "soluong", "sl", "qty", "quantity"],
};

export default function ImportConsumptionReport({
  partners,
  products,
  codes,
  action,
}: {
  partners: AnyRow[];
  products: CatalogProduct[];
  codes: CatalogCode[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [partnerId, setPartnerId] = useState("");
  const [periodFrom, setPeriodFrom] = useState(todayISO());
  const [periodTo, setPeriodTo] = useState(todayISO());
  const [confirmNow, setConfirmNow] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<RawRow[] | null>(null);
  const [parseError, setParseError] = useState("");
  const [formatProblems, setFormatProblems] = useState<string[]>([]);

  const catalog = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    const lookup = new Map<string, CatalogProduct>();
    for (const p of products) {
      if (p.sku) lookup.set(p.sku.trim().toUpperCase(), p);
    }
    for (const c of codes) {
      const p = byId.get(c.product_id);
      if (p && c.code) lookup.set(c.code.trim().toUpperCase(), p);
    }
    return lookup;
  }, [products, codes]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setParseError("");
    setFormatProblems([]);
    try {
      const aoa = await readFirstSheetAOA(await file.arrayBuffer());
      if (!aoa.length) throw new Error("File không có dữ liệu.");
      const { fieldCol, problems } = mapHeaderColumns(aoa[0], FIELD_ALIASES, [
        { field: "code", label: "MaHang" },
        { field: "qty", label: "SoLuongTieuThu" },
      ]);
      const val = (cells: unknown[], field: string) => {
        const i = fieldCol[field];
        return i === undefined ? "" : cells[i] ?? "";
      };
      const rows: RawRow[] = [];
      for (const cells of aoa.slice(1) as unknown[][]) {
        if (cells.every((c) => toStr(c) === "")) continue;
        rows.push({ code: toStr(val(cells, "code")), qty: toNum(val(cells, "qty")) });
      }
      if (rows.length === 0)
        problems.push("File không có dòng hàng nào — chỉ có hàng tiêu đề hoặc toàn dòng trống.");
      if (problems.length) {
        setFormatProblems(problems);
        setRawRows(null);
        setFileName(file.name);
        return;
      }
      setRawRows(rows);
      setFileName(file.name);
    } catch (err) {
      setRawRows(null);
      setFileName("");
      setParseError(
        err instanceof Error ? err.message : "Không đọc được file. Hãy dùng file .xlsx hoặc .csv."
      );
    }
  }

  const preview: PreviewRow[] = useMemo(() => {
    if (!rawRows) return [];
    const seen = new Set<string>();
    return rawRows.map((r, i) => {
      const key = r.code.trim().toUpperCase();
      const duplicate = !!key && seen.has(key);
      if (key) seen.add(key);
      const matched = key ? catalog.get(key) : undefined;
      let error: string | undefined;
      if (!r.code) error = "Thiếu mã hàng";
      else if (!matched) error = "Mã hàng chưa có trong hệ thống";
      else if (!(r.qty > 0)) error = "Số lượng phải lớn hơn 0";
      return {
        ...r,
        stt: i + 1,
        status: error ? "error" : "ok",
        matchedName: matched?.name,
        error,
        duplicate,
      };
    });
  }, [rawRows, catalog]);

  const importable = preview.filter((r) => r.status !== "error");
  const errorCount = preview.length - importable.length;
  const totalQty = importable.reduce((a, r) => a + r.qty, 0);
  const canSubmit =
    rawRows !== null && importable.length > 0 && errorCount === 0 && !!partnerId && !!periodFrom && !!periodTo;

  const payload = {
    partnerId,
    periodFrom,
    periodTo,
    confirmNow,
    rows: importable.map((r) => ({ code: r.code, qty: r.qty })),
  };

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <div className="rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/70 px-4 py-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-blue-950">File báo cáo tiêu thụ (.xlsx / .csv)</label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className={`${inputCls} max-w-md flex-1 bg-white`}
          />
          <a
            href="/mau-import-bao-cao-tieu-thu.xlsx"
            download
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-500"
          >
            Tải file mẫu (.xlsx)
          </a>
        </div>
        <p className="mt-2 text-xs text-blue-900/70">
          Tải file mẫu về, xoá các dòng ví dụ rồi điền lượng đối tác đã tiêu thụ —
          một file là một báo cáo (BT) cho một đối tác trong một kỳ. Báo cáo chỉ
          ghi nhận số lượng, không có giá.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className={labelCls}>Đối tác *</label>
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className={inputCls}>
            <option value="">— Chọn —</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Từ ngày *</label>
          <input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Đến ngày *</label>
          <input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} className={inputCls} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} />
        Xác nhận báo cáo ngay sau khi tạo
      </label>

      {(formatProblems.length > 0 || parseError) && (
        <div className="space-y-3 rounded-md border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">File bị từ chối — chưa đúng định dạng chuẩn</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
            {(formatProblems.length > 0 ? formatProblems : [parseError]).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <div className="rounded-md bg-white/70 px-3 py-2 text-xs leading-relaxed text-slate-700">
            <p className="font-semibold">Định dạng chuẩn của file báo cáo tiêu thụ:</p>
            <p className="mt-1 font-mono text-[11px]">MaHang* · SoLuongTieuThu*</p>
            <p className="mt-1">
              Hàng 1 phải là hàng tiêu đề với đúng các tên cột trên (cột * là bắt
              buộc). MaHang là mã hàng đã có trong hệ thống (mã chính hoặc mã
              tương đương). Một file chỉ báo cho một đối tác trong một kỳ. File
              .csv phải lưu ở mã hoá UTF-8. Dễ nhất: bấm “Tải file mẫu” ở trên,
              xoá dòng ví dụ rồi điền vào.
            </p>
          </div>
        </div>
      )}
      {rawRows !== null && errorCount > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Có {errorCount} dòng lỗi dữ liệu (đánh dấu đỏ trong bảng bên dưới).
          Hệ thống không nhập một phần — hãy sửa các dòng lỗi ngay trong file
          Excel rồi tải lại.
        </p>
      )}
      {fileName && !parseError && (
        <p className="text-sm text-slate-600">
          Đã đọc file <span className="font-medium">{fileName}</span>: {preview.length} dòng,{" "}
          {importable.length} dòng sẵn sàng báo, {preview.length - importable.length} dòng lỗi.
        </p>
      )}

      {rawRows !== null && preview.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>STT</th>
              <th className={thCls}>Mã hàng</th>
              <th className={thCls}>Tên hàng</th>
              <th className={thCls}>SL tiêu thụ</th>
              <th className={thCls}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((r) => (
              <tr key={r.stt} className="border-t border-slate-100">
                <td className={tdCls}>{r.stt}</td>
                <td className={`${tdCls} font-mono text-xs`}>{r.code || "—"}</td>
                <td className={tdCls}>{r.matchedName ?? "—"}</td>
                <td className={tdCls}>{formatNumber(r.qty)}</td>
                <td className={tdCls}>
                  {r.status === "ok" ? (
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Sẵn sàng</span>
                  ) : (
                    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Lỗi</span>
                  )}
                  {r.duplicate && (
                    <span className="ml-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Trùng mã trong file</span>
                  )}
                  {r.error && <span className="block text-xs text-red-600">{r.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-bold">
              <td className={tdCls} colSpan={3}>Tổng</td>
              <td className={tdCls}>{formatNumber(totalQty)}</td>
              <td className={tdCls}></td>
            </tr>
          </tfoot>
        </TableWrap>
      )}

      <SubmitButton disabled={!canSubmit} className={btnCls}>
        Tạo báo cáo tiêu thụ
      </SubmitButton>
      {!canSubmit && rawRows !== null && (
        <p className="text-xs text-slate-500">
          {errorCount > 0
            ? "Hãy sửa hết các dòng lỗi trong file Excel rồi tải lại."
            : "Cần chọn đối tác, kỳ báo cáo và có ít nhất một dòng hợp lệ để tạo báo cáo."}
        </p>
      )}
    </form>
  );
}
