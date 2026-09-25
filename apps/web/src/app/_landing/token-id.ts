// The token id is a UUID. A patient has it as the link under the QR code on
// their slip (".../t/<id>"), so accept either the bare id or that whole link.
// Shape check only: /t/[id] re-validates the id and looks the token up itself.
const TOKEN_LINK =
  /^(?:\S*\/t\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(?:[?#]\S*)?$/i

export function extractTokenId(input: string): string | null {
  const match = input.trim().match(TOKEN_LINK)
  return match ? match[1].toLowerCase() : null
}
