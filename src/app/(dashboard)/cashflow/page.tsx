import { redirect } from "next/navigation";
import {
  getCurrentProfile,
  getCashFundBalances,
  listCashFunds,
  listCashCategories,
  listCashMovements,
  getMonthlyCashflowSummary,
} from "@/lib/queries";
import { getCashFlowRunway } from "@/lib/audit";
import CashflowOverview from "./CashflowOverview";
import CashflowQuickActions from "./CashflowQuickActions";
import CashflowLedger from "./CashflowLedger";
import CashflowMonthlyReport from "./CashflowMonthlyReport";

export const dynamic = "force-dynamic";

const PERMITTED_ROLES = new Set(["OWNER", "CEO", "ACCOUNTING"]);

export default async function CashflowPage() {
  const profileRes = await getCurrentProfile();
  const profile = profileRes.data;

  // Bảo mật phân quyền: Chỉ OWNER, CEO, ACCOUNTING được xem.
  // SALES và WAREHOUSE tuyệt đối không có quyền truy cập -> chuyển hướng sang /dashboard?error=access_denied
  if (!profile || !PERMITTED_ROLES.has(profile.role)) {
    redirect("/dashboard?error=access_denied");
  }

  const isOwner = profile.role === "OWNER";

  // Truy vấn dữ liệu song song từ các nguồn chuẩn hoá
  const [
    fundBalancesRes,
    cashFundsRes,
    categories,
    movements,
    monthlySummary,
    runway,
  ] = await Promise.all([
    getCashFundBalances(),
    listCashFunds(),
    listCashCategories(true),
    listCashMovements({ limit: 500 }),
    getMonthlyCashflowSummary(),
    getCashFlowRunway(),
  ]);

  const fundBalances = fundBalancesRes.data;
  const funds = cashFundsRes.data;

  const roleLabel =
    profile.role === "OWNER"
      ? "Chủ cửa hàng (Toàn quyền)"
      : profile.role === "CEO"
      ? "CEO (Giám sát điều hành)"
      : "Kế toán (Thu/Chi công nợ & Đối soát)";

  return (
    <div className="space-y-6">
      {/* Tiêu đề Trang Sổ Quỹ & Dòng Tiền */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Sổ Quỹ & Quản Trị Dòng Tiền
            </h1>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 border border-blue-200">
              /cashflow
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Quản trị dòng tiền thuần thực thu – thực chi, số dư ngân quỹ thực tế, chi phí vận hành ngoài công nợ và dự báo thanh khoản 14–30 ngày.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200">
            {roleLabel}
          </span>
        </div>
      </div>

      {/* Thanh Tác Vụ Nhanh (Chỉ hiện / kích hoạt cho OWNER) */}
      <CashflowQuickActions
        isOwner={isOwner}
        funds={funds}
        categories={categories}
      />

      {/* Khối 1: Tổng quan số dư ngân quỹ thực tế & Dự báo Dòng tiền 14-30 ngày */}
      <CashflowOverview
        fundBalances={fundBalances}
        cashflow={runway}
      />

      {/* Khối 2: Tổng hợp Thực thu - Thực chi & Lãi ròng quản trị theo tháng */}
      <CashflowMonthlyReport
        summary={monthlySummary}
      />

      {/* Khối 3: Sổ giao dịch ngân quỹ hợp nhất (Unified Transaction Log) */}
      <CashflowLedger
        movements={movements}
        funds={funds}
        isOwner={isOwner}
      />
    </div>
  );
}
