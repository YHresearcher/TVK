import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response; // Not configured yet — let pages show the setup notice.

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname.startsWith("/login");
  // /auth/* pages (set-password from invitation / reset email links) must be
  // reachable without a session — the session arrives via the email link.
  const isPublicPage = isLoginPage || pathname.startsWith("/auth/");
  if (!user && !isPublicPage) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }
  if (user && isLoginPage) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    return NextResponse.redirect(redirectUrl);
  }

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("must_change_password")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.must_change_password) {
      const isServerAction = Boolean(request.headers.get("next-action"));
      const isApiRoute = pathname.startsWith("/api/");
      const isAuthPage = pathname.startsWith("/auth/");

      // FS-01: Chặn triệt để mọi Server Action và API route (trừ public auth API nếu có)
      // Không cho phép bất kỳ server action nào chạy khi chưa đổi mật khẩu,
      // kể cả khi POST tới đường dẫn /auth/* (tránh lỗ hổng bypass qua path).
      if (isServerAction || (isApiRoute && !pathname.startsWith("/api/auth/"))) {
        return new NextResponse(
          JSON.stringify({ error: "Tài khoản cần đổi mật khẩu trước khi thực hiện các thao tác khác." }),
          { status: 403, headers: { "content-type": "application/json" } }
        );
      }
      if (!isAuthPage && !isLoginPage) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = "/auth/change-password";
        return NextResponse.redirect(redirectUrl);
      }
    }
  }

  return response;
}
