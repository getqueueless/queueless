import { NextResponse } from "next/server"
import { createClient as createServiceRoleClient } from "@supabase/supabase-js"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

// Staff CRUD needs auth.admin.createUser(), which only works with the
// service-role key -- so this whole route runs server-side only (a Route
// Handler body never ships to the client bundle) and re-checks the caller is
// an admin itself, rather than trusting whatever the browser claims.
async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, status: 401, message: "Not signed in." }

  const { data: profile } = await supabase.from("profiles").select("org_id, role").eq("id", user.id).maybeSingle()
  if (!profile || profile.role !== "admin") {
    return { ok: false as const, status: 403, message: "Admins only." }
  }
  if (!profile.org_id) {
    return { ok: false as const, status: 409, message: "Your account isn't attached to an organization." }
  }
  return { ok: true as const, orgId: profile.org_id as string }
}

function serviceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  // service_role bypasses RLS -- this client instance never leaves this
  // module, and nothing it touches is echoed back to the caller.
  return createServiceRoleClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// Never echo a raw Postgres/config error to the browser -- log it here for
// the server operator and send the caller a generic message instead.
function serverError(action: string, detail: string) {
  console.error(`[api/admin/staff] ${action}:`, detail)
  return NextResponse.json({ error: `Couldn't ${action}. Try again.` }, { status: 500 })
}

const createSchema = z.object({
  email: z.email(),
  full_name: z.string().trim().min(1).max(80),
  role: z.enum(["staff", "admin"]),
  counter_id: z.uuid().optional(),
})

const updateSchema = z.object({
  id: z.uuid(),
  role: z.enum(["patient", "staff", "admin"]),
})

const deleteSchema = z.object({ id: z.uuid() })

export async function GET() {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.message }, { status: admin.status })

  const db = serviceRoleClient()
  if (!db) return serverError("load staff", "SUPABASE_SERVICE_ROLE_KEY is not set")

  const { data, error } = await db
    .from("profiles")
    .select("id, org_id, role, full_name, phone, created_at")
    .eq("org_id", admin.orgId)
    .in("role", ["staff", "admin"])
    .order("created_at")

  if (error) return serverError("load staff", error.message)
  return NextResponse.json({ staff: data })
}

export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.message }, { status: admin.status })

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })

  const db = serviceRoleClient()
  if (!db) return serverError("create staff account", "SUPABASE_SERVICE_ROLE_KEY is not set")

  const { email, full_name, role, counter_id } = parsed.data

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name },
  })
  if (createError || !created.user) {
    // createError.message here is Supabase Auth's own validation feedback
    // (e.g. "already registered") -- safe and useful to show, unlike a raw
    // Postgres/config error.
    return NextResponse.json({ error: createError?.message ?? "Couldn't create the user." }, { status: 400 })
  }

  // handle_new_user() (supabase/migrations/0002) already inserted a
  // 'patient' profile row for this id -- promote it to the requested role
  // and attach it to the admin's own org.
  const { error: updateError } = await db
    .from("profiles")
    .update({ role, org_id: admin.orgId, full_name })
    .eq("id", created.user.id)

  if (updateError) {
    return serverError("create staff account", updateError.message)
  }

  if (counter_id) {
    await db.from("counters").update({ staff_id: created.user.id }).eq("id", counter_id).eq("org_id", admin.orgId)
  }

  return NextResponse.json({ id: created.user.id }, { status: 201 })
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.message }, { status: admin.status })

  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })

  const db = serviceRoleClient()
  if (!db) return serverError("update role", "SUPABASE_SERVICE_ROLE_KEY is not set")

  const { id, role } = parsed.data

  // Scope the update to this admin's own org so one admin can't edit another
  // organization's staff by guessing an id.
  const { data: target } = await db.from("profiles").select("id").eq("id", id).eq("org_id", admin.orgId).maybeSingle()
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { error } = await db.from("profiles").update({ role }).eq("id", id)
  if (error) return serverError("update role", error.message)

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.message }, { status: admin.status })

  const { searchParams } = new URL(request.url)
  const parsed = deleteSchema.safeParse({ id: searchParams.get("id") })
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const db = serviceRoleClient()
  if (!db) return serverError("remove staff account", "SUPABASE_SERVICE_ROLE_KEY is not set")

  const { data: target } = await db.from("profiles").select("id").eq("id", parsed.data.id).eq("org_id", admin.orgId).maybeSingle()
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Demote rather than delete the auth user -- deleting auth.users cascades
  // to profiles (on delete cascade) and would also blow away any tokens
  // they issued as staff, which is destructive for an audit trail. Removing
  // admin/staff access is what "delete" means for this list.
  const { error } = await db.from("profiles").update({ role: "patient" }).eq("id", parsed.data.id)
  if (error) return serverError("remove staff account", error.message)

  return NextResponse.json({ ok: true })
}
