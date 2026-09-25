"use server"

import { errorInfo } from "@queueless/db"
import { redirect } from "next/navigation"

import { safeNextPath } from "@/lib/auth/redirect"
import { createClient } from "@/lib/supabase/server"
import { profileSchema } from "@/lib/validation/auth"

export type ProfileState = {
  error: string | null
  fieldErrors: Partial<
    Record<"fullName" | "phone" | "dateOfBirth" | "gender" | "city" | "addressLine", string>
  >
}

export async function completeProfile(
  _prevState: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const parsed = profileSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    dateOfBirth: formData.get("dateOfBirth"),
    gender: formData.get("gender"),
    city: formData.get("city"),
    addressLine: formData.get("addressLine") ?? "",
  })

  if (!parsed.success) {
    const fieldErrors: ProfileState["fieldErrors"] = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key === "string") {
        fieldErrors[key as keyof ProfileState["fieldErrors"]] = issue.message
      }
    }
    return { error: "Fix the highlighted fields and try again.", fieldErrors }
  }

  const supabase = await createClient()
  const { fullName, phone, dateOfBirth, gender, city, addressLine } = parsed.data

  // complete_my_profile (0037_mandatory_profile.sql) is real and live --
  // this is the primary path, not a fallback stub.
  const { error } = await supabase.rpc("complete_my_profile", {
    p_full_name: fullName,
    p_phone: phone,
    p_date_of_birth: dateOfBirth,
    p_gender: gender,
    p_city: city,
    p_address_line: addressLine || null,
  })

  if (error) {
    // profile_incomplete never comes back from this call itself, but every
    // other code the RPC documents (invalid_profile, invalid_phone,
    // invalid_date_of_birth, phone_in_use) is mapped in @queueless/db.
    return { error: errorInfo(error.code || error.message).message, fieldErrors: {} }
  }

  redirect(safeNextPath(formData.get("next"), "/my"))
}
