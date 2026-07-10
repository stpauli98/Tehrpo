import { EMAIL_RE } from "@/lib/reminders/recipients"

export const norm = (s: string): string => s.trim().toLowerCase()

export type KontaktRed = { id: string; ime: string; funkcija: string | null; email: string | null }
export type KontaktOpcija = { id: string; ime: string; funkcija: string | null; email: string }

/** Kontakti firme koji imaju mejl i nisu već izabrani; filtrirani po query (ime/email). */
export function filtrirajKontakte(
  kontakti: KontaktRed[],
  query: string,
  izabraniIds: Set<string>,
): KontaktOpcija[] {
  const q = query.trim().toLowerCase()
  const out: KontaktOpcija[] = []
  for (const k of kontakti) {
    if (izabraniIds.has(k.id)) continue
    const email = (k.email ?? "").trim()
    if (!email) continue
    if (q !== "" && !k.ime.toLowerCase().includes(q) && !email.toLowerCase().includes(q)) continue
    out.push({ id: k.id, ime: k.ime, funkcija: k.funkcija, email })
  }
  return out
}

/** Da li ponuditi „dodaj kao jednokratni" za trenutni upit. */
export function mozeAdHoc(query: string, contactEmails: string[], adHocEmails: string[]): boolean {
  const e = norm(query)
  if (!EMAIL_RE.test(e)) return false
  if (contactEmails.some((c) => norm(c) === e)) return false
  if (adHocEmails.some((a) => norm(a) === e)) return false
  return true
}

/** Ad-hoc adrese za prikaz: iz podsjetnik_emails izuzmi one koje su već mejl flagovanog kontakta; dedup. */
export function adHocZaPrikaz(adHocEmails: string[], flaggedContactEmails: string[]): string[] {
  const flagged = new Set(flaggedContactEmails.map(norm))
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of adHocEmails) {
    const e = norm(raw)
    if (flagged.has(e) || seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out
}
