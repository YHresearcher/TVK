"use server";

import {
  getConsignmentSlipDetail,
  getCurrentProfile,
  getInvoiceDetail,
  getSalesDocumentDetail,
  type DocumentDetail,
} from "@/lib/queries";
import { getBusinessLineContext } from "@/lib/business-lines";

export type DetailKind = "DOC" | "SLIP" | "INV";

/** Chi tiết hàng hoá của một chứng từ / phiếu gửi / hoá đơn, đọc khi bấm.
 *  Giá vốn và lãi chỉ trả về cho Chủ, Kế toán và CEO — các vai trò khác
 *  nhận bản đã lược (giá vốn/lãi bằng 0) ngay từ phía server.
 *  P2 (BL-001): chứng từ thuộc ngành khác thì không trả chi tiết — chỉ
 *  hoá đơn GTGT (chưa có ngành, P4) là ngoại lệ. */
export async function getDocumentDetailAction(
  kind: DetailKind,
  id: string
): Promise<{ detail: DocumentDetail | null; canSeeCost: boolean }> {
  const profile = await getCurrentProfile();
  const canSeeCost = ["OWNER", "ACCOUNTING", "CEO"].includes(profile.data?.role ?? "");
  let detail: DocumentDetail | null = null;
  if (kind === "DOC") detail = await getSalesDocumentDetail(id);
  else if (kind === "SLIP") detail = await getConsignmentSlipDetail(id);
  else detail = await getInvoiceDetail(id);
  if (!detail) return { detail: null, canSeeCost };
  if (kind !== "INV" && detail.business_line_id) {
    const ctx = await getBusinessLineContext();
    if (ctx.mode === "LINE" && detail.business_line_id !== ctx.lineId) {
      return { detail: null, canSeeCost };
    }
    if (ctx.mode === "NONE") {
      return { detail: null, canSeeCost };
    }
  }
  if (!canSeeCost) {
    detail = {
      ...detail,
      lines: detail.lines.map((l) => ({
        ...l,
        unitCost: 0,
        profit: 0,
        consumedProfit: l.consumedProfit === undefined ? undefined : 0,
        remainingProfitEstimate: l.remainingProfitEstimate === undefined ? undefined : 0,
      })),
      totalCost: 0,
      totalProfit: 0,
      consumedProfit: detail.consumedProfit === undefined ? undefined : 0,
      remainingProfitEstimate: detail.remainingProfitEstimate === undefined ? undefined : 0,
    };
  }
  return { detail, canSeeCost };
}
