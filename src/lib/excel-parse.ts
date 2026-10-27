import * as XLSX from "xlsx";

/** Lowercase, strip Vietnamese diacritics, drop every non-alphanumeric char. */
export function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

export function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

export function toNum(v: unknown): number {
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

/** Read the first sheet of a workbook as an array of rows (header row first). */
export function readFirstSheetAOA(buf: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buf);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
}

/**
 * Map a header row to column indexes using alias lists.
 * Returns the column index per field plus format problems (duplicate
 * headers, missing required columns). Callers add their own checks for
 * optional columns.
 */
export function mapHeaderColumns(
  headerRow: unknown[],
  aliases: Record<string, string[]>,
  required: { field: string; label: string }[]
): { fieldCol: Partial<Record<string, number>>; problems: string[] } {
  const fieldCol: Partial<Record<string, number>> = {};
  const headerNorms: string[] = [];
  const problems: string[] = [];
  const seenH = new Set<string>();
  const dupH = new Set<string>();
  headerRow.forEach((h, idx) => {
    const n = normalizeHeader(h);
    headerNorms.push(n);
    if (!n) return;
    if (seenH.has(n)) dupH.add(n);
    seenH.add(n);
    for (const field of Object.keys(aliases)) {
      if (aliases[field].includes(n) && fieldCol[field] === undefined) {
        fieldCol[field] = idx;
      }
    }
  });
  if (dupH.size)
    problems.push(
      `Tiêu đề cột bị trùng lặp: ${Array.from(dupH).join(", ")}. Mỗi cột chỉ được xuất hiện một lần.`
    );
  const missing = required.filter((r) => fieldCol[r.field] === undefined);
  if (missing.length)
    problems.push(`Thiếu cột bắt buộc: ${missing.map((m) => m.label).join(", ")}.`);
  return { fieldCol, problems };
}
