"use client";

import { useMemo, useState } from "react";
import { TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { formatNumber, formatVND, todayISO } from "@/lib/format";
import { mapHeaderColumns, readFirstSheetAOA, toNum, toStr } from "@/lib/excel-parse";

/** Cột tiền: căn phải để dễ dò số. */
const thNumCls = `${thCls} text-right`;
const tdNumCls = `${tdCls} text-right`;

/** Sản phẩm phân giải được từ một mã hàng (SKU hoặc mã đã đăng ký). */
export interface DealerProductRow {
  productId: string;
  productName: string;
  /** Giá đại lý — giá mặc định khi ô DonGiaVND để trống. */
  wholesalePrice: number;
}

/** Một lô trong hàng đợi FIFO của một sản phẩm (cũ nhất trước). */
export interface DealerFifoBatchRow {
  batch_id: string;
  batch_code: string;
  ownership: string;
  /** Tồn tại vị trí kho mình giữ nhiều nhất — đúng vị trí phiếu sẽ trừ. */
  mainOwnQty: number;
}

interface RawRow {
  code: string;
  qty: number;
  /** null = ô giá để trống → lấy giá đại lý của sản phẩm. */
  price: number | null;
}

interface AllocLine {
  batchCode: string;
  ownership: string;
  batchStock: number;
  qty: number;
  unitPrice: number;
  priceFromCatalog: boolean;
}

interface PreviewRow {
  stt: number;
  status: "ok" | "error";
  code: string;
  productName?: string;
  error?: string;
  duplicate?: boolean;
  allocs: AllocLine[];
}

const FIELD_ALIASES: Record<string, string[]> = {
  code: ["mahang", "mahanghoa", "maso", "sku", "code", "productcode", "maphutung"],
  qty: ["soluong", "sl", "qty", "quantity"],
  price: ["dongiavnd", "dongia", "giaban", "giavnd", "giabandai", "unitprice"],
};

const normCode = (v: string) => v.trim().toUpperCase();

export default function ImportDealerSale({
  partners,
  codeMap,
  fifoBatches,
  action,
}: {
  partners: { value: string; label: string }[];
  /** Mã hàng đã chuẩn hoá (trim + hoa) → sản phẩm. */
  codeMap: Record<string, DealerProductRow>;
  /** productId → các lô FIFO còn hàng tại kho của mình. */
  fifoBatches: Record<string, DealerFifoBatchRow[]>;
  action: (formData: FormData) => Promise<void>;
}) {
  const [saleDate, setSaleDate] = useState(todayISO());
  const [partnerId, setPartnerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [isCredit, setIsCredit] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<RawRow[] | null>(null);
  const [parseError, setParseError] = useState("");
  const [formatProblems, setFormatProblems] = useState<string[]>([]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setParseError("");
    setFormatProblems([]);
    try {
      const aoa = readFirstSheetAOA(await file.arrayBuffer());
      if (!aoa.length) throw new Error("File không có dữ liệu.");
      const { fieldCol, problems } = mapHeaderColumns(aoa[0], FIELD_ALIASES, [
        { field: "code", label: "MaHang" },
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
          code: toStr(val(cells, "code")),
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

  // Phân bổ FIFO xem trước: đi theo thứ tự dòng trong file, mỗi dòng lấy
  // từ lô cũ nhất còn hàng; tồn còn lại của lô được trừ dần qua các dòng.
  const preview: PreviewRow[] = useMemo(() => {
    if (!rawRows) return [];
    const seen = new Set<string>();
    const remaining = new Map<string, number>();
    for (const list of Object.values(fifoBatches)) {
      for (const b of list) remaining.set(b.batch_id, b.mainOwnQty);
    }
    return rawRows.map((r, i) => {
      const key = normCode(r.code);
      const duplicate = !!key && seen.has(key);
      if (key) seen.add(key);
      const product = key ? codeMap[key] : undefined;
      const unitPrice = r.price ?? product?.wholesalePrice ?? 0;
      const priceFromCatalog = r.price === null;
      const allocs: AllocLine[] = [];
      let error: string | undefined;
      if (!r.code) error = "Thiếu mã hàng";
      else if (!product) error = "Mã hàng chưa có trong hệ thống";
      else if (!(r.qty > 0)) error = "Số lượng phải lớn hơn 0";
      else if (r.price !== null && r.price < 0) error = "Đơn giá không được âm";
      else {
        let need = r.qty;
        const available = (fifoBatches[product.productId] ?? []).reduce(
          (a, b) => a + (remaining.get(b.batch_id) ?? 0),
          0
        );
        for (const b of fifoBatches[product.productId] ?? []) {
          if (need <= 0) break;
          const avail = remaining.get(b.batch_id) ?? 0;
          const take = Math.min(need, avail);
          if (take > 0) {
            allocs.push({
              batchCode: b.batch_code,
              ownership: b.ownership,
              batchStock: b.mainOwnQty,
              qty: take,
              unitPrice,
              priceFromCatalog,
            });
            remaining.set(b.batch_id, avail - take);
            need -= take;
          }
        }
        if (need > 0)
          error = `Không đủ hàng theo FIFO (còn ${formatNumber(available)}; thiếu ${formatNumber(need)})`;
      }
      return {
        stt: i + 1,
        status: error ? "error" : "ok",
        code: r.code,
        productName: product?.productName,
        error,
        duplicate,
        allocs,
      };
    });
  }, [rawRows, codeMap, fifoBatches]);

  const okRows = preview.filter((r) => r.status !== "error");
  const errorCount = preview.length - okRows.length;
  const totalQty = okRows.reduce((a, r) => a + r.allocs.reduce((x, l) => x + l.qty, 0), 0);
  const totalAmount = okRows.reduce(
    (a, r) => a + r.allocs.reduce((x, l) => x + l.qty * l.unitPrice, 0),
    0
  );
  const canSubmit =
    rawRows !== null && okRows.length > 0 && errorCount === 0 && !!saleDate;

  // Payload giữ đúng thứ tự dòng gốc (chỉ dòng hợp lệ — server kiểm tra
  // lại toàn bộ và tự phân bổ FIFO, không tin bản xem trước ở client).
  const payloadRows = preview
    .map((pr, idx) => ({ pr, raw: rawRows![idx] }))
    .filter(({ pr }) => pr.status !== "error")
    .map(({ raw }) => ({ code: raw.code, qty: raw.qty, price: raw.price }));
  const payload = {
    partnerId,
    customerName,
    discountAmount,
    isCredit,
    saleDate,
    rows: payloadRows,
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
          Tải file mẫu về, xoá các dòng ví dụ rồi điền mã hàng cần bán — một
          file là một đơn bán đại lý. Không cần nhớ mã lô: hệ thống tự lấy
          hàng theo lô cũ nhất còn tại kho của mình (FIFO). Đơn giá để trống
          thì lấy giá đại lý của sản phẩm. Hệ thống kiểm tra định dạng và cho
          xem trước ở bên dưới trước khi tạo đơn.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label className={labelCls}>Ngày bán *</label>
          <input
            type="date"
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
            className={inputCls}
          />
        </div>
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
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={isCredit} onChange={(e) => setIsCredit(e.target.checked)} className="h-4 w-4" />
        Bán chịu (tạo phải thu)
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
            <p className="font-semibold">Định dạng chuẩn của file bán đại lý:</p>
            <p className="mt-1 font-mono text-[11px]">MaHang* · SoLuong* · DonGiaVND</p>
            <p className="mt-1">
              Hàng 1 phải là hàng tiêu đề với đúng các tên cột trên (cột * là bắt
              buộc). MaHang là mã hàng hoặc SKU đã đăng ký (vd.
              AZ1664440069-SMS-30705) — không nhập mã lô, hệ thống tự phân bổ
              theo lô cũ nhất còn hàng tại kho của mình (FIFO), một dòng có
              thể tách ra nhiều lô. DonGiaVND tính bằng VNĐ — để trống thì lấy
              giá đại lý của sản phẩm, ghi số thì bán đúng giá đó. Ngày bán
              chọn ở form trên, áp dụng cho cả đơn. File .csv phải lưu ở mã
              hoá UTF-8. Dễ nhất: bấm “Tải file mẫu” ở trên, xoá dòng ví dụ
              rồi điền vào.
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
          {okRows.length} dòng sẵn sàng bán, {preview.length - okRows.length} dòng lỗi.
        </p>
      )}

      {rawRows !== null && preview.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>STT</th>
              <th className={thCls}>Mã hàng</th>
              <th className={thCls}>Sản phẩm</th>
              <th className={thCls}>Lô (FIFO)</th>
              <th className={thCls}>Tính chất</th>
              <th className={thCls}>Tồn tại kho mình</th>
              <th className={thCls}>SL bán</th>
              <th className={thNumCls}>Đơn giá</th>
              <th className={thNumCls}>Thành tiền</th>
              <th className={thCls}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((r) => {
              const lines = r.allocs.length > 0 ? r.allocs : [null];
              return lines.map((l, j) => (
                <tr key={`${r.stt}-${j}`} className="border-t border-slate-100">
                  <td className={tdCls}>{j === 0 ? r.stt : ""}</td>
                  <td className={`${tdCls} font-mono text-xs`}>{j === 0 ? r.code || "—" : ""}</td>
                  <td className={tdCls}>{j === 0 ? r.productName ?? "—" : ""}</td>
                  <td className={`${tdCls} font-mono text-xs`}>{l?.batchCode ?? "—"}</td>
                  <td className={tdCls}>{l?.ownership ?? "—"}</td>
                  <td className={tdCls}>{l ? formatNumber(l.batchStock) : "—"}</td>
                  <td className={tdCls}>{l ? formatNumber(l.qty) : "—"}</td>
                  <td className={tdNumCls}>
                    {l ? (
                      <>
                        {formatVND(l.unitPrice)}
                        {l.priceFromCatalog && (
                          <span className="block text-[11px] font-normal text-slate-400">giá đại lý</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={tdNumCls}>{l ? formatVND(l.qty * l.unitPrice) : "—"}</td>
                  <td className={tdCls}>
                    {j === 0 && (
                      <>
                        {r.status === "ok" ? (
                          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Sẵn sàng</span>
                        ) : (
                          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Lỗi</span>
                        )}
                        {r.duplicate && (
                          <span className="ml-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Trùng mã trong file</span>
                        )}
                        {r.error && <span className="block text-xs text-red-600">{r.error}</span>}
                      </>
                    )}
                  </td>
                </tr>
              ));
            })}
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
        Tạo đơn bán đại lý
      </button>
      {!canSubmit && rawRows !== null && (
        <p className="text-xs text-slate-500">
          {errorCount > 0
            ? "Hãy sửa hết các dòng lỗi trong file Excel rồi tải lại."
            : "Cần chọn ngày bán và có ít nhất một dòng hợp lệ để tạo đơn."}
        </p>
      )}
    </form>
  );
}
