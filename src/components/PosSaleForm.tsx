"use client";

import { useMemo, useRef, useState } from "react";
import { Card, TableWrap, btnCls, inputCls, labelCls, tdCls, thCls } from "@/components/ui";
import { formatVND } from "@/lib/format";
import { normalizeHeader } from "@/lib/excel-parse";
import { OWNERSHIP_LABELS } from "@/lib/types";

export interface PosPartner {
  id: string;
  name: string;
  kind: string;
}

export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  retailPrice: number;
  garagePrice: number;
  wholesalePrice: number;
  fitments: string[];
}

export interface PosBatch {
  batch_id: string;
  batch_code: string;
  ownership: string;
  mainOwnQty: number;
}

type Tier = "retail" | "garage" | "wholesale";

const TIER_LABELS: Record<Tier, string> = {
  retail: "Giá lẻ",
  garage: "Giá gara",
  wholesale: "Giá đại lý",
};

/** Giá theo loại đối tác: Gara thì giá gara, đối tác còn lại thì giá đại lý, khách lẻ thì giá lẻ. */
function tierFor(kind: string | null): Tier {
  if (!kind || kind === "RETAIL") return "retail";
  if (kind === "GARAGE") return "garage";
  return "wholesale";
}

function priceOf(p: PosProduct, tier: Tier): number {
  return tier === "retail" ? p.retailPrice : tier === "garage" ? p.garagePrice : p.wholesalePrice;
}

/** Giá điền sẵn: có giá thì điền, chưa có giá thì để trống cho tự nhập. */
function priceInput(p: PosProduct, tier: Tier): string {
  const v = priceOf(p, tier);
  return v > 0 ? String(v) : "";
}

interface Line {
  key: number;
  productId: string;
  batchId: string;
  qty: number;
  unitPrice: string;
}

/**
 * Quầy bán hàng kiểu siêu thị: một ô tìm hàng (tên / mã xe / mã hàng /
 * barcode), Enter là thêm dòng xuống danh sách bên dưới, không có dòng
 * trống chờ sẵn. Giá tự theo loại khách hàng đã chọn; đổi khách hàng thì
 * các dòng đã thêm cũng đổi giá theo. Nút "Bán hàng" cạnh ô tìm là hoàn
 * tất đơn — lô của mình vào BH, lô ký gửi vào KG, như form cũ.
 */
export default function PosSaleForm({
  partners,
  products,
  codeMap,
  fifoBatches,
  action,
}: {
  partners: PosPartner[];
  products: PosProduct[];
  /** Mã đã đăng ký hoặc SKU (trim + hoa) → product_id. */
  codeMap: Record<string, string>;
  /** Lô còn hàng tại kho của mình, cũ nhất trước, theo từng sản phẩm. */
  fifoBatches: Record<string, PosBatch[]>;
  action: (formData: FormData) => Promise<void>;
}) {
  const [partner, setPartner] = useState<PosPartner | null>(null);
  const [partnerQuery, setPartnerQuery] = useState("");
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [partnerHi, setPartnerHi] = useState(0);
  const [freeName, setFreeName] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHi, setSearchHi] = useState(0);
  const [searchMsg, setSearchMsg] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState("0");
  const [isCredit, setIsCredit] = useState(false);
  const keyRef = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const tier = tierFor(partner?.kind ?? null);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const codesByProduct = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [code, pid] of Object.entries(codeMap)) {
      const list = m.get(pid) ?? [];
      list.push(code);
      m.set(pid, list);
    }
    return m;
  }, [codeMap]);

  const haystacks = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) {
      const codes = codesByProduct.get(p.id) ?? [];
      m.set(p.id, normalizeHeader([p.name, p.sku, ...codes, ...p.fitments].join(" ")));
    }
    return m;
  }, [products, codesByProduct]);

  const results = useMemo(() => {
    const q = normalizeHeader(search);
    if (!q) return [];
    const out: PosProduct[] = [];
    for (const p of products) {
      if ((haystacks.get(p.id) ?? "").includes(q)) out.push(p);
      if (out.length >= 8) break;
    }
    return out;
  }, [search, products, haystacks]);

  const partnerResults = useMemo(() => {
    const q = normalizeHeader(partnerQuery);
    if (!q) return partners;
    return partners.filter((p) => normalizeHeader(p.name).includes(q));
  }, [partnerQuery, partners]);

  const stockOf = (productId: string) =>
    (fifoBatches[productId] ?? []).reduce((a, b) => a + b.mainOwnQty, 0);

  function pickPartner(p: PosPartner | null) {
    setPartner(p);
    setPartnerQuery(p ? p.name : "");
    setPartnerOpen(false);
    const nextTier = tierFor(p?.kind ?? null);
    setLines((ls) =>
      ls.map((l) => {
        const prod = productById.get(l.productId);
        return prod ? { ...l, unitPrice: priceInput(prod, nextTier) } : l;
      })
    );
  }

  function addProduct(productId: string) {
    const p = productById.get(productId);
    if (!p) return;
    const batches = fifoBatches[productId] ?? [];
    if (!batches.length) {
      setSearchMsg(`“${p.name}” đã hết hàng tại kho của mình.`);
      return;
    }
    const pick = batches[0];
    setSearchMsg("");
    const ix = lines.findIndex((l) => l.productId === productId && l.batchId === pick.batch_id);
    if (ix >= 0) {
      const copy = [...lines];
      const cur = copy[ix];
      copy[ix] = { ...cur, qty: Math.min(cur.qty + 1, pick.mainOwnQty) };
      setLines(copy);
    } else {
      setLines([
        ...lines,
        {
          key: ++keyRef.current,
          productId,
          batchId: pick.batch_id,
          qty: 1,
          unitPrice: priceInput(p, tier),
        },
      ]);
    }
    setSearch("");
    setSearchOpen(false);
    searchRef.current?.focus();
  }

  function resolveSearch() {
    const raw = search.trim();
    if (!raw) return;
    // Máy quét gửi đúng mã + Enter: khớp chính xác thì thêm ngay.
    const exact = codeMap[raw.toUpperCase()];
    if (exact) {
      addProduct(exact);
      return;
    }
    if (results.length === 0) {
      setSearchMsg("Không tìm thấy hàng theo tên, mã xe, mã hàng hoặc barcode vừa gõ.");
      return;
    }
    addProduct(results[Math.min(searchHi, results.length - 1)].id);
  }

  const subtotal = lines.reduce((a, l) => a + l.qty * (Number(l.unitPrice) || 0), 0);
  const bhSubtotal = lines.reduce((a, l) => {
    const b = (fifoBatches[l.productId] ?? []).find((x) => x.batch_id === l.batchId);
    return a + (b?.ownership === "OWNED" ? l.qty * (Number(l.unitPrice) || 0) : 0);
  }, 0);
  const discountNum = Math.max(0, Number(discount) || 0);
  const total = Math.max(0, subtotal - Math.min(discountNum, bhSubtotal));

  return (
    <Card title="Bán hàng tại quầy">
      <form
        action={action}
        className="space-y-4"
        onKeyDown={(e) => {
          // Enter trong các ô gõ số/chữ không được vô tình hoàn tất đơn —
          // chỉ nút "Bán hàng" mới hoàn tất.
          const t = e.target as HTMLElement;
          if (
            e.key === "Enter" &&
            t.tagName === "INPUT" &&
            (t as HTMLInputElement).type !== "checkbox"
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="partner_id" value={partner?.id ?? ""} />
        <div className="grid gap-3 md:grid-cols-3">
          <div className="relative">
            <label className={labelCls}>Khách hàng</label>
            <input
              className={inputCls}
              value={partnerQuery}
              placeholder="Khách lẻ hoặc gõ tên đối tác…"
              onFocus={() => {
                setPartnerOpen(true);
                setPartnerHi(0);
              }}
              onChange={(e) => {
                setPartnerQuery(e.target.value);
                setPartnerOpen(true);
                setPartnerHi(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  pickPartner(partnerHi === 0 ? null : partnerResults[partnerHi - 1] ?? null);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setPartnerHi((h) => Math.min(h + 1, partnerResults.length));
                  setPartnerOpen(true);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setPartnerHi((h) => Math.max(h - 1, 0));
                } else if (e.key === "Escape") {
                  setPartnerOpen(false);
                  setPartnerQuery(partner ? partner.name : "");
                }
              }}
              onBlur={() => {
                setPartnerOpen(false);
                setPartnerQuery(partner ? partner.name : "");
              }}
            />
            {partnerOpen && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickPartner(null);
                  }}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                    partnerHi === 0 ? "bg-slate-100" : ""
                  }`}
                >
                  Khách lẻ
                </button>
                {partnerResults.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickPartner(p);
                    }}
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                      partnerHi === i + 1 ? "bg-slate-100" : ""
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
                {partnerResults.length === 0 && (
                  <p className="px-3 py-2 text-sm text-slate-500">Không có đối tác nào khớp.</p>
                )}
              </div>
            )}
          </div>
          <div>
            <label className={labelCls}>Tên khách hàng</label>
            <input
              name="customer_name"
              className={inputCls}
              value={partner ? partner.name : freeName}
              readOnly={!!partner}
              placeholder="Tên khách hàng (không bắt buộc)"
              onChange={(e) => setFreeName(e.target.value)}
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="is_credit"
                checked={isCredit}
                onChange={(e) => setIsCredit(e.target.checked)}
                className="h-4 w-4"
              />{" "}
              Ghi nợ (tạo phải thu)
            </label>
          </div>
        </div>
        <p className="text-sm text-slate-500">
          Giá áp dụng: <span className="font-medium text-slate-800">{TIER_LABELS[tier]}</span>
          {partner ? ` — ${partner.name}` : " — khách lẻ"}. Giảm giá chỉ trừ trên phần hàng của
          mình (BH).
        </p>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              ref={searchRef}
              autoFocus
              className={inputCls}
              value={search}
              placeholder="Tìm theo tên, mã xe, mã hàng hoặc quét barcode rồi Enter…"
              onFocus={() => {
                if (search.trim()) setSearchOpen(true);
              }}
              onChange={(e) => {
                setSearch(e.target.value);
                setSearchOpen(true);
                setSearchHi(0);
                setSearchMsg("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  resolveSearch();
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSearchHi((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
                  setSearchOpen(true);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSearchHi((h) => Math.max(h - 1, 0));
                } else if (e.key === "Escape") {
                  setSearchOpen(false);
                }
              }}
              onBlur={() => setSearchOpen(false)}
            />
            {searchOpen && results.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                {results.map((p, i) => {
                  const stock = stockOf(p.id);
                  const price = priceOf(p, tier);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addProduct(p.id);
                      }}
                      className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                        searchHi === i ? "bg-slate-100" : ""
                      }`}
                    >
                      <span>
                        <span className="font-medium">{p.name}</span>{" "}
                        <span className="text-xs text-slate-500">
                          {p.sku}
                          {p.fitments.length > 0 ? ` · ${p.fitments.join(", ")}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {stock > 0 ? (
                          <>
                            {price > 0 ? formatVND(price) : <span className="text-amber-600">Chưa có giá</span>}
                            {` · Tồn ${stock}`}
                          </>
                        ) : (
                          <span className="text-amber-600">Hết hàng</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button type="submit" className={btnCls} disabled={lines.length === 0}>
            Bán hàng
          </button>
        </div>
        {searchMsg && <p className="text-sm text-amber-700">{searchMsg}</p>}

        {lines.length === 0 ? (
          <p className="text-sm text-slate-500">
            Chưa có dòng hàng nào — quét hoặc tìm mã rồi Enter để thêm.
          </p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th className={thCls}>Hàng hoá</th>
                <th className={thCls}>Lô</th>
                <th className={thCls}>Số lượng</th>
                <th className={thCls}>Đơn giá (₫)</th>
                <th className={thCls}>Thành tiền</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = productById.get(l.productId);
                const batches = fifoBatches[l.productId] ?? [];
                const batch = batches.find((b) => b.batch_id === l.batchId) ?? batches[0];
                const maxQty = batch?.mainOwnQty ?? 1;
                if (!p) return null;
                return (
                  <tr key={l.key} className="border-t border-slate-100">
                    <td className={tdCls}>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-slate-500">
                        {p.sku}
                        {p.fitments.length > 0 ? ` · ${p.fitments.join(", ")}` : ""}
                      </div>
                    </td>
                    <td className={tdCls}>
                      <select
                        name="batch_id"
                        className={inputCls}
                        value={l.batchId}
                        onChange={(e) => {
                          const nb = batches.find((b) => b.batch_id === e.target.value);
                          setLines((ls) =>
                            ls.map((x) =>
                              x.key === l.key
                                ? {
                                    ...x,
                                    batchId: e.target.value,
                                    qty: Math.min(x.qty, nb?.mainOwnQty ?? x.qty),
                                  }
                                : x
                            )
                          );
                        }}
                      >
                        {batches.map((b) => (
                          <option key={b.batch_id} value={b.batch_id}>
                            {`${b.batch_code} — ${OWNERSHIP_LABELS[b.ownership] ?? b.ownership} · tồn ${b.mainOwnQty}`}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={tdCls}>
                      <input
                        name="qty"
                        type="number"
                        min="1"
                        max={maxQty}
                        className={inputCls}
                        value={l.qty}
                        onChange={(e) => {
                          const v = Math.trunc(Number(e.target.value) || 0);
                          setLines((ls) =>
                            ls.map((x) =>
                              x.key === l.key
                                ? { ...x, qty: Math.max(1, Math.min(v || 1, maxQty)) }
                                : x
                            )
                          );
                        }}
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        name="unit_price"
                        type="number"
                        step="1000"
                        className={inputCls}
                        value={l.unitPrice}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((x) => (x.key === l.key ? { ...x, unitPrice: e.target.value } : x))
                          )
                        }
                      />
                    </td>
                    <td className={tdCls}>{formatVND(l.qty * (Number(l.unitPrice) || 0))}</td>
                    <td className={tdCls}>
                      <button
                        type="button"
                        aria-label="Xoá dòng"
                        className="text-slate-400 hover:text-red-600"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}

        <div className="flex flex-col items-end gap-2 text-sm">
          <p>
            Tạm tính: <span className="font-medium">{formatVND(subtotal)}</span>
          </p>
          <p className="flex items-center gap-2">
            <label className={labelCls}>Giảm giá (₫)</label>
            <input
              name="discount_amount"
              type="number"
              step="1000"
              min="0"
              className={inputCls}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </p>
          <p className="text-base">
            Tổng cộng: <span className="font-semibold">{formatVND(total)}</span>
          </p>
        </div>
      </form>
    </Card>
  );
}
