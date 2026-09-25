import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getMyProfile } from "./get-role";

// Routes anyone can reach without a session: the landing page, the staff/
// patient login surface and its OAuth callback, the patient-status QR link,
// the TV display board. /kiosk is a signed-in staff device now (it mints
// cash walk-ins), not public.
const PUBLIC_PATH_PATTERNS = [
  /^\/$/,
  /^\/login$/,
  /^\/staff$/,
  /^\/auth\/callback$/,
  /^\/display\/[^/]+$/,
  /^\/t\/[^/]+$/,
];

// Staff-only device screens -- a signed-in patient must never land here.
const STAFF_ONLY_PATH_PATTERNS = [/^\/counter$/, /^\/kiosk$/];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isStaffOnlyPath(pathname: string): boolean {
  return STAFF_ONLY_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isPatientPath(pathname: string): boolean {
  return pathname === "/my" || pathname.startsWith("/my/");
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
    const loginUrl = new URL("/staff", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAdminPath(pathname) || isStaffOnlyPath(pathname) || isPatientPath(pathname)) {
    // `profile` is null whenever the read fails -- including the profiles
    // grant/RLS gap this app currently runs under, see get-role.ts. That
    // makes the role checks below effectively no-ops until the DB side
    // ships the grant: /admin already failed closed before this change
    // (unchanged behavior), and /counter + /kiosk have never had a role
    // check before now, so "can't confirm the role" continuing to let a
    // signed-in user through them is not a new hole -- it only starts
    // telling patients and staff apart once the read actually works, same
    // day admin gating starts working too. The profile-completeness check
    // below degrades the same way: no profile row readable means no gate,
    // not a lockout -- issue_token/book_appointment enforce it for real
    // server-side (0037_mandatory_profile.sql's require_complete_profile)
    // regardless of whether this redirect fires.
    const profile = await getMyProfile(supabase, userId);

    if (isAdminPath(pathname) && profile?.role !== "admin") {
      return NextResponse.redirect(new URL("/counter", request.url));
    }

    if (isStaffOnlyPath(pathname) && profile?.role === "patient") {
      return NextResponse.redirect(new URL("/my", request.url));
    }

    if (isPatientPath(pathname) && pathname !== "/my/profile" && profile && !profile.profileCompletedAt) {
      return NextResponse.redirect(new URL("/my/profile", request.url));
    }
  }

  return supabaseResponse;
}
