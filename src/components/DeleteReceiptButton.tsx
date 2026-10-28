"use client";

import { btnGhostCls } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";

/** Nút xoá phiếu nhập — chỉ Chủ cửa hàng thấy (quyền kiểm tra lại phía server). */
export default function DeleteReceiptButton({
  receiptId,
  kind,
  tab,
  docCode,
  action,
}: {
  receiptId: string;
  kind: "PN" | "NK";
  tab: string;
  docCode: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Xoá hẳn phiếu ${docCode}? Phiếu, các lô và biến động nhập của nó sẽ biến mất. Thao tác này không khôi phục được.`
          )
        )
          e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={receiptId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="tab" value={tab} />
      <SubmitButton className={btnGhostCls}>
        Xoá
      </SubmitButton>
    </form>
  );
}
