/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureOrSyncReconciliationPeriod,
  computeLiveTVKMetrics,
} from "./reconciliation-queries";
import type {
  DiscrepancyStatus,
  ReconciliationDataGroup,
  ReconciliationPeriodType,
} from "@/types";

/**
 * Kiểm tra quyền hạn nghiêm ngặt theo ma trận bảo mật 5 vai trò TVK
 * - OWNER: Toàn quyền
 * - CEO: Chỉ xem (Chặn mọi mutation)
 * - ACCOUNTING: Xem + Nhập số kế toán, ghi chú, phân loại lệch, import Excel; Chặn tạo snapshot
 * - SALES / WAREHOUSE: Bị cấm hoàn toàn
 */
async function verifyReconciliationRole(
  allowedRoles: string[],
  actionDescription: string
): Promise<{ uid: string; role: string }> {
  const supabase = await createClient();
  if (!supabase) throw new Error("Hệ thống chưa cài đặt xong — hãy báo chủ cửa hàng.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Chưa đăng nhập.");

  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = prof?.role;
  if (!role) throw new Error("Không tìm thấy thông tin vai trò người dùng.");

  if (["SALES", "WAREHOUSE"].includes(role)) {
    throw new Error(`Truy cập bị từ chối: Vai trò ${role} không có quyền vào phân hệ Đối chiếu Kế toán.`);
  }

  if (role === "CEO" && !allowedRoles.includes("CEO")) {
    throw new Error("Tài khoản CEO chỉ có quyền xem báo cáo, không được phép chỉnh sửa số liệu.");
  }

  if (!allowedRoles.includes(role)) {
    throw new Error(`Không đủ quyền thực hiện thao tác: ${actionDescription}`);
  }

  return { uid: user.id, role };
}

/**
 * Action: Lấy hoặc tạo kỳ đối chiếu, tự động đồng bộ số liệu TVK
 */
export async function getReconciliationPeriodAction(params: {
  periodType: ReconciliationPeriodType;
  fromDate: string;
  toDate: string;
  name?: string;
  forceRefresh?: boolean;
}) {
  try {
    await verifyReconciliationRole(
      ["OWNER", "ACCOUNTING", "CEO"],
      "Xem dữ liệu đối chiếu kế toán"
    );

    const result = await ensureOrSyncReconciliationPeriod(params);
    return { success: true, data: result };
  } catch (error: any) {
    return { success: false, error: error.message || "Lỗi tải kỳ đối chiếu" };
  }
}

/**
 * Action: Đồng bộ lại số liệu TVK mới nhất cho một kỳ đã tạo
 */
export async function syncReconciliationAction(periodId: string) {
  try {
    await verifyReconciliationRole(
      ["OWNER", "ACCOUNTING"],
      "Đồng bộ số liệu TVK"
    );

    const supabase = await createClient();
    if (!supabase) throw new Error("Hệ thống chưa cài đặt xong — hãy báo chủ cửa hàng.");

    const { data: period, error: pErr } = await supabase
      .from("reconciliation_periods")
      .select("*")
      .eq("id", periodId)
      .single();

    if (pErr || !period) throw new Error("Không tìm thấy kỳ đối chiếu.");

    if (period.status === "LOCKED") {
      throw new Error("Kỳ đối chiếu này đã bị khoá, không thể đồng bộ lại.");
    }

    // Tính lại số liệu live
    const liveLines = await computeLiveTVKMetrics(period.from_date, period.to_date);

    // Lấy entries hiện tại
    const { data: existingEntries } = await supabase
      .from("reconciliation_entries")
      .select("*")
      .eq("period_id", periodId);

    const existingMap = new Map<string, any>();
    for (const e of (existingEntries ?? []) as any[]) {
      existingMap.set(`${e.data_group}__${e.item_key}`, e);
    }

    const adminClient = createAdminClient() || supabase;
    const entriesToUpsert: any[] = [];

    for (const line of liveLines) {
      const key = `${line.data_group}__${line.item_key}`;
      const old = existingMap.get(key);

      if (old) {
        entriesToUpsert.push({
          id: old.id,
          period_id: periodId,
          data_group: line.data_group,
          item_key: line.item_key,
          item_name: line.item_name,
          item_subtext: line.item_subtext,
          tvk_amount: line.tvk_amount,
          accounting_amount: old.accounting_amount,
          discrepancy_status: old.discrepancy_status,
          explanation_note: old.explanation_note,
          drilldown_data: line.drilldown_data,
          updated_at: new Date().toISOString(),
        });
      } else {
        entriesToUpsert.push({
          period_id: periodId,
          data_group: line.data_group,
          item_key: line.item_key,
          item_name: line.item_name,
          item_subtext: line.item_subtext,
          tvk_amount: line.tvk_amount,
          accounting_amount: 0,
          discrepancy_status: Math.abs(line.tvk_amount) < 0.01 ? "MATCHED" : "PENDING",
          explanation_note: null,
          drilldown_data: line.drilldown_data,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (entriesToUpsert.length > 0) {
      const { error: upsertErr } = await adminClient
        .from("reconciliation_entries")
        .upsert(entriesToUpsert, { onConflict: "period_id, data_group, item_key" });
      if (upsertErr) throw upsertErr;
    }

    revalidatePath("/reconciliation");
    return { success: true, count: entriesToUpsert.length };
  } catch (error: any) {
    return { success: false, error: error.message || "Lỗi đồng bộ số liệu TVK" };
  }
}

/**
 * Action: Cập nhật số liệu kế toán, phân loại sai lệch và ghi chú giải trình cho một dòng đối chiếu
 */
export async function updateReconciliationEntryAction(params: {
  entryId: string;
  accountingAmount?: number;
  discrepancyStatus?: DiscrepancyStatus;
  explanationNote?: string | null;
}) {
  try {
    await verifyReconciliationRole(
      ["OWNER", "ACCOUNTING"],
      "Cập nhật số liệu hoặc giải trình đối chiếu"
    );

    const supabase = await createClient();
    if (!supabase) throw new Error("Hệ thống chưa cài đặt xong — hãy báo chủ cửa hàng.");

    const { entryId, accountingAmount, discrepancyStatus, explanationNote } = params;
    if (!entryId) throw new Error("Thiếu entryId.");

    // Lấy entry hiện tại
    const { data: cur, error: getErr } = await supabase
      .from("reconciliation_entries")
      .select("*, reconciliation_periods(status)")
      .eq("id", entryId)
      .single();

    if (getErr || !cur) throw new Error("Không tìm thấy dòng đối chiếu.");
    if (cur.reconciliation_periods?.status === "LOCKED") {
      throw new Error("Kỳ đối chiếu này đã bị khoá.");
    }

    const updatePayload: any = {
      updated_at: new Date().toISOString(),
    };

    if (accountingAmount !== undefined) {
      updatePayload.accounting_amount = accountingAmount;
    }

    if (discrepancyStatus !== undefined) {
      updatePayload.discrepancy_status = discrepancyStatus;
    }

    if (explanationNote !== undefined) {
      updatePayload.explanation_note = explanationNote;
    }

    const { data, error } = await supabase
      .from("reconciliation_entries")
      .update(updatePayload)
      .eq("id", entryId)
      .select("*")
      .single();

    if (error) throw error;

    revalidatePath("/reconciliation");
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message || "Lỗi cập nhật dòng đối chiếu" };
  }
}

/**
 * Action: Import hàng loạt số liệu kế toán từ file Excel
 */
export async function importReconciliationEntriesAction(
  periodId: string,
  entries: Array<{
    itemKey?: string;
    itemName: string;
    dataGroup?: ReconciliationDataGroup;
    accountingAmount: number;
    explanationNote?: string;
    discrepancyStatus?: DiscrepancyStatus;
  }>
) {
  try {
    await verifyReconciliationRole(
      ["OWNER", "ACCOUNTING"],
      "Import số liệu kế toán từ Excel"
    );

    const supabase = await createClient();
    if (!supabase) throw new Error("Hệ thống chưa cài đặt xong — hãy báo chủ cửa hàng.");

    if (!periodId) throw new Error("Thiếu ID kỳ đối chiếu.");
    if (!entries || entries.length === 0) throw new Error("Danh sách dữ liệu import trống.");

    // Lấy toàn bộ entries của kỳ hiện tại
    const { data: dbEntries, error: getErr } = await supabase
      .from("reconciliation_entries")
      .select("*")
      .eq("period_id", periodId);

    if (getErr) throw getErr;

    const list = (dbEntries ?? []) as any[];
    const byKey = new Map<string, any>();
    const byName = new Map<string, any>();

    for (const e of list) {
      byKey.set(e.item_key.toLowerCase(), e);
      byName.set(e.item_name.toLowerCase().trim(), e);
    }

    let updatedCount = 0;
    const admin = createAdminClient() || supabase;

    for (const row of entries) {
      // Tìm dòng đối chiếu tương ứng theo key hoặc tên
      let matched = row.itemKey ? byKey.get(row.itemKey.toLowerCase()) : null;
      if (!matched && row.itemName) {
        matched = byName.get(row.itemName.toLowerCase().trim());
      }

      if (matched) {
        const updateData: any = {
          accounting_amount: row.accountingAmount,
          updated_at: new Date().toISOString(),
        };

        if (row.explanationNote) {
          updateData.explanation_note = row.explanationNote;
        }

        if (row.discrepancyStatus) {
          updateData.discrepancy_status = row.discrepancyStatus;
        }

        const { error: updErr } = await admin
          .from("reconciliation_entries")
          .update(updateData)
          .eq("id", matched.id);

        if (!updErr) updatedCount++;
      }
    }

    revalidatePath("/reconciliation");
    return {
      success: true,
      message: `Đã cập nhật thành công ${updatedCount}/${entries.length} khoản mục từ file Excel.`,
      updatedCount,
    };
  } catch (error: any) {
    return { success: false, error: error.message || "Lỗi import file Excel" };
  }
}

/**
 * Action: Lưu bản chốt kỳ (Snapshot) lịch sử
 * Chỉ OWNER mới có quyền thực hiện
 */
export async function createReconciliationSnapshotAction(
  periodId: string,
  snapshotName?: string,
  note?: string
) {
  try {
    await verifyReconciliationRole(
      ["OWNER"],
      "Chốt kỳ đối chiếu và lưu bản Snapshot lịch sử"
    );

    const supabase = await createClient();
    if (!supabase) throw new Error("Hệ thống chưa cài đặt xong — hãy báo chủ cửa hàng.");

    if (!periodId) throw new Error("Thiếu ID kỳ đối chiếu.");

    // Gọi stored procedure create_reconciliation_snapshot
    const { data: snapshotId, error: rpcErr } = await supabase.rpc(
      "create_reconciliation_snapshot",
      {
        p_period_id: periodId,
        p_name: snapshotName || null,
        p_note: note || null,
      }
    );

    if (rpcErr) {
      // Fallback: nếu RPC gặp lỗi hoặc không tìm thấy hàm, thực hiện snapshot thủ công
      console.warn("RPC create_reconciliation_snapshot failed, attempting manual snapshot:", rpcErr);

      const { data: period } = await supabase
        .from("reconciliation_periods")
        .select("*")
        .eq("id", periodId)
        .single();
      if (!period) throw new Error("Không tìm thấy kỳ đối chiếu.");

      const { data: entries } = await supabase
        .from("reconciliation_entries")
        .select("*")
        .eq("period_id", periodId);

      const entryList = (entries ?? []) as any[];
      const nonExcluded = entryList.filter(
        (e) => e.item_key !== "REV_TOTAL" && e.item_key !== "INV_CONSIGNED_REF"
      );
      const totalTvk = nonExcluded.reduce((acc, e) => acc + Number(e.tvk_amount || 0), 0);
      const totalAcc = nonExcluded.reduce((acc, e) => acc + Number(e.accounting_amount || 0), 0);
      const totalDiff = totalTvk - totalAcc;

      const { data: lastSnap } = await supabase
        .from("reconciliation_snapshots")
        .select("snapshot_no")
        .eq("period_id", periodId)
        .order("snapshot_no", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextNo = (lastSnap?.snapshot_no || 0) + 1;

      const admin = createAdminClient() || supabase;
      const { data: insData, error: insErr } = await admin
        .from("reconciliation_snapshots")
        .insert({
          period_id: periodId,
          snapshot_no: nextNo,
          name: snapshotName || `${period.name} - Bản chốt ${nextNo}`,
          period_name: period.name,
          from_date: period.from_date,
          to_date: period.to_date,
          total_tvk: totalTvk,
          total_acc: totalAcc,
          total_diff: totalDiff,
          summary: {
            total_entries: entryList.length,
            matched_count: entryList.filter((e) => e.discrepancy_status === "MATCHED").length,
            pending_count: entryList.filter((e) => e.discrepancy_status === "PENDING").length,
          },
          snapshot_items: entryList,
          note: note || null,
        })
        .select("id")
        .single();

      if (insErr) throw insErr;

      await admin
        .from("reconciliation_periods")
        .update({ status: "RECONCILED" })
        .eq("id", periodId);

      revalidatePath("/reconciliation");
      return { success: true, snapshotId: insData.id };
    }

    revalidatePath("/reconciliation");
    return { success: true, snapshotId };
  } catch (error: any) {
    return { success: false, error: error.message || "Lỗi lưu bản chốt kỳ" };
  }
}

/**
 * Action: Xoá bản snapshot lịch sử (Chỉ OWNER)
 */
export async function deleteReconciliationSnapshotAction(snapshotId: string) {
  try {
    await verifyReconciliationRole(
      ["OWNER"],
      "Xoá bản Snapshot lịch sử"
    );

    const supabase = await createClient();
    if (!supabase) throw new Error("Hệ thống chưa cài đặt xong — hãy báo chủ cửa hàng.");

    const { error } = await supabase
      .from("reconciliation_snapshots")
      .delete()
      .eq("id", snapshotId);

    if (error) throw error;

    revalidatePath("/reconciliation");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Lỗi xoá bản chốt kỳ" };
  }
}
