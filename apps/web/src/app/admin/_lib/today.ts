// This org runs on Asia/Kolkata; `new Date().toISOString().slice(0, 10)` is
// the UTC date, which is still yesterday until 05:30 IST. Every "today"
// picker on this console needs the org's local day, not the server's UTC
// one (same fix already used on the mobile app's dashboard for the same
// reason).
export function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
}

export function daysAgoIST(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
}
