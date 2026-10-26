"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { formatNumber, formatUSD, formatVND, todayISO } from "@/lib/format";

/** Cột tiền: căn phải để dễ dò số. */
const thNumCls = `${thCls} text-right`;
const tdNumCls = `${tdCls} text-right`;
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
  altCodes: string[];
  name: string;
  nameEn: string;
  brand: string;
  fitment: string;
  unit: string;
  qty: number;
  usd: number;
  note: string;
}

interface PreviewRow extends RawRow {
  stt: number;
  /** Đơn giá nhập VNĐ: GiaUSD × Tỷ giá × (1 + VAT%) — tỷ giá, VAT trên form. */
  unitCost: number;
  /** Giá đại lý: Đơn giá nhập × (1 + % lợi nhuận trên form). */
  salePriceEff: number;
  /** Giá lẻ: Đơn giá nhập × (1 + % giá bán lẻ trên form). */
  retailPriceEff: number;
  status: "existing" | "new" | "error";
  matchedName?: string;
  error?: string;
  duplicate?: boolean;
}

/** Lowercase, strip Vietnamese diacritics, drop every non-alphanumeric char. */
function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

const FIELD_ALIASES: Record<keyof RawRow, string[]> = {
  code: ["mahang", "maso", "ma", "sku", "code", "mahanghoa"],
  altCodes: ["mathaythe", "mathay", "altcodes", "matuongduong"],
  name: ["tenhang", "tenphutung", "ten", "name"],
  nameEn: ["tentienganh", "nameen"],
  brand: ["thuonghieu", "brand"],
  fitment: ["dongxe", "dong", "fitment"],
  unit: ["donvitinh", "dvt", "unit"],
  qty: ["soluong", "sl", "qty", "quantity"],
  usd: ["giausd", "dongiausd", "usd", "priceusd"],
  note: ["ghichu", "note"],
};

function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").trim().replace(/\s/g, "");
  if (!s) return 0;
  // Vietnamese thousand separators: 2.916.000 or 2.916.000,5
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export default function ImportExcel({
  suppliers,
  warehouses,
  products,
  codes,
  action,
}: {
  suppliers: AnyRow[];
  warehouses: AnyRow[];
  products: CatalogProduct[];
  codes: CatalogCode[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [kind, setKind] = useState<"PN" | "NK">("PN");
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayISO());
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [tyGia, setTyGia] = useState(27000);
  const [vatPct, setVatPct] = useState(8);
  const [profitPct, setProfitPct] = useState(35);
  // % giá bán lẻ: cùng cách tính như giá đại lý (Đơn giá nhập × (1 + %)),
  // mặc định cao hơn % lợi nhuận đại lý — đổi được ngay trên form.
  const [retailPct, setRetailPct] = useState(50);
  const [autoCreate, setAutoCreate] = useState(true);
  const [confirmNow, setConfirmNow] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<RawRow[] | null>(null);
  const [parseError, setParseError] = useState("");
  const [formatProblems, setFormatProblems] = useState<string[]>([]);

  // Catalog lookup: any known code (SKU or registered code) → product.
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
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: "",
      });
      if (!aoa.length) throw new Error("File không có dữ liệu.");
      const fieldCol: Partial<Record<keyof RawRow, number>> = {};
      const headerNorms: string[] = [];
      (aoa[0] as unknown[]).forEach((h, idx) => {
        const n = normalizeHeader(h);
        headerNorms.push(n);
        (Object.keys(FIELD_ALIASES) as (keyof RawRow)[]).forEach((field) => {
          if (FIELD_ALIASES[field].includes(n) && fieldCol[field] === undefined) {
            fieldCol[field] = idx;
          }
        });
      });
      // Kiểm soát định dạng: thiếu cột bắt buộc, trùng tiêu đề, thiếu cột
      // giá → từ chối file và hướng dẫn lại chuẩn (không xem trước).
      const problems: string[] = [];
      const seenH = new Set<string>();
      const dupH = new Set<string>();
      for (const n of headerNorms) {
        if (!n) continue;
        if (seenH.has(n)) dupH.add(n);
        seenH.add(n);
      }
      if (dupH.size)
        problems.push(
          `Tiêu đề cột bị trùng lặp: ${Array.from(dupH).join(", ")}. Mỗi cột chỉ được xuất hiện một lần.`
        );
      const missing: string[] = [];
      if (fieldCol.code === undefined) missing.push("MaHang");
      if (fieldCol.name === undefined) missing.push("TenHang");
      if (fieldCol.qty === undefined) missing.push("SoLuong");
      if (missing.length)
        problems.push(`Thiếu cột bắt buộc: ${missing.join(", ")}.`);
      if (fieldCol.usd === undefined)
        problems.push("Thiếu cột giá: cần cột GiaUSD.");
      const val = (cells: unknown[], field: keyof RawRow) => {
        const i = fieldCol[field];
        return i === undefined ? "" : cells[i] ?? "";
      };

      const rows: RawRow[] = [];
      for (const cells of aoa.slice(1) as unknown[][]) {
        if (cells.every((c) => toStr(c) === "")) continue;
        rows.push({
          code: toStr(val(cells, "code")),
          altCodes: toStr(val(cells, "altCodes"))
            .split(/[;,\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
          name: toStr(val(cells, "name")),
          nameEn: toStr(val(cells, "nameEn")),
          brand: toStr(val(cells, "brand")),
          fitment: toStr(val(cells, "fitment")),
          unit: toStr(val(cells, "unit")),
          qty: toNum(val(cells, "qty")),
          usd: toNum(val(cells, "usd")),
          note: toStr(val(cells, "note")),
        });
      }
      if (rows.length === 0)
        problems.push(
          "File không có dòng hàng nào — chỉ có hàng tiêu đề hoặc toàn dòng trống."
        );
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
      // Công thức áp chung cho toàn bộ file (tỷ giá, VAT, % lợi nhuận và
      // % giá bán lẻ nhập trên form): Đơn giá nhập VNĐ = GiaUSD × Tỷ giá
      // × (1 + VAT%); Giá đại lý = Đơn giá nhập × (1 + % lợi nhuận);
      // Giá lẻ = Đơn giá nhập × (1 + % giá bán lẻ).
      const unitCost =
        r.usd > 0 ? Math.round(r.usd * tyGia * (1 + vatPct / 100)) : 0;
      const salePriceEff =
        unitCost > 0 ? Math.round(unitCost * (1 + profitPct / 100)) : 0;
      const retailPriceEff =
        unitCost > 0 ? Math.round(unitCost * (1 + retailPct / 100)) : 0;
      const matched =
        catalog.get(r.code.trim().toUpperCase()) ??
        r.altCodes
          .map((a) => catalog.get(a.trim().toUpperCase()))
          .find((p) => p !== undefined);
      const duplicate = r.code ? seen.has(r.code.trim().toUpperCase()) : false;
      if (r.code) seen.add(r.code.trim().toUpperCase());

      let status: PreviewRow["status"] = "new";
      let error: string | undefined;
      if (!r.code) error = "Thiếu mã hàng";
      else if (!(r.qty > 0)) error = "Số lượng phải lớn hơn 0";
      else if (unitCost <= 0) error = "Chưa có giá USD (cần cột GiaUSD)";
      else if (!matched && !r.name) error = "Thiếu tên hàng cho sản phẩm mới";
      else if (!matched && !autoCreate)
        error = "Mã chưa có trong hệ thống (đã tắt tự tạo sản phẩm)";
      if (error) status = "error";
      else if (matched) status = "existing";
      return {
        ...r,
        stt: i + 1,
        unitCost,
        salePriceEff,
        retailPriceEff,
        status,
        matchedName: matched?.name,
        error,
        duplicate,
      };
    });
  }, [rawRows, catalog, tyGia, vatPct, profitPct, retailPct, autoCreate]);

  const importable = preview.filter((r) => r.status !== "error");
  const errorCount = preview.length - importable.length;
  const totalQty = importable.reduce((a, r) => a + r.qty, 0);
  // Tổng khớp kế toán: làm tròn một lần ở cuối từ giá trị chính xác của
  // từng dòng. Chênh lệch với tổng các dòng (đơn giá đã làm tròn) vẫn được
  // tính và lưu cùng phiếu ở máy chủ (migration 0010), nhưng không hiện
  // riêng ở cuối bảng — bảng chỉ hiện Total cuối cùng. Cách tính phải khớp
  // từng phép tính với máy chủ (cùng thứ tự dòng, cùng biểu thức).
  const exactTotal = Math.round(
    importable.reduce(
      (a, r) => a + Math.trunc(r.qty) * r.usd * tyGia * (1 + vatPct / 100),
      0
    )
  );
  // Kiểm soát chặt: còn bất kỳ dòng lỗi nào là không cho nhập (không nhập một phần).
  const canSubmit =
    rawRows !== null &&
    importable.length > 0 &&
    errorCount === 0 &&
    !!supplierId &&
    !!warehouseId;

  const payload = {
    kind,
    supplierId,
    warehouseId,
    receiptDate,
    supplierInvoiceNo,
    tyGia,
    vatPct,
    profitPct,
    retailPct,
    autoCreate,
    confirmNow,
    rows: importable.map((r) => ({
      code: r.code,
      altCodes: r.altCodes,
      name: r.name,
      nameEn: r.nameEn,
      brand: r.brand,
      fitment: r.fitment,
      unit: r.unit,
      qty: r.qty,
      usd: r.usd,
      note: r.note,
    })),
  };

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <div className="rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/70 px-4 py-4">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
            />
          </svg>
          <label className="text-sm font-semibold text-blue-950">
            File danh mục (.xlsx / .csv)
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className={`${inputCls} max-w-md flex-1 bg-white`}
          />
          <a
            href="/mau-import-nhap-hang.xlsx"
            download
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-500"
          >
            Tải file mẫu (.xlsx)
          </a>
        </div>
        <p className="mt-2 text-xs text-blue-900/70">
          Chưa có file đúng chuẩn? Tải file mẫu về, điền hàng hoá theo mẫu rồi
          chọn file tải lên — hệ thống sẽ kiểm tra định dạng và cho xem trước
          ở bên dưới trước khi nhập.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label className={labelCls}>Loại phiếu *</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "PN" | "NK")}
            className={inputCls}
          >
            <option value="PN">Nhập mua (PN)</option>
            <option value="NK">Nhập ký gửi (NK)</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Nhà cung cấp *</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={inputCls}
          >
            <option value="">— Chọn —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Kho nhập *</label>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className={inputCls}
          >
            <option value="">— Chọn —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Ngày nhập</label>
          <input
            type="date"
            value={receiptDate}
            onChange={(e) => setReceiptDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Số hoá đơn của nhà cung cấp (chỉ PN)</label>
          <input
            value={supplierInvoiceNo}
            onChange={(e) => setSupplierInvoiceNo(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Tỷ giá (VNĐ/USD)</label>
          <input
            type="number"
            value={tyGia}
            onChange={(e) => setTyGia(Number(e.target.value) || 0)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>VAT % (cộng vào giá USD)</label>
          <input
            type="number"
            value={vatPct}
            onChange={(e) => setVatPct(Number(e.target.value) || 0)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>% lợi nhuận / sản phẩm</label>
          <input
            type="number"
            value={profitPct}
            onChange={(e) => setProfitPct(Number(e.target.value) || 0)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>% giá bán lẻ</label>
          <input
            type="number"
            value={retailPct}
            onChange={(e) => setRetailPct(Number(e.target.value) || 0)}
            className={inputCls}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={autoCreate}
            onChange={(e) => setAutoCreate(e.target.checked)}
          />
          Tự tạo sản phẩm mới nếu mã chưa có
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={confirmNow}
            onChange={(e) => setConfirmNow(e.target.checked)}
          />
          Xác nhận nhập kho ngay sau khi tạo phiếu
        </label>
      </div>

      {(formatProblems.length > 0 || parseError) && (
        <div className="space-y-3 rounded-md border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">
            File bị từ chối — chưa đúng định dạng chuẩn
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
            {(formatProblems.length > 0 ? formatProblems : [parseError]).map(
              (p, i) => (
                <li key={i}>{p}</li>
              )
            )}
          </ul>
          <div className="rounded-md bg-white/70 px-3 py-2 text-xs leading-relaxed text-slate-700">
            <p className="font-semibold">Định dạng chuẩn của file nhập hàng:</p>
            <p className="mt-1 font-mono text-[11px]">
              DongXe · TenHang* · TenTiengAnh · MaHang* · ThuongHieu · DonViTinh ·
              SoLuong* · GiaUSD*
            </p>
            <p className="mt-1">
              Hàng 1 phải là hàng tiêu đề với đúng các tên cột trên (cột * là bắt
              buộc). File chỉ cần 8 cột này — Tỷ giá, VAT và % lợi nhuận nhập
              trên form, áp dụng chung cho toàn bộ file. Đặt tên cột bằng tên
              tiếng Việt tương ứng (Dòng xe, Tên phụ tùng, Tên tiếng anh, Mã
              số, Thương hiệu, ĐVT, Số lượng, Đơn giá USD) cũng được nhận.
              Hệ thống tự tính:
              Đơn giá nhập VNĐ = GiaUSD × Tỷ giá × (1 + VAT%); Thành tiền =
              Số lượng × Đơn giá nhập; Giá bán = Đơn giá nhập × (1 + %
              lợi nhuận). Mỗi dòng là một mặt hàng, không gộp ô (merge),
              không thêm hàng tiêu đề phụ. Một file chỉ nhập cho một nhà cung
              cấp. File .csv phải lưu ở mã hoá UTF-8. Dễ nhất: bấm “Tải file
              mẫu” ở trên, điền vào file mẫu rồi tải lên.
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
          {importable.length} dòng sẵn sàng nhập, {preview.length - importable.length} dòng lỗi.
        </p>
      )}

      {rawRows !== null && preview.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>STT</th>
              <th className={thCls}>Mã hàng</th>
              <th className={thCls}>Tên hàng</th>
              <th className={thCls}>ĐVT</th>
              <th className={thCls}>SL</th>
              <th className={thNumCls}>Đơn giá USD</th>
              <th className={thNumCls}>Đơn giá VND + VAT</th>
              <th className={thNumCls}>Thành tiền</th>
              <th className={thNumCls}>Giá đại lý</th>
              <th className={thNumCls}>Giá lẻ</th>
              <th className={thCls}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((r) => (
              <tr key={r.stt} className="border-t border-slate-100">
                <td className={tdCls}>{r.stt}</td>
                <td className={`${tdCls} font-mono text-xs`}>{r.code || "—"}</td>
                <td className={tdCls}>
                  {r.status === "existing" ? r.matchedName : r.name || "—"}
                  {r.status === "existing" && r.name && r.name !== r.matchedName && (
                    <span className="block text-xs text-slate-400">{r.name}</span>
                  )}
                </td>
                <td className={tdCls}>{r.unit || "—"}</td>
                <td className={tdCls}>{formatNumber(r.qty)}</td>
                <td className={tdNumCls}>{r.usd > 0 ? formatUSD(r.usd) : "—"}</td>
                <td className={tdNumCls}>{r.unitCost > 0 ? formatVND(r.unitCost) : "—"}</td>
                <td className={tdNumCls}>
                  {r.unitCost > 0 ? formatVND(r.qty * r.unitCost) : "—"}
                </td>
                <td className={tdNumCls}>
                  {r.salePriceEff > 0 ? formatVND(r.salePriceEff) : "—"}
                </td>
                <td className={tdNumCls}>
                  {r.retailPriceEff > 0 ? formatVND(r.retailPriceEff) : "—"}
                </td>
                <td className={tdCls}>
                  {r.status === "existing" && (
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      Đã có
                    </span>
                  )}
                  {r.status === "new" && (
                    <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      Hàng mới
                    </span>
                  )}
                  {r.status === "error" && (
                    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      Lỗi
                    </span>
                  )}
                  {r.duplicate && (
                    <span className="ml-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Trùng mã trong file
                    </span>
                  )}
                  {r.error && <span className="block text-xs text-red-600">{r.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-bold">
              <td className={tdCls} colSpan={4}>
                Total giá nhập VND
              </td>
              <td className={tdCls}>{formatNumber(totalQty)}</td>
              <td className={tdCls}></td>
              <td className={tdCls}></td>
              <td className={tdNumCls}>{formatVND(exactTotal)}</td>
              <td className={tdCls}></td>
              <td className={tdCls}></td>
              <td className={tdCls}></td>
            </tr>
          </tfoot>
        </TableWrap>
      )}

      <button type="submit" disabled={!canSubmit} className={btnCls}>
        Xác nhận nhập
      </button>
      {!canSubmit && rawRows !== null && (
        <p className="text-xs text-slate-500">
          {errorCount > 0
            ? "Hãy sửa hết các dòng lỗi trong file Excel rồi tải lại."
            : "Cần chọn nhà cung cấp, kho nhập và có ít nhất một dòng hợp lệ để nhập."}
        </p>
      )}
    </form>
  );
}
