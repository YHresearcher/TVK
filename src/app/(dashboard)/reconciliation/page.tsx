import { getCurrentProfile } from "@/lib/queries";
import {
  ensureOrSyncReconciliationPeriod,
  getAllReconciliationPeriods,
  getAllReconciliationSnapshots,
} from "@/lib/reconciliation-queries";
import ReconciliationClient from "./ReconciliationClient";
import type { ReconciliationPeriodType } from "@/types";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: {
    type?: string;
    from?: string;
    to?: string;
    month?: string;
  };
}

export default async function ReconciliationPage({ searchParams }: PageProps) {
  // 1. Phân quyền bảo mật: Kiểm tra role đăng nhập
  const { data: profile } = await getCurrentProfile();
  const rawRole = profile?.role || "GUEST";

  // Chặn hoàn toàn vai trò SALES và WAREHOUSE
  if (["SALES", "WAREHOUSE"].includes(rawRole)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-8 max-w-md shadow-sm">
          <div className="text-4xl mb-3">⛔</div>
          <h2 className="text-lg font-bold text-rose-900">
            Truy Cập Bị Từ Chối
          </h2>
          <p className="mt-2 text-xs text-rose-700 leading-relaxed">
            Phân hệ <strong>Đối Chiếu Kế Toán 2 Tầng & Chốt Kỳ</strong> thuộc vùng bảo mật cao, chỉ dành riêng cho <strong>Chủ cửa hàng (OWNER)</strong>, <strong>Kế toán (ACCOUNTING)</strong> và <strong>Ban điều hành (CEO)</strong>.
          </p>
          <p className="mt-2 text-[11px] text-stone-500">
            Vai trò hiện tại của bạn là: <span className="font-mono font-bold text-stone-700">{rawRole}</span>.
          </p>
          <div className="mt-5">
            <a
              href="/dashboard"
              className="inline-block px-4 py-2 rounded-lg bg-stone-900 text-white text-xs font-semibold hover:bg-stone-800 transition"
            >
              Quay lại Bàn làm việc
            </a>
          </div>
        </div>
      </div>
    );
  }

  // 2. Xác định khoảng thời gian đối chiếu
  const periodType: ReconciliationPeriodType =
    (searchParams.type as ReconciliationPeriodType) || "MONTH";

  // Mặc định là Tháng 10/2026 (Kỳ kiểm chứng đối chiếu chính với dữ liệu thực tế)
  let fromDate = searchParams.from || "2026-10-01";
  let toDate = searchParams.to || "2026-10-31";

  if (periodType === "MONTH" && searchParams.month) {
    const ym = searchParams.month;
    fromDate = `${ym}-01`;
    const [y, m] = ym.split("-");
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    toDate = `${ym}-${String(lastDay).padStart(2, "0")}`;
  }

  // 3. Tải danh sách các kỳ và dữ liệu kỳ hiện tại
  const allPeriods = await getAllReconciliationPeriods();

  const periodData = await ensureOrSyncReconciliationPeriod({
    periodType,
    fromDate,
    toDate,
  });

  const snapshots = await getAllReconciliationSnapshots(periodData.period?.id);

  return (
    <div className="min-w-0 max-w-7xl mx-auto py-2">
      <ReconciliationClient
        initialPeriod={periodData.period}
        initialEntries={periodData.entries}
        initialSnapshots={snapshots}
        allPeriods={allPeriods}
        userRole={rawRole}
      />
    </div>
  );
}
