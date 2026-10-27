"use client";

import { useMemo, useState } from "react";
import { TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { mapHeaderColumns, normalizeHeader, readFirstSheetAOA, toNum, toStr } from "@/lib/excel-parse";
import type { AnyRow } from "@/lib/types";

/** Cột tiền: căn phải để dễ dò số. */
const thNumCls = `${thCls} text-right`;
const tdNumCls = `${tdCls} text-right`;

interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
}
interface CatalogCode {
  code: string;
  product_id: string;
}

export interface PartnerBatchCatalogRow {
  batch_id: string;
  batch_code: string;
  product_id: string;
  product_name: string;
  location_name: string;
  partner_id: string;
  qty: number;
}

export interface ReportOption {
  id: string;
  doc_code: string;
  partner_id: string;
  period_from: string | null;
  period_to: string | null;
}

interface RawRow {
  code: string;
  batchCode: string;
  natureRaw: string;
  qty: number;
  price: number;
}

interface PreviewRow extends RawRow {
  stt: number;
  nature: "PURCHASED" | "CONSIGNED";
  status: "ok" | "error";
  matchedProduct?: CatalogProduct;
  matchedBatch?: PartnerBatchCatalogRow;
  error?: string;
  duplicate?: boolean;
}

const FIELD_ALIASES: Record<string, string[]> = {
  code: ["mahang", "maso", "ma", "sku", "code", "mahanghoa"],
  batchCode: ["malo", "malohang", "lo", "batch", "batchcode"],
  nature: ["nguonhang", "nguon", "nature", "tinhchat"],
  qty: ["soluong", "sl", "qty", "quantity"],
  price: ["dongiavnd", "dongia", "giavnd", "giaban", "unitprice"],
};

function parseNature(raw: string): "PURCHASED" | "CONSIGNED" | null {
  const n = normalizeHeader(raw);
  if (!n) return "CONSIGNED";
  if (["kygui", "consignment", "consigned"].includes(n)) return "CONSIGNED";
  if (["muadut", "purchase", "purchased"].includes(n)) return "PURCHASED";
  return null;
}

export default function ImportAllocation({
  partners,
  products,
  codes,
  partnerBatches,
  reports,
  action,
}: {
  partners: AnyRow[];
  products: CatalogProduct[];
  codes: CatalogCode[];
  partnerBatches: PartnerBatchCatalogRow[];
  reports: ReportOption[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [partnerId, setPartnerId] = useState("");
  const [reportId, setReportId] = useState("");
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

  // Một lô có thể nằm ở kho của nhiều đối tác cùng lúc (gửi từng phần),
  // nên lookup theo mã lô trả về danh sách dòng, rồi chọn đúng dòng của
  // đối tác đang chọn trên form.
  const batchesByCode = useMemo(() => {
    const m = new Map<string, PartnerBatchCatalogRow[]>();
    for (const b of partnerBatches) {
      if (!b.batch_code) continue;
      const key = b.batch_code.trim().toUpperCase();
      const arr = m.get(key) ?? [];
      arr.push(b);
      m.set(key, arr);
    }
    return m;
  }, [partnerBatches]);

  const partnerName = new Map(partners.map((p) => [p.id, p.name]));

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setParseError("");
    setFormatProblems([]);
    try {
      const aoa = readFirstSheetAOA(await file.arrayBuffer());
      if (!aoa.length) throw new Error("File không có dữ liệu.");
      const { fieldCol, problems } = mapHeaderColumns(aoa[0], FIELD_ALIASES, [
        { field: "code", label: "MaHang" },
        { field: "batchCode", label: "MaLo" },
        { field: "qty", label: "SoLuong" },
      ]);
      const val = (cells: unknown[], field: string) => {
        const i = fieldCol[field];
        return i === undefined ? "" : cells[i] ?? "";
      };
      const rows: RawRow[] = [];
      for (const cells of aoa.slice(1) as unknown[][]) {
        if (cells.every((c) => toStr(c) === "")) continue;
        rows.push({
          code: toStr(val(cells, "code")),
          batchCode: toStr(val(cells, "batchCode")),
          natureRaw: toStr(val(cells, "nature")),
          qty: toNum(val(cells, "qty")),
          price: toNum(val(cells, "price")),
        });
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
    const running = new Map<string, number>();
    return rawRows.map((r, i) => {
      const codeKey = r.code.trim().toUpperCase();
      const batchKey = r.batchCode.trim().toUpperCase();
      const dupKey = `${codeKey}|${batchKey}`;
      const duplicate = !!codeKey && !!batchKey && seen.has(dupKey);
      if (codeKey && batchKey) seen.add(dupKey);
      const matchedProduct = codeKey ? catalog.get(codeKey) : undefined;
      const batchRows = batchKey ? batchesByCode.get(batchKey) : undefined;
      const matchedBatch = batchRows
        ? partnerId
          ? batchRows.find((b) => b.partner_id === partnerId)
          : batchRows[0]
        : undefined;
      const nature = parseNature(r.natureRaw);
      let error: string | undefined;
      if (!r.code) error = "Thiếu mã hàng";
      else if (!r.batchCode) error = "Thiếu mã lô";
      else if (!matchedProduct) error = "Mã hàng chưa có trong hệ thống";
      else if (!batchRows) error = "Mã lô không có tại kho đối tác";
      else if (partnerId && !matchedBatch)
        error = "Lô không có tại kho của đối tác đã chọn";
      else if (!matchedBatch) error = "Mã lô không có tại kho đối tác";
      else if (matchedBatch.product_id !== matchedProduct.id)
        error = "Lô không thuộc sản phẩm này";
      else if (!(r.qty > 0)) error = "Số lượng phải lớn hơn 0";
      else if (nature === null) error = "Nguồn hàng không hợp lệ (Mua đứt / Ký gửi)";
      else if (r.price < 0) error = "Đơn giá không được âm";
      else {
        const cum = (running.get(batchKey) ?? 0) + r.qty;
        running.set(batchKey, cum);
        if (cum > matchedBatch.qty)
          error = `Vượt tồn tại kho đối tác (còn ${formatNumber(matchedBatch.qty)})`;
      }
      return {
        ...r,
        stt: i + 1,
        nature: nature ?? "CONSIGNED",
        status: error ? "error" : "ok",
        matchedProduct,
        matchedBatch,
        error,
        duplicate,
      };
    });
  }, [rawRows, catalog, batchesByCode, partnerId]);

  const importable = preview.filter((r) => r.status !== "error");
  const errorCount = preview.length - importable.length;
  const totalQty = importable.reduce((a, r) => a + r.qty, 0);
  const totalAmount = importable.reduce((a, r) => a + r.qty * r.price, 0);
  const canSubmit = rawRows !== null && importable.length > 0 && errorCount === 0 && !!partnerId;

  const payload = {
    partnerId,
    reportId: reportId || null,
    confirmNow,
    rows: importable.map((r) => ({
      code: r.code,
      batchCode: r.batchCode,
      nature: r.nature,
      qty: r.qty,
      price: r.price,
    })),
  };

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <div className="rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/70 px-4 py-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-blue-950">File phân bổ (.xlsx / .csv)</label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className={`${inputCls} max-w-md flex-1 bg-white`}
          />
          <a
            href="/mau-import-phan-bo.xlsx"
            download
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-500"
          >
            Tải file mẫu (.xlsx)
          </a>
        </div>
        <p className="mt-2 text-xs text-blue-900/70">
          Tải file mẫu về, xoá các dòng ví dụ rồi điền phân bổ — một file là một
          phiếu phân bổ (PB) cho một đối tác. Đơn giá tính bằng VNĐ (để trống = 0).
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
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
          <label className={labelCls}>Hàng đã bán [Đối tác] (không bắt buộc)</label>
          <select value={reportId} onChange={(e) => setReportId(e.target.value)} className={inputCls}>
            <option value="">— Không —</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.doc_code} — {partnerName.get(r.partner_id) ?? ""} ({formatDate(r.period_from)} → {formatDate(r.period_to)})
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} />
        Xác nhận phân bổ ngay sau khi tạo phiếu (hệ thống kiểm tra 3 chốt: lượng đã báo, hạn mức theo tính chất, tồn tại kho đối tác)
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
            <p className="font-semibold">Định dạng chuẩn của file phân bổ:</p>
            <p className="mt-1 font-mono text-[11px]">MaHang* · MaLo* · NguonHang · SoLuong* · DonGiaVND</p>
            <p className="mt-1">
              Hàng 1 phải là hàng tiêu đề với đúng các tên cột trên (cột * là bắt
              buộc). MaLo là mã lô đang nằm tại kho của đối tác đã chọn, và phải
              thuộc đúng sản phẩm ở cột MaHang. NguonHang ghi “Mua đứt” hoặc “Ký
              gửi” (để trống = Ký gửi). DonGiaVND tính bằng VNĐ (để trống = 0).
              Một file chỉ phân bổ cho một đối tác. File .csv phải lưu ở mã hoá
              UTF-8. Dễ nhất: bấm “Tải file mẫu” ở trên, xoá dòng ví dụ rồi điền vào.
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
          {importable.length} dòng sẵn sàng phân bổ, {preview.length - importable.length} dòng lỗi.
        </p>
      )}

      {rawRows !== null && preview.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>STT</th>
              <th className={thCls}>Mã hàng</th>
              <th className={thCls}>Tên hàng</th>
              <th className={thCls}>Mã lô</th>
              <th className={thCls}>Tại kho</th>
              <th className={thCls}>Nguồn</th>
              <th className={thCls}>SL</th>
              <th className={thNumCls}>Đơn giá</th>
              <th className={thNumCls}>Thành tiền</th>
              <th className={thCls}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((r) => (
              <tr key={r.stt} className="border-t border-slate-100">
                <td className={tdCls}>{r.stt}</td>
                <td className={`${tdCls} font-mono text-xs`}>{r.code || "—"}</td>
                <td className={tdCls}>{r.matchedProduct?.name ?? "—"}</td>
                <td className={`${tdCls} font-mono text-xs`}>{r.batchCode || "—"}</td>
                <td className={tdCls}>{r.matchedBatch?.location_name ?? "—"}</td>
                <td className={tdCls}>{r.nature === "PURCHASED" ? "Mua đứt" : "Ký gửi"}</td>
                <td className={tdCls}>{formatNumber(r.qty)}</td>
                <td className={tdNumCls}>{r.price > 0 ? formatVND(r.price) : "—"}</td>
                <td className={tdNumCls}>{r.price > 0 ? formatVND(r.qty * r.price) : "—"}</td>
                <td className={tdCls}>
                  {r.status === "ok" ? (
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Sẵn sàng</span>
                  ) : (
                    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Lỗi</span>
                  )}
                  {r.duplicate && (
                    <span className="ml-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Trùng dòng trong file</span>
                  )}
                  {r.error && <span className="block text-xs text-red-600">{r.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-bold">
              <td className={tdCls} colSpan={6}>Tổng</td>
              <td className={tdCls}>{formatNumber(totalQty)}</td>
              <td className={tdCls}></td>
              <td className={tdNumCls}>{formatVND(totalAmount)}</td>
              <td className={tdCls}></td>
            </tr>
          </tfoot>
        </TableWrap>
      )}

      <button type="submit" disabled={!canSubmit} className={btnCls}>
        Tạo phiếu phân bổ
      </button>
      {!canSubmit && rawRows !== null && (
        <p className="text-xs text-slate-500">
          {errorCount > 0
            ? "Hãy sửa hết các dòng lỗi trong file Excel rồi tải lại."
            : "Cần chọn đối tác và có ít nhất một dòng hợp lệ để tạo phiếu."}
        </p>
      )}
    </form>
  );
}
