import type { OtpRequestState, OtpVerifyState, PasswordState } from "./actions"

// Not in actions.ts: a "use server" module may only export async functions.
export const initialPasswordState: PasswordState = { error: null, fieldErrors: {} }
export const initialOtpRequestState: OtpRequestState = { error: null, sentTo: null }
export const initialOtpVerifyState: OtpVerifyState = { error: null, fieldErrors: {} }
