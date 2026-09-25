import { toString as qrToString } from "qrcode"

// SVG only, rendered server-side and inlined -- no third-party QR image API,
// no external request on a live demo's critical path, no token URL leaked
// off-platform.
export function tokenQrSvg(url: string): Promise<string> {
  return qrToString(url, { type: "svg", margin: 1, width: 240 })
}
