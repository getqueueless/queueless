import type { Metadata, Viewport } from "next"

import { DisplayBoard } from "./display-board"

export const metadata: Metadata = {
  title: "Queue Display — Queueless",
}

// The board is always slate-deep (it ignores the theme toggle), so the browser
// chrome and UA controls follow it rather than the site default.
export const viewport: Viewport = {
  themeColor: "#112427",
  colorScheme: "dark",
}

// Public, no login (see PUBLIC_PATH_PATTERNS in lib/supabase/proxy.ts, which already
// allow-lists /display/[service]). `service` is the services.id UUID -- whoever wires up
// the physical TV (an admin, who can read `services`) puts the real id in this URL/QR code;
// this page itself never reads `services` for anything load-bearing (see display-board.tsx).
export default async function DisplayPage({
  params,
}: {
  params: Promise<{ service: string }>
}) {
  const { service } = await params
  return <DisplayBoard serviceId={service} />
}
