import { redirect } from "next/navigation";
import HelpButton from "@/components/HelpButton";
import MobileTopBar from "@/components/MobileTopBar";
import Sidebar from "@/components/Sidebar";
import { signOutAction } from "@/lib/actions";
import SubmitButton from "@/components/SubmitButton";
import { getCurrentProfile } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userName = "Chế độ cài đặt";
  let role = "Chưa cấu hình Supabase";
  let rawRole = "";

  if (isSupabaseConfigured()) {
    const { data: profile } = await getCurrentProfile();
    if (!profile) {
      // Signed in but no profile row: show a clear dead end instead of
      // redirecting to /login, which would bounce straight back here.
      return (
        <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
          <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-8 shadow-xl">
            <h1 className="text-xl font-bold text-stone-900">Tài khoản chưa sẵn sàng</h1>
            <p className="mt-2 text-sm text-stone-600">
              Bạn đã đăng nhập, nhưng chưa có hồ sơ TVK nào gắn với tài khoản
              này. Hãy nhờ chủ cửa hàng tạo hồ sơ cho bạn (Cài đặt → Người dùng
              &amp; vai trò), rồi đăng nhập lại.
            </p>
            <form action={signOutAction} className="mt-5">
              <SubmitButton
                className="w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
              >
                Đăng xuất
              </SubmitButton>
            </form>
          </div>
        </div>
      );
    }
    if (profile.must_change_password) {
      // Đang dùng mật khẩu tạm hoặc vừa yêu cầu đặt lại: bắt buộc đổi
      // mật khẩu đạt chuẩn trước khi vào bất kỳ trang nào của hệ thống.
      redirect("/auth/change-password");
    }
    userName = profile.full_name;
    role = ROLE_LABELS[profile.role] ?? profile.role;
    rawRole = profile.role;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar userName={userName} role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Thanh trên cùng cho màn hình nhỏ: hamburger + Trợ giúp.
            Từ lg trở lên ẩn — khi đó dùng sidebar tĩnh và hàng Trợ giúp
            bên dưới như cũ. */}
        <MobileTopBar role={rawRole} />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
          <div className="mb-4 hidden items-center justify-end lg:flex">
            <HelpButton role={rawRole} />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
