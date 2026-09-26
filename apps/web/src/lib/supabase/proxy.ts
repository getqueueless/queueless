import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { roleLandingPath } from "@/lib/auth/redirect";

import { getMyProfile } from "./get-role";

// Routes anyone can reach without a session: the landing page, the staff/
// patient login surface and its OAuth callback, the patient-status QR link,
// the TV display board. /kiosk is a signed-in staff device now (it mints
// cash walk-ins), not public. /pay/[id] is public for the same reason --
// mobile opens it in an in-app browser carrying the patient's access token
// in the URL fragment (never a cookie this middleware could see), so its own
// auth is handled client-side; gating it here would break that handoff
// before the page ever renders.
const PUBLIC_PATH_PATTERNS = [
  /^\/$/,
  /^\/login$/,
  /^\/staff$/,
  /^\/auth\/callback$/,
  /^\/display\/[^/]+$/,
  /^\/t\/[^/]+$/,
  /^\/pay\/[^/]+$/,
  /^\/faq$/,
];

// Staff's own device screens -- doctor and patient must never land here.
const STAFF_PATH_PATTERNS = [/^\/counter$/, /^\/kiosk$/];
// The doctor's own desk -- staff and patient must never land here either.
const DOCTOR_PATH_PATTERNS = [/^\/doctor$/];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isStaffPath(pathname: string): boolean {
  return STAFF_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isDoctorPath(pathname: string): boolean {
  return DOCTOR_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
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
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAdminPath(pathname) || isStaffPath(pathname) || isDoctorPath(pathname) || isPatientPath(pathname)) {
    // `profile` is null only if the read genuinely errors (network, no row).
    // The `profiles` table itself has no RLS and Postgres's default grants
    // to `anon`/`authenticated` were never revoked (docs/DECISIONS.md,
    // "Live RLS gap, narrowing but not closed"), so this read succeeds for
    // any signed-in caller -- verified live 2026-09-26, this is not the
    // stale "no grant, always null" state some older comments here assumed.
    // The profile-completeness check below still only ever gates a patient
    // (see the role check on it) -- issue_token/book_appointment enforce it
    // for real server-side either way (0037_mandatory_profile.sql's
    // require_complete_profile) regardless of whether this redirect fires.
    const profile = await getMyProfile(supabase, userId);

    // Each staff-facing area allow-lists its own roles (admin always
    // included) -- anyone else gets bounced to their own real landing page
    // via roleLandingPath, not a hardcoded target, so a patient hitting
    // /doctor lands on /my and a staff member hitting /doctor lands on
    // /counter, in one place rather than one redirect target per area.
    if (isAdminPath(pathname) && profile?.role !== "admin") {
      return NextResponse.redirect(new URL(roleLandingPath(profile), request.url));
    }

    if (isDoctorPath(pathname) && profile?.role !== "doctor" && profile?.role !== "admin") {
      return NextResponse.redirect(new URL(roleLandingPath(profile), request.url));
    }

    if (isStaffPath(pathname) && profile?.role !== "staff" && profile?.role !== "admin") {
      return NextResponse.redirect(new URL(roleLandingPath(profile), request.url));
    }

    // Only a patient is ever forced through the profile-completion form --
    // staff/admin/doctor have no reason to fill in a mobile number/DOB/
    // gender to do their job, and their own profiles may never have
    // profile_completed_at set at all.
    if (isPatientPath(pathname) && pathname !== "/my/profile" && profile?.role === "patient" && !profile.profileCompletedAt) {
      return NextResponse.redirect(new URL("/my/profile", request.url));
    }
  }

  return supabaseResponse;
}
