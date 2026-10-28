"use client";

import { useFormStatus } from "react-dom";
import { btnCls } from "@/components/ui";

/**
 * Nút submit cho mọi form dùng server action: khi đang gửi thì hiện
 * spinner + chữ "Đang xử lý…" và khoá nút lại — bấm không còn cảm giác
 * "không biết có chạy không", và không bấm trùng được hai lần. Khi form
 * chưa đủ điều kiện gửi (prop disabled) thì nút vẫn mờ như cũ, đúng
 * nghĩa "chưa bấm được".
 */
export default function SubmitButton({
  children,
  disabled = false,
  className = btnCls,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const locked = disabled || pending;
  return (
    <button type="submit" disabled={locked} className={className}>
      {pending && (
        <span
          aria-hidden
          className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {pending ? "Đang xử lý…" : children}
    </button>
  );
}
