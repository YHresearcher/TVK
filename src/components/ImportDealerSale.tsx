"use client";

import { useMemo, useState } from "react";
import { TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { formatNumber, formatVND } from "@/lib/format";
import { mapHeaderColumns, readFirstSheetAOA, toNum, toStr } from "@/lib/excel-parse";

/** Cột tiền: căn phải để dễ dò số. */
const thNumCls = `${thCls} text-right`;
const tdNumCls = `${tdCls} text-right`;

export interface DealerBatchCatalogRow {
  batch_id: string;
  batch_code: string;
  product_name: string;
  ownership: string;
  /** Tồn tại tất cả kho của mình — phiếu bán trừ ở vị trí giữ nhiều nhất. */
  own_qty: number;
  /** Giá đại lý của sản phẩm trong lô — giá mặc định khi ô DonGiaVND để trống. */
  wholesale_price: number;
}

interface RawRow {
  batchCode: string;
  qty: number;
  /** null = ô giá để trống → lấy giá đại lý của sản phẩm trong lô. */
  price: number | null;
}

interface PreviewRow extends RawRow {
  stt: number;
  status: "ok" | "error";
  matched?: DealerBatchCatalogRow;
  resolvedPrice: number;
  priceFromCatalog: boolean;
  error?: string;
  duplicate?: boolean;
}

const FIELD_ALIASES: Record<string, string[]> = {
  batchCode: ["malo", "malohang", "lo", "batch", "batchcode"],
  qty: ["soluong", "sl", "qty", "quantity"],
  price: ["dongiavnd", "dongia", "giaban", "giavnd", "giabandai", "unitprice"],
};

export default function ImportDealerSale({
  partners,
  catalog,
  action,
}: {
  partners: { value: string; label: string }[];
  catalog: DealerBatchCatalogRow[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [partnerId, setPartnerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [isCredit, setIsCredit] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<RawRow[] | null>(null);
  const [parseError, setParseError] = useState("");
  const [formatProblems, setFormatProblems] = useState<string[]>([]);

  const batchByCode = useMemo(() => {
    const m = new Map<string, DealerBatchCatalogRow>();
    for (const b of catalog) {
      if (b.batch_code) m.set(b.batch_code.trim().toUpperCase(), b);
    }
    return m;
  }, [catalog]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setParseError("");
    setFormatProblems([]);
    try {
      const aoa = readFirstSheetAOA(await file.arrayBuffer());
      if (!aoa.length) throw new Error("File không có dữ liệu.");
      const { fieldCol, problems } = mapHeaderColumns(aoa[0], FIELD_ALIASES, [
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
        const priceCell = val(cells, "price");
        rows.push({
          batchCode: toStr(val(cells, "batchCode")),
          qty: toNum(val(cells, "qty")),
          price: toStr(priceCell) === "" ? null : toNum(priceCell),
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
      const key = r.batchCode.trim().toUpperCase();
      const duplicate = !!key && seen.has(key);
      if (key) seen.add(key);
      const matched = key ? batchByCode.get(key) : undefined;
      const resolvedPrice = r.price ?? matched?.wholesale_price ?? 0;
      const priceFromCatalog = r.price === null;
      let error: string | undefined;
      if (!r.batchCode) error = "Thiếu mã lô";
      else if (!matched) error = "Mã lô không có tại kho của mình";
      else if (!(r.qty > 0)) error = "Số lượng phải lớn hơn 0";
      else if (r.price !== null && r.price < 0) error = "Đơn giá không được âm";
      else if (matched) {
        const cum = (running.get(key) ?? 0) + r.qty;
        running.set(key, cum);
        if (cum > matched.own_qty)
          error = `Vượt tồn tại kho mình (còn ${formatNumber(matched.own_qty)})`;
      }
      return {
        ...r,
        stt: i + 1,
        status: error ? "error" : "ok",
        matched,
        resolvedPrice,
        priceFromCatalog,
        error,
        duplicate,
      };
    });
  }, [rawRows, batchByCode]);

  const importable = preview.filter((r) => r.status !== "error");
  const errorCount = preview.length - importable.length;
  const totalQty = importable.reduce((a, r) => a + r.qty, 0);
  const totalAmount = importable.reduce((a, r) => a + r.qty * r.resolvedPrice, 0);
  const canSubmit = rawRows !== null && importable.length > 0 && errorCount === 0;

  const payload = {
    partnerId,
    customerName,
    discountAmount,
    isCredit,
    rows: importable.map((r) => ({
      batchCode: r.batchCode,
      qty: r.qty,
      price: r.price,
    })),
  };

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <div className="rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/70 px-4 py-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-blue-950">File bán đại lý (.xlsx / .csv)</label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className={`${inputCls} max-w-md flex-1 bg-white`}
          />
          <a
            href="/mau-import-ban-dai-ly.xlsx"
            download
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-500"
          >
            Tải file mẫu (.xlsx)
          </a>
        </div>
        <p className="mt-2 text-xs text-blue-900/70">
          Tải file mẫu về, xoá các dòng ví dụ rồi điền lô cần bán — một file là
          một đơn bán đại lý. Đơn giá để trống thì lấy giá đại lý của sản phẩm
          trong lô. Hệ thống kiểm tra định dạng và cho xem trước ở bên dưới
          trước khi tạo đơn.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label className={labelCls}>Đối tác (không bắt buộc)</label>
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className={inputCls}>
            <option value="">— Khách lẻ —</option>
            {partners.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Tên khách hàng</label>
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Giảm giá cho phần BH (₫)</label>
          <input
            type="number"
            step="1000"
            value={discountAmount}
            onChange={(e) => setDiscountAmount(Number(e.target.value) || 0)}
            className={inputCls}
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isCredit} onChange={(e) => setIsCredit(e.target.checked)} className="h-4 w-4" />
            Bán chịu (tạo phải thu)
          </label>
        </div>
      </div>

      {(formatProblems.length > 0 || parseError) && (
        <div className="space-y-3 rounded-md border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">File bị từ chối — chưa đúng định dạng chuẩn</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
            {(formatProblems.length > 0 ? formatProblems : [parseError]).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <div className="rounded-md bg-white/70 px-3 py-2 text-xs leading-relaxed text-slate-700">
            <p className="font-semibold">Định dạng chuẩn của file bán đại lý:</p>
            <p className="mt-1 font-mono text-[11px]">MaLo* · SoLuong* · DonGiaVND</p>
            <p className="mt-1">
              Hàng 1 phải là hàng tiêu đề với đúng các tên cột trên (cột * là bắt
              buộc). MaLo là mã lô đang nằm tại kho của mình (vd. OWN-2610-0001).
              DonGiaVND tính bằng VNĐ — để trống thì lấy giá đại lý của sản phẩm
              trong lô, ghi số thì bán đúng giá đó. Lô của mình đi vào chứng từ
              BH, lô ký gửi đi vào chứng từ KG. File .csv phải lưu ở mã hoá
              UTF-8. Dễ nhất: bấm “Tải file mẫu” ở trên, xoá dòng ví dụ rồi
              điền vào.
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
          {importable.length} dòng sẵn sàng bán, {preview.length - importable.length} dòng lỗi.
        </p>
      )}

      {rawRows !== null && preview.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>STT</th>
              <th className={thCls}>Mã lô</th>
              <th className={thCls}>Sản phẩm</th>
              <th className={thCls}>Tính chất</th>
              <th className={thCls}>Tồn tại kho mình</th>
              <th className={thCls}>SL bán</th>
              <th className={thNumCls}>Đơn giá</th>
              <th className={thNumCls}>Thành tiền</th>
              <th className={thCls}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((r) => (
              <tr key={r.stt} className="border-t border-slate-100">
                <td className={tdCls}>{r.stt}</td>
                <td className={`${tdCls} font-mono text-xs`}>{r.batchCode || "—"}</td>
                <td className={tdCls}>{r.matched?.product_name ?? "—"}</td>
                <td className={tdCls}>{r.matched?.ownership ?? "—"}</td>
                <td className={tdCls}>{r.matched ? formatNumber(r.matched.own_qty) : "—"}</td>
                <td className={tdCls}>{formatNumber(r.qty)}</td>
                <td className={tdNumCls}>
                  {formatVND(r.resolvedPrice)}
                  {r.priceFromCatalog && r.matched && (
                    <span className="block text-[11px] font-normal text-slate-400">giá đại lý</span>
                  )}
                </td>
                <td className={tdNumCls}>{formatVND(r.qty * r.resolvedPrice)}</td>
                <td className={tdCls}>
                  {r.status === "ok" ? (
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Sẵn sàng</span>
                  ) : (
                    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Lỗi</span>
                  )}
                  {r.duplicate && (
                    <span className="ml-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Trùng lô trong file</span>
                  )}
                  {r.error && <span className="block text-xs text-red-600">{r.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-bold">
              <td className={tdCls} colSpan={5}>Tổng</td>
              <td className={tdCls}>{formatNumber(totalQty)}</td>
              <td className={tdCls}></td>
              <td className={tdNumCls}>{formatVND(totalAmount)}</td>
              <td className={tdCls}></td>
            </tr>
          </tfoot>
        </TableWrap>
      )}

      <button type="submit" disabled={!canSubmit} className={btnCls}>
        Tạo đơn bán đại lý
      </button>
      {!canSubmit && rawRows !== null && (
        <p className="text-xs text-slate-500">
          {errorCount > 0
            ? "Hãy sửa hết các dòng lỗi trong file Excel rồi tải lại."
            : "Cần ít nhất một dòng hợp lệ để tạo đơn."}
        </p>
      )}
    </form>
  );
}
