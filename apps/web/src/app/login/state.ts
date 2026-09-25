import type {
  NewPasswordState,
  OtpRequestState,
  OtpVerifyState,
  PasswordResetVerifyState,
  PasswordState,
  SignUpState,
} from "./actions"

// Not in actions.ts: a "use server" module may only export async functions.
export const initialPasswordState: PasswordState = { error: null, fieldErrors: {} }
export const initialOtpRequestState: OtpRequestState = { error: null, sentTo: null }
export const initialOtpVerifyState: OtpVerifyState = { error: null, fieldErrors: {} }
export const initialSignUpState: SignUpState = { error: null, fieldErrors: {}, sentTo: null }
export const initialNewPasswordState: NewPasswordState = { error: null, fieldErrors: {} }
export const initialPasswordResetVerifyState: PasswordResetVerifyState = { error: null, fieldErrors: {}, verified: false }
