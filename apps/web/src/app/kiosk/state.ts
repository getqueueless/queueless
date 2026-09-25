import type { IssueTokenState } from "./actions"

// Not in actions.ts: a "use server" module may only export async functions,
// and exporting this object there made every kiosk submit a 500.
export const initialIssueTokenState: IssueTokenState = { error: null }
