const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Interni primaoci podsjetnika (Krug 1): REMINDER_TO baza + admini. Klijent se NIKAD ne dodaje. */
export function assembleRecipients(args: { base: string[]; adminEmails: string[] }): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...args.base, ...args.adminEmails]) {
    const e = raw.trim()
    if (!EMAIL_RE.test(e)) continue
    const key = e.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export type KorisnikRow = {
  id: string
  email: string
  uloga: string
  aktivan: boolean
  prima_podsjetnike: boolean
}

export type RecipientIndex = { adminEmails: string[]; assignedByKlijent: Map<string, string[]> }

/** Indeks primalaca: admini (eligibilni) + mapa klijent_id → email-ovi dodijeljenih (eligibilnih). */
export function buildRecipientIndex(
  korisnici: KorisnikRow[],
  dodjele: { korisnik_id: string; klijent_id: string }[],
): RecipientIndex {
  const eligibleEmail = new Map<string, string>() // id → email (aktivan + prima_podsjetnike)
  const adminEmails: string[] = []
  for (const k of korisnici) {
    if (!k.aktivan || !k.prima_podsjetnike) continue
    eligibleEmail.set(k.id, k.email)
    if (k.uloga === "admin") adminEmails.push(k.email)
  }
  const assignedByKlijent = new Map<string, string[]>()
  for (const d of dodjele) {
    const email = eligibleEmail.get(d.korisnik_id)
    if (!email) continue
    const arr = assignedByKlijent.get(d.klijent_id) ?? []
    arr.push(email)
    assignedByKlijent.set(d.klijent_id, arr)
  }
  return { adminEmails, assignedByKlijent }
}

/** Primaoci za jednu firmu: dodijeljeni ∪ admini ∪ REMINDER_TO (dedupe/validacija preko assembleRecipients). */
export function recipientsForKlijent(index: RecipientIndex, klijentId: string, base: string[]): string[] {
  const assigned = index.assignedByKlijent.get(klijentId) ?? []
  const admins = index.adminEmails
  const allAssignedAndAdmins = new Set([...assigned, ...admins].map((e) => e.toLowerCase()))

  const seen = new Set<string>()
  const out: string[] = []

  // Add entries from base that are NOT in assigned/admins
  for (const email of base) {
    const e = email.trim()
    if (!EMAIL_RE.test(e)) continue
    const key = e.toLowerCase()
    if (seen.has(key)) continue
    if (allAssignedAndAdmins.has(key)) continue
    seen.add(key)
    out.push(key)
  }

  // Then add from assigned and admins (deduplicated)
  return assembleRecipients({ base: out, adminEmails: [...assigned, ...admins] })
}
