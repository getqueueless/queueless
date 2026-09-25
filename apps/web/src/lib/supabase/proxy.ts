import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes anyone can reach without a session: the landing page, the
// patient-status QR link, the counter/TV display board, the walk-in kiosk,
// and the login page itself.
const PUBLIC_PATH_PATTERNS = [
  /^\/$/,
  /^\/login$/,
  /^\/display\/[^/]+$/,
  /^\/t\/[^/]+$/,
  /^\/kiosk$/,
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return supabaseResponse;
  }

  // getClaims() verifies the JWT (locally via WebCrypto once asymmetric
  // signing keys are on; via a getUser() call to the auth server for this
  // stack's current symmetric secret -- see supabase/generate-keys.sh) and
  // is never satisfied by an unverified cookie.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub ?? null;

  if (!userId) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAdminPath(pathname)) {
    // Real schema (supabase/migrations/0002_organizations_profiles.sql) has
    // no separate `staff` table -- role lives on `profiles.role`
    // ('patient' | 'staff' | 'admin'), keyed by `profiles.id = auth.users.id`.
    // No RLS policy letting a user read their own profiles row has landed
    // yet, so any lookup failure denies admin access rather than granting it.
    let role: string | null = null;
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();
      role = profile?.role ?? null;
    } catch {
      role = null;
    }

    if (role !== "admin") {
      return NextResponse.redirect(new URL("/counter", request.url));
    }
  }

  return supabaseResponse;
}
