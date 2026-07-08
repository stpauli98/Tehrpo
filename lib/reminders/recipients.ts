export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

export type KlijentReminderRow = {
  id: string
  salji_podsjetnik_klijentu: boolean
  podsjetnik_emails: string[] | null
}

export type RecipientIndex = {
  adminEmails: string[]
  assignedByKlijent: Map<string, string[]>
  klijentEmailsByKlijent: Map<string, string[]>
}

/** Indeks primalaca: admini + dodijeljeni (interni) + firmine adrese (Krug 2, samo ako je uključeno). */
export function buildRecipientIndex(
  korisnici: KorisnikRow[],
  dodjele: { korisnik_id: string; klijent_id: string }[],
  klijenti: KlijentReminderRow[] = [],
  saljiKlijentima = false,
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
  // Krug 2: firmine adrese samo kad je globalni prekidač uključen I firma per-firma uključena.
  const klijentEmailsByKlijent = new Map<string, string[]>()
  if (saljiKlijentima) {
    for (const k of klijenti) {
      if (!k.salji_podsjetnik_klijentu) continue
      const emails = (k.podsjetnik_emails ?? []).filter((e) => EMAIL_RE.test(e.trim()))
      if (emails.length > 0) klijentEmailsByKlijent.set(k.id, emails)
    }
  }
  return { adminEmails, assignedByKlijent, klijentEmailsByKlijent }
}

/** Interni primaoci za jednu firmu: dodijeljeni ∪ admini ∪ REMINDER_TO base. BEZ firminih adresa. */
export function recipientsForKlijent(index: RecipientIndex, klijentId: string, base: string[]): string[] {
  const assigned = index.assignedByKlijent.get(klijentId) ?? []
  return assembleRecipients({ base, adminEmails: [...assigned, ...index.adminEmails] })
}

/** Firmine (Krug 2) adrese za jednu firmu — prazno ako global/per-firma isključen ili nema adresa. */
export function firmaRecipientsForKlijent(index: RecipientIndex, klijentId: string): string[] {
  const firma = index.klijentEmailsByKlijent.get(klijentId) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of firma) {
    const e = raw.trim().toLowerCase()
    if (!EMAIL_RE.test(e) || seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out
}
