"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Chọn đối tác là tự chuyển ngay, không cần bấm nút Xem. */
export default function PartnerSelect({
  options,
  defaultValue,
  className,
}: {
  options: { value: string; label: string }[];
  defaultValue: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <select
      name="partner"
      defaultValue={defaultValue}
      className={className}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value) params.set("partner", e.target.value);
        else params.delete("partner");
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      }}
    >
      <option value="">— Chọn đối tác —</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
