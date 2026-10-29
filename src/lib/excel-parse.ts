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

/**
 * Parse an Excel date cell into ISO YYYY-MM-DD, or "" when the cell is
 * empty. Returns "" for unparseable non-empty values too — callers that
 * must reject bad dates check the raw cell themselves. Accepted forms:
 * a JS Date, an Excel serial day number, ISO text (2027-05-01), or a
 * Vietnamese date (01/05/2027, 1-5-2027, 01.05.2027).
 */
export function toDateISO(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    // Excel serial: day 1 = 1900-01-01 (with the Lotus leap-year quirk
    // folded into the 1899-12-30 epoch). Plausible range ~2000-2100.
    if (v < 30000 || v > 80000) return "";
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const out = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    return validISODate(out) ? out : "";
  }
  const vn = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (vn) {
    const out = `${vn[3]}-${vn[2].padStart(2, "0")}-${vn[1].padStart(2, "0")}`;
    return validISODate(out) ? out : "";
  }
  return "";
}

function validISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Read the first sheet of a workbook as an array of rows (header row first).
 * The xlsx library is loaded on demand (only when a file is picked) so the
 * import pages stay light on first load.
 */
export async function readFirstSheetAOA(buf: ArrayBuffer): Promise<unknown[][]> {
  const XLSX = await import("xlsx");
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
