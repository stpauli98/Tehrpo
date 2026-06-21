const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function assembleRecipients(args: {
  base: string[]
  klijentEmails: string[]
  lokacijaEmail: string | null
}): string[] {
  const all = [
    ...args.base,
    ...args.klijentEmails,
    ...(args.lokacijaEmail ? [args.lokacijaEmail] : []),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of all) {
    const e = raw.trim()
    if (!EMAIL_RE.test(e)) continue
    const key = e.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e.toLowerCase())
  }
  return out
}
