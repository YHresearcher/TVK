import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { getCurrentProfile } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userName = "Setup mode";
  let role = "Supabase not configured";

  if (isSupabaseConfigured()) {
    const { data: profile } = await getCurrentProfile();
    if (!profile) redirect("/login");
    userName = profile.full_name;
    role = ROLE_LABELS[profile.role] ?? profile.role;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar userName={userName} role={role} />
      <main className="min-w-0 flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
