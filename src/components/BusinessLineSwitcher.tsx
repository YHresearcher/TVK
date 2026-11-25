"use client";

import { setBusinessLineContextAction } from "@/lib/actions";
import { BUSINESS_LINE_LABELS, type BusinessLineCode } from "@/lib/types";

/**
 * Bộ chuyển ngành hàng (§18.2) — đặt ngay dưới khối thương hiệu của
 * sidebar, trước điều hướng. Chỉ người được xem toàn doanh nghiệp
 * (OWNER/CEO) mới thấy ô chọn; người chỉ được gán một ngành thì thấy
 * huy hiệu tĩnh của ngành đó; tài khoản chưa gán ngành thì thấy cảnh
 * báo. Đổi ngành là server action ghi cookie phiên làm việc, rồi
 * revalidate toàn bộ layout — form đang mở ở ngành cũ không gửi nhầm
 * sang ngành mới vì server action nào cũng giải quyết ngành từ cookie
 * hiện tại, không tin mã ngành trình duyệt gửi kèm (§18.3).
 */
export interface BusinessLineSwitcherContext {
  mode: "ALL" | "LINE" | "NONE";
  code: BusinessLineCode | null;
  lines: { id: string; code: BusinessLineCode; name: string }[];
  canSeeAll: boolean;
}

export default function BusinessLineSwitcher({
  context,
}: {
  context: BusinessLineSwitcherContext;
}) {
  if (context.mode === "NONE") {
    return (
      <div className="border-b border-slate-200 px-5 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
          Ngành hàng
        </p>
        <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-800">
          Chưa được gán ngành — nhờ chủ cửa hàng gán ngành
        </p>
      </div>
    );
  }

  if (!context.canSeeAll) {
    const label =
      context.code ? BUSINESS_LINE_LABELS[context.code] : "—";
    return (
      <div className="border-b border-slate-200 px-5 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
          Ngành hàng
        </p>
        <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-900">
          {label}
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-slate-200 px-5 py-3">
      <label
        htmlFor="business-line-switcher"
        className="text-[11px] font-bold uppercase tracking-wider text-slate-600"
      >
        Ngành hàng
      </label>
      <form action={setBusinessLineContextAction} className="mt-1">
        <select
          id="business-line-switcher"
          name="business_line"
          defaultValue={context.mode === "ALL" ? "ALL" : context.code ?? "ALL"}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-900"
        >
          <option value="ALL">Toàn doanh nghiệp</option>
          {context.lines.map((line) => (
            <option key={line.id} value={line.code}>
              {BUSINESS_LINE_LABELS[line.code] ?? line.name}
            </option>
          ))}
        </select>
      </form>
    </div>
  );
}
