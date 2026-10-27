"use client";

import HelpButton from "@/components/HelpButton";
import { MOBILE_NAV_TOGGLE_EVENT } from "@/components/Sidebar";

/**
 * Thanh trên cùng chỉ hiện trên màn hình nhỏ (< lg): thương hiệu TVK +
 * nút hamburger ở trái, nút Trợ giúp ở phải. Sidebar tĩnh ở desktop được
 * thay bằng ngăn kéo trượt — nút hamburger phát sự kiện để Sidebar
 * (component client khác) mở/đóng ngăn kéo.
 */
export default function MobileTopBar({ role }: { role: string }) {
  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-2.5 lg:hidden">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Mở menu điều hướng"
          onClick={() => window.dispatchEvent(new Event(MOBILE_NAV_TOGGLE_EVENT))}
          className="rounded-md p-1.5 text-stone-700 hover:bg-stone-100"
        >
          <svg
            className="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div>
          <p className="text-base font-bold leading-tight tracking-wide text-stone-900">
            TVK
          </p>
          <p className="text-[11px] leading-tight text-stone-500">
            Tân Vạn Khang · Quản lý kho phụ tùng
          </p>
        </div>
      </div>
      <HelpButton role={role} />
    </div>
  );
}
