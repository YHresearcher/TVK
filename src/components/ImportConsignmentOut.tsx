"use client";

import { useMemo, useState } from "react";
import { TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import { formatNumber, formatVND, todayISO } from "@/lib/format";
import { mapHeaderColumns, normalizeHeader, readFirstSheetAOA, toNum, toStr } from "@/lib/excel-parse";
import { matchByNameVehicle, normCode } from "@/lib/product-match";
import { type AnyRow } from "@/lib/types";
import type { PosProduct } from "@/components/PosSaleForm";
import type { DealerFifoBatchRow } from "@/components/ImportDealerSale";

/** Cột tiền: căn phải để dễ dò số. */
const thNumCls = `${thCls} text-right`;
const tdNumCls = `${tdCls} text-right`;

interface RawRow {
  vehicle: string;
  name: string;
  /** Mã hàng (SKU hoặc mã đã đăng ký) — chìa khoá khớp hàng khi tên trùng. */
  code: string;
  qty: number;
  /** null = ô giá để trống → giá chuyển giao 0 (như trước). */
  price: number | null;
}

interface AllocLine {
  batchCode: string;
  ownership: string;
  batchStock: number;
  qty: number;
  price: number;
}

interface PreviewRow {
  stt: number;
  status: "ok" | "error";
  vehicle: string;
  name: string;
  code: string;
  productName?: string;
  error?: string;
  allocs: AllocLine[];
}

const FIELD_ALIASES: Record<string, string[]> = {
  vehicle: ["dongxe", "dong", "maxe", "fitment"],
  name: ["tenphutung", "tenhang", "ten", "name"],
  code: ["mahang", "mahanghoa", "masanpham", "masp", "maso", "sku", "code", "productcode", "maphutung"],
  qty: ["soluong", "sl", "qty", "quantity"],
  price: ["giachuyengiaovnd", "giachuyengiao", "giathoathuan", "giavnd", "dongia", "transferprice"],
};

export default function ImportConsignmentOut({
  partners,
  products,
  codeMap,
  fifoBatches,
  action,
}: {
  /** Đối tác nhận hàng ký gửi. */
  partners: AnyRow[];
  /** Toàn bộ sản phẩm kèm dòng xe, để khớp tên + dòng xe. */
  products: PosProduct[];
  /** Mã hàng đã chuẩn hoá (hoa + bỏ khoảng trắng) → sản phẩm. */
  codeMap: Record<string, { productId: string; productName: string }>;
  /** productId → các lô FIFO còn hàng tại Kho TVK, đã loại lô ký gửi
   * của nhà cung cấp chưa cho ký gửi tiếp. */
  fifoBatches: Record<string, DealerFifoBatchRow[]>;
  action: (formData: FormData) => Promise<void>;
}) {
  const [partnerId, setPartnerId] = useState("");
  const [slipDate, setSlipDate] = useState(todayISO());
  const [settlementDueDate, setSettlementDueDate] = useState("");
  const [returnByDate, setReturnByDate] = useState("");
  const [confirmNow, setConfirmNow] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<RawRow[] | null>(null);
  const [parseError, setParseError] = useState("");
  const [formatProblems, setFormatProblems] = useState<string[]>([]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setParseError("");
    setFormatProblems([]);
    try {
      const aoa = await readFirstSheetAOA(await file.arrayBuffer());
      if (!aoa.length) throw new Error("File không có dữ liệu.");
      const { fieldCol, problems } = mapHeaderColumns(aoa[0], FIELD_ALIASES, [
        { field: "qty", label: "Số lượng" },
      ]);
      // Cột Mã hàng không bắt buộc: chỉ cần có cột Mã hàng HOẶC cột Tên
      // phụ tùng — tên đã tách biệt nên khớp theo tên + dòng xe, mã chỉ
      // cần khi tên trùng nhau để phân biệt (giống form bán hàng).
      if (fieldCol.code === undefined && fieldCol.name === undefined)
        problems.push("File phải có cột Mã hàng hoặc cột Tên phụ tùng để biết gửi món nào.");
      const val = (cells: unknown[], field: string) => {
        const i = fieldCol[field];
        return i === undefined ? "" : cells[i] ?? "";
      };
      const rows: RawRow[] = [];
      for (const cells of aoa.slice(1) as unknown[][]) {
        if (cells.every((c) => toStr(c) === "")) continue;
        const priceCell = val(cells, "price");
        rows.push({
          vehicle: toStr(val(cells, "vehicle")),
          name: toStr(val(cells, "name")),
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
  // Server kiểm tra lại toàn bộ (lô, khoá ô D, tồn, hạn mức) trước khi
  // tạo phiếu — bản xem trước chỉ để coi, không tin tuyệt đối.
  const preview: PreviewRow[] = useMemo(() => {
    if (!rawRows) return [];
    const remaining = new Map<string, number>();
    for (const list of Object.values(fifoBatches)) {
      for (const b of list) remaining.set(b.batch_id, b.mainOwnQty);
    }
    return rawRows.map((r, i) => {
      const allocs: AllocLine[] = [];
      let error: string | undefined;
      let productId: string | undefined;
      let productName: string | undefined;
      const codeKey = normCode(r.code);
      if (!codeKey && !r.name) {
        error = "Thiếu tên hàng và mã hàng";
      } else if (codeKey) {
        const byCode = codeMap[codeKey];
        if (!byCode) error = "Mã hàng chưa có trong hệ thống";
        else {
          productId = byCode.productId;
          productName = byCode.productName;
        }
      } else {
        const matched = matchByNameVehicle(products, r.name, r.vehicle);
        if ("error" in matched) {
          const where = r.vehicle ? ` (dòng xe ${r.vehicle})` : "";
          error =
            matched.error === "ambiguous"
              ? `Tên “${r.name}”${where} trùng nhiều món — ghi thêm cột Mã hàng để phân biệt`
              : `Không tìm thấy “${r.name}”${where} trong hệ thống`;
        } else {
          productId = matched.productId;
          productName = productById.get(productId)?.name;
        }
      }
      const price = r.price ?? 0;
      if (!error) {
        if (!(r.qty > 0)) error = "Số lượng phải lớn hơn 0";
        else if (r.price !== null && r.price < 0) error = "Giá chuyển giao không được âm";
        else if (productId) {
          let need = r.qty;
          const available = (fifoBatches[productId] ?? []).reduce(
            (a, b) => a + (remaining.get(b.batch_id) ?? 0),
            0
          );
          for (const b of fifoBatches[productId] ?? []) {
            if (need <= 0) break;
            const avail = remaining.get(b.batch_id) ?? 0;
            const take = Math.min(need, avail);
            if (take > 0) {
              allocs.push({
                batchCode: b.batch_code,
                ownership: b.ownership,
                batchStock: b.mainOwnQty,
                qty: take,
                price,
              });
              remaining.set(b.batch_id, avail - take);
              need -= take;
            }
          }
          if (need > 0)
            error = `Không đủ hàng theo FIFO (còn ${formatNumber(available)}; thiếu ${formatNumber(need)})`;
        }
      }
      return {
        stt: i + 1,
        status: error ? "error" : "ok",
        vehicle: r.vehicle,
        name: r.name,
        code: r.code,
        productName,
        error,
        allocs,
      };
    });
  }, [rawRows, codeMap, fifoBatches, products, productById]);

  const okRows = preview.filter((r) => r.status !== "error");
  const errorCount = preview.length - okRows.length;
  const totalQty = okRows.reduce((a, r) => a + r.allocs.reduce((x, l) => x + l.qty, 0), 0);
  const totalAmount = okRows.reduce(
    (a, r) => a + r.allocs.reduce((x, l) => x + l.qty * l.price, 0),
    0
  );
  const canSubmit = rawRows !== null && okRows.length > 0 && errorCount === 0 && !!partnerId;

  // Cảnh báo trùng tên: cùng tên nhưng khác mã là món khác nhau — hệ
  // thống khớp theo mã nên vẫn gửi đúng; chỉ nhắc coi kỹ mã. Không
  // chặn tạo phiếu (chỉ cảnh báo). Cùng kiểu cảnh báo như ở import
  // nhập kho và import bán hàng.
  const duplicateNames = useMemo(() => {
    const byName = new Map<string, { name: string; codes: Set<string> }>();
    for (const r of preview) {
      if (!r.name || !r.code) continue;
      const key = normalizeHeader(r.name);
      if (!key) continue;
      const entry = byName.get(key) ?? { name: r.name, codes: new Set<string>() };
      entry.codes.add(normCode(r.code));
      byName.set(key, entry);
    }
    return Array.from(byName.values()).filter((e) => e.codes.size > 1);
  }, [preview]);

  // Payload: một dòng cho mỗi lô được phân bổ (kèm mã lô để server
  // kiểm tra lại lô, khoá ô D, tồn và hạn mức như trước).
  const payload = {
    partnerId,
    slipDate,
    settlementDueDate,
    returnByDate,
    confirmNow,
    rows: okRows.flatMap((r) =>
      r.allocs.map((l) => ({
        batchCode: l.batchCode,
        qty: l.qty,
        // Phiếu GK chỉ còn một bản chất: ký gửi. "Mua đứt" đi qua
        // mục bán sỉ. Server vốn đã mặc định mọi dòng không phải
        // PURCHASE thành CONSIGNMENT.
        term: "CONSIGNMENT",
        price: l.price,
      }))
    ),
  };

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <div className="rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/70 px-4 py-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-blue-950">File gửi ký gửi (.xlsx / .csv)</label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className={`${inputCls} max-w-md flex-1 bg-white`}
          />
          <a
            href="/mau-import-gui-ky-gui.xlsx"
            download
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-500"
          >
            Tải file mẫu (.xlsx)
          </a>
        </div>
        <p className="mt-2 text-xs text-blue-900/70">
          Tải file mẫu về, xoá các dòng ví dụ rồi điền hàng cần gửi — một
          file là một phiếu gửi cho một đối tác. Hệ thống tìm hàng theo{" "}
          <b>tên phụ tùng + dòng xe</b> (tên đã tách biệt); cột Mã hàng chỉ
          cần khi tên trùng nhau để phân biệt. Không cần nhớ mã lô: hệ
          thống tự lấy theo lô cũ nhất còn tại Kho TVK (FIFO), trừ lô ký
          gửi của nhà cung cấp chưa cho ký gửi tiếp. Hệ thống kiểm tra
          định dạng và cho xem trước ở bên dưới trước khi tạo phiếu.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
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
          <label className={labelCls}>Ngày phiếu</label>
          <input type="date" value={slipDate} onChange={(e) => setSlipDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Hạn đối soát</label>
          <input type="date" value={settlementDueDate} onChange={(e) => setSettlementDueDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Hạn trả</label>
          <input type="date" value={returnByDate} onChange={(e) => setReturnByDate(e.target.value)} className={inputCls} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} />
        Xác nhận ngay → chuyển hàng tới đối tác sau khi tạo phiếu
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
            <p className="font-semibold">Định dạng chuẩn của file gửi ký gửi:</p>
            <p className="mt-1 font-mono text-[11px]">STT · Mã hàng · Dòng xe · Tên phụ tùng* · Số lượng* · Giá chuyển giao VND</p>
            <p className="mt-1">
              Hàng 1 phải là hàng tiêu đề với đúng các tên cột trên (cột * là
              bắt buộc; cột Mã hàng tùy chọn). STT chỉ để đếm. Hệ thống tìm
              hàng theo tên phụ tùng + dòng xe; mã hàng (mã SKU hoặc mã đã
              đăng ký trong danh mục) chỉ cần ghi khi tên trùng nhau để
              phân biệt — khi đó mã mới là chìa khoá quyết định. Dòng nào
              thiếu cả tên lẫn mã thì bị từ chối. Giá chuyển giao tính bằng
              VNĐ (để trống = 0) — giá này dùng để kiểm tra hạn mức ký gửi
              của đối tác khi xác nhận. Hệ thống tự lấy theo lô cũ nhất còn
              tại Kho TVK (FIFO), một dòng có thể tách ra nhiều lô; lô ký
              gửi của nhà cung cấp chưa cho ký gửi tiếp thì không được lấy.
              Một file chỉ gửi cho một đối tác. File .csv phải lưu ở mã hoá
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
          {okRows.length} dòng sẵn sàng gửi, {preview.length - okRows.length} dòng lỗi.
        </p>
      )}
      {duplicateNames.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Trong file có tên hàng xuất hiện nhiều lần với mã khác nhau:{" "}
          {duplicateNames.map((d) => `“${d.name}” (${d.codes.size} mã)`).join(", ")}.
          Hệ thống vẫn gửi đúng từng món theo mã — coi kỹ cột Mã hàng
          trước khi tạo phiếu.
        </p>
      )}

      {rawRows !== null && preview.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>STT</th>
              <th className={thCls}>Mã hàng</th>
              <th className={thCls}>Dòng xe</th>
              <th className={thCls}>Tên phụ tùng</th>
              <th className={thCls}>Sản phẩm</th>
              <th className={thCls}>Lô (FIFO)</th>
              <th className={thCls}>Tính chất</th>
              <th className={thCls}>Tồn tại Kho TVK</th>
              <th className={thCls}>SL gửi</th>
              <th className={thNumCls}>Giá chuyển giao</th>
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
                  <td className={tdCls}>{j === 0 ? r.vehicle || "—" : ""}</td>
                  <td className={tdCls}>{j === 0 ? r.name || "—" : ""}</td>
                  <td className={tdCls}>{j === 0 ? r.productName ?? "—" : ""}</td>
                  <td className={`${tdCls} font-mono text-xs`}>{l?.batchCode ?? "—"}</td>
                  <td className={tdCls}>{l?.ownership ?? "—"}</td>
                  <td className={tdCls}>{l ? formatNumber(l.batchStock) : "—"}</td>
                  <td className={tdCls}>{l ? formatNumber(l.qty) : "—"}</td>
                  <td className={tdNumCls}>{l && l.price > 0 ? formatVND(l.price) : "—"}</td>
                  <td className={tdNumCls}>{l && l.price > 0 ? formatVND(l.qty * l.price) : "—"}</td>
                  <td className={tdCls}>
                    {j === 0 && (
                      <>
                        {r.status === "ok" ? (
                          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Sẵn sàng</span>
                        ) : (
                          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Lỗi</span>
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
              <td className={tdCls} colSpan={8}>Tổng</td>
              <td className={tdCls}>{formatNumber(totalQty)}</td>
              <td className={tdCls}></td>
              <td className={tdNumCls}>{formatVND(totalAmount)}</td>
              <td className={tdCls}></td>
            </tr>
          </tfoot>
        </TableWrap>
      )}

      <SubmitButton disabled={!canSubmit} className={btnCls}>
        {confirmNow ? "Xác nhận → chuyển hàng tới đối tác" : "Tạo phiếu gửi nháp"}
      </SubmitButton>
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
