"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { loginSchema } from "@/lib/validation/auth"

export type LoginState = {
  error: string | null
  fieldErrors: Partial<Record<"email" | "password", string>>
}

// Only ever redirect to a same-origin relative path -- the `next` param
// comes from the URL, so treat it as untrusted and refuse anything that
// could send the browser off-site.
function safeNextPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    // Default to the staff area: proxy.ts sends non-admins on to /counter.
    return "/admin"
  }
  return value
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })

  if (!parsed.success) {
    const fieldErrors: LoginState["fieldErrors"] = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (key === "email" || key === "password") {
        fieldErrors[key] = issue.message
      }
    }
    return { error: "Fix the highlighted fields and try again.", fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    return { error: "Incorrect email or password.", fieldErrors: {} }
  }

  redirect(safeNextPath(formData.get("next")))
}
