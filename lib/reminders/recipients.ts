import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"

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
  podsjetnik_emails?: string[]
}

export type KontaktPrimalacRow = {
  klijent_id: string
  email: string | null
  podsjetnik_primalac: boolean
}

export type RecipientIndex = {
  adminEmails: string[]
  assignedByKlijent: Map<string, string[]>
  klijentEmailsByKlijent: Map<string, string[]>
}

/** Indeks primalaca: admini + dodijeljeni (interni) + firmine adrese (Krug 2, iz flagovanih kontakata). */
export function buildRecipientIndex(
  korisnici: KorisnikRow[],
  dodjele: { korisnik_id: string; klijent_id: string }[],
  klijenti: KlijentReminderRow[] = [],
  kontakti: KontaktPrimalacRow[] = [],
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
  // Krug 2: firmine adrese = mejlovi flagovanih kontakata, samo kad je globalni prekidač
  // uključen I firma per-firma uključena. firmaRecipientsForKlijent kasnije lowercase-uje/dedupira.
  const klijentEmailsByKlijent = new Map<string, string[]>()
  if (saljiKlijentima) {
    const firmaUkljucena = new Set<string>()
    for (const k of klijenti) {
      if (k.salji_podsjetnik_klijentu) firmaUkljucena.add(k.id)
    }
    for (const ko of kontakti) {
      if (!ko.podsjetnik_primalac || !firmaUkljucena.has(ko.klijent_id)) continue
      const email = (ko.email ?? "").trim()
      if (!EMAIL_RE.test(email)) continue
      const arr = klijentEmailsByKlijent.get(ko.klijent_id) ?? []
      arr.push(email)
      klijentEmailsByKlijent.set(ko.klijent_id, arr)
    }
    // Ad-hoc „čiste" adrese firme (nisu kontakti). firmaRecipientsForKlijent kasnije
    // lowercase-uje/dedupira, pa preklapanje s mejlom flagovanog kontakta nije problem.
    for (const k of klijenti) {
      if (!firmaUkljucena.has(k.id)) continue
      for (const raw of k.podsjetnik_emails ?? []) {
        const email = (raw ?? "").trim()
        if (!EMAIL_RE.test(email)) continue
        const arr = klijentEmailsByKlijent.get(k.id) ?? []
        arr.push(email)
        klijentEmailsByKlijent.set(k.id, arr)
      }
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

const DEFAULT_DANA = [60, 30, 15, 7]

/**
 * Jedan izvor istine za "ko prima šta": postavke + admini + dodjele + firmine adrese.
 * Zovu ga runReminders i runPostDue — kopiranje bi udvostručilo upite i otvorilo
 * mogućnost da dva puta u istom zahtjevu vide različit snapshot dodjela.
 *
 * saljiKlijentima dolazi iz postavke i MORA biti dio ovog čitanja: bez njega bi
 * buildRecipientIndex dobio false i firmin kanal bi tiho ostao ugašen.
 */
export async function loadRecipientIndex(
  supabase: SupabaseClient<Database>,
): Promise<{ index: RecipientIndex; base: string[]; danaPrije: number[] }> {
  const { data: post } = await supabase
    .from("postavke")
    .select("dana_prije, salji_klijentima")
    .eq("id", 1)
    .maybeSingle()
  const danaPrije = post?.dana_prije && post.dana_prije.length > 0 ? post.dana_prije : DEFAULT_DANA
  const saljiKlijentima = post?.salji_klijentima ?? false

  const base = parseEmailList(env.REMINDER_TO)
  const { data: korisnici, error: korErr } = await supabase
    .from("korisnici")
    .select("id, email, uloga, aktivan, prima_podsjetnike")
  if (korErr) throw new Error(`Greška pri čitanju primalaca (korisnici): ${korErr.message}`)
  // PostgREST implicitno limitira na ~1000 redova: sigurno na trenutnoj skali, ali ako dodjele narastu
  // dodaj eksplicitan .range()/count provjeru — tiha trunkacija bi inače ispustila nekog primaoca.
  const { data: dodjele, error: kkErr } = await supabase
    .from("korisnik_klijent")
    .select("korisnik_id, klijent_id")
  if (kkErr) throw new Error(`Greška pri čitanju dodjela (korisnik_klijent): ${kkErr.message}`)
  const { data: klijentiZaSlanje, error: klErr } = await supabase
    .from("klijenti")
    .select("id, salji_podsjetnik_klijentu, podsjetnik_emails")
  if (klErr) throw new Error(`Greška pri čitanju klijenata (Krug 2): ${klErr.message}`)
  const { data: kontaktiPrimaoci, error: kontErr } = await supabase
    .from("kontakt_osobe")
    .select("klijent_id, email, podsjetnik_primalac")
  if (kontErr) throw new Error(`Greška pri čitanju kontakata (Krug 2): ${kontErr.message}`)

  const index = buildRecipientIndex(
    korisnici ?? [],
    dodjele ?? [],
    klijentiZaSlanje ?? [],
    kontaktiPrimaoci ?? [],
    saljiKlijentima,
  )
  return { index, base, danaPrije }
}
