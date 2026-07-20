/**
 * Test DB helper — radi protiv CLOUD Supabase-a (bez lokalnog Dockera).
 * Čita NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY iz process.env,
 * a kao fallback parsira .env.local (aktivni, ne-zakomentarisani red).
 *
 * ⚠️ Mutacije idu na ISTU cloud bazu koju koristi app — vidi napomenu u README/planu.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { envVar } from "./env"
import { zahtijevajCilj } from "@/lib/supabase/refs"

const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL")

// Druga brana, uz tests/e2e/global-setup.ts: nijedan helper koji PIŠE ne smije se
// instancirati protiv produkcije. Guard je ovdje jer se ovaj modul uvozi iz specova
// i kad neko pokrene pojedinačni test zaobilazeći uobičajeni put.
zahtijevajCilj(SUPABASE_URL, "demo", "tests/e2e/db.ts")

export const db: SupabaseClient = createClient(
  SUPABASE_URL,
  envVar("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
)

/** Prvi termin (id) sa zadanim izvedenim statusom. */
export async function terminIdByStatus(status: string): Promise<string> {
  const { data } = await db
    .from("termini_view")
    .select("id")
    .eq("status_izvedeni", status)
    .limit(1)
  return (data?.[0]?.id as string) ?? ""
}

/** Prva aktivna vrsta provjere (id). */
export async function firstActiveVrstaId(): Promise<string> {
  const { data } = await db
    .from("vrste_provjera")
    .select("id")
    .eq("aktivna", true)
    .order("naziv")
    .limit(1)
  return (data?.[0]?.id as string) ?? ""
}

/** Postavi podrazumevani interval (mjeseci) na vrsti. */
export async function setVrstaInterval(vrstaId: string, mjeseci: number | null): Promise<void> {
  await db
    .from("vrste_provjera")
    .update({ podrazumevani_interval_mjeseci: mjeseci })
    .eq("id", vrstaId)
}

/** Prvi KASNI termin (id) za datu vrstu. Vraća "" ako ga nema. */
export async function kasniTerminForVrsta(vrstaId: string): Promise<string> {
  const { data } = await db
    .from("termini_view")
    .select("id")
    .eq("vrsta_provjere_id", vrstaId)
    .eq("status_izvedeni", "kasni")
    .limit(1)
  return (data?.[0]?.id as string) ?? ""
}

/** Obriši sve redove iz podsjetnici (zamjena za TRUNCATE; bez lokalnog psql-a). */
export async function clearPodsjetnici(): Promise<void> {
  await db.from("podsjetnici").delete().gte("dana_prije", 0)
}

/** Prvi klijent (id) po nazivu. */
export async function firstKlijentId(): Promise<string> {
  const { data } = await db.from("klijenti").select("id").order("naziv").limit(1)
  return (data?.[0]?.id as string) ?? ""
}

/** Ubaci planirani termin; vrati id. */
export async function insertTermin(input: {
  klijentId: string
  vrstaId: string
  rok: string
}): Promise<string> {
  const { data, error } = await db
    .from("termini")
    .insert({
      klijent_id: input.klijentId,
      vrsta_provjere_id: input.vrstaId,
      rok_dospijeca: input.rok,
      status: "planirano",
    })
    .select("id")
    .single()
  if (error) throw new Error(`insertTermin: ${error.message}`)
  return data.id as string
}

/** Zakaži termin direktno u bazi (status=zakazano + datum_zakazan). */
export async function zakaziTermin(id: string, datumZakazan: string): Promise<void> {
  const { error } = await db.from("termini").update({ status: "zakazano", datum_zakazan: datumZakazan }).eq("id", id)
  if (error) throw new Error(`zakaziTermin(${id}): ${error.message}`)
}

/** Obriši termin po id-u (čišćenje nakon testa). */
export async function deleteTermin(id: string): Promise<void> {
  if (id) await db.from("termini").delete().eq("id", id)
}

/** Obriši klijenta po nazivu (lokacije cascade; termini restrict — koristiti samo za throwaway klijente bez termina). */
export async function deleteKlijentByNaziv(naziv: string): Promise<void> {
  const { error } = await db.from("klijenti").delete().eq("naziv", naziv)
  if (error) throw new Error(`deleteKlijentByNaziv(${naziv}): ${error.message}`)
}

export async function insertKlijent(naziv: string): Promise<string> {
  // adresa/telefon/email su obavezni na formama (odluka 2026-07-03) — throwaway
  // klijent ih dobija odmah da edit forma (HTML required) može submitovati.
  const { data, error } = await db.from("klijenti").insert({
    naziv,
    adresa: "Testna ulica 1, Banja Luka",
    telefon: "+387 51 000 000",
    email: "e2e-klijent@example.com",
  }).select("id").single()
  if (error) throw new Error(`insertKlijent(${naziv}): ${error.message}`)
  return data.id as string
}

/** Ubaci kontakt osobu za klijenta; vrati id. */
export async function insertKontakt(klijentId: string, ime: string, email?: string): Promise<string> {
  const { data, error } = await db
    .from("kontakt_osobe")
    .insert({ klijent_id: klijentId, ime, email: email ?? null })
    .select("id")
    .single()
  if (error) throw new Error(`insertKontakt(${klijentId}, ${ime}): ${error.message}`)
  return data.id as string
}

/** Ubaci lokaciju za klijenta; vrati id. (Profil provjere zahtijevaju lokaciju.) */
export async function insertLokacija(klijentId: string, naziv = "E2E Lokacija"): Promise<string> {
  const { data, error } = await db.from("lokacije").insert({ klijent_id: klijentId, naziv }).select("id").single()
  if (error) throw new Error(`insertLokacija(${klijentId}): ${error.message}`)
  return data.id as string
}

/** Prva aktivna vrsta koja IMA podrazumijevani interval (profil forma je zaključana na njega). */
export async function firstVrstaSaIntervalom(): Promise<{ id: string; naziv: string; interval: number }> {
  const { data } = await db
    .from("vrste_provjera")
    .select("id, naziv, podrazumevani_interval_mjeseci")
    .eq("aktivna", true)
    .not("podrazumevani_interval_mjeseci", "is", null)
    .order("naziv")
    .limit(1)
  const row = data?.[0]
  if (!row) throw new Error("firstVrstaSaIntervalom: nema aktivne vrste s intervalom")
  return { id: row.id as string, naziv: row.naziv as string, interval: row.podrazumevani_interval_mjeseci as number }
}

export async function deleteTerminiByKlijent(klijentId: string): Promise<void> {
  const { error } = await db.from("termini").delete().eq("klijent_id", klijentId)
  if (error) throw new Error(`deleteTerminiByKlijent(${klijentId}): ${error.message}`)
}

export async function getVrstaInterval(vrstaId: string): Promise<number | null> {
  const { data } = await db
    .from("vrste_provjera")
    .select("podrazumevani_interval_mjeseci")
    .eq("id", vrstaId)
    .single()
  return (data?.podrazumevani_interval_mjeseci as number | null) ?? null
}

/** Da li je greška PROLAZNA mrežna (AuthRetryableFetchError i sl.) — vrijedi retry. */
function jeRetryableAuth(e: unknown): boolean {
  const poruka = `${(e as { name?: string })?.name ?? ""} ${(e as Error)?.message ?? ""}`
  return /AuthRetryableFetchError|FetchError|ETIMEDOUT|ECONNRESET|network|fetch failed/i.test(poruka)
}

/** Ponovi auth-admin poziv na prolaznu mrežnu grešku — E2E ide protiv živog
 *  Supabase auth API-ja pa povremeni mrežni blip nije bug. Wrapper (op) mora
 *  BACITI prolaznu grešku (bilo vraćenu u {error}, bilo bačenu) da retry radi. */
async function saAuthRetry<T>(op: () => Promise<T>): Promise<T> {
  let zadnja: unknown
  for (let i = 0; i < 4; i++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sekvencijalni retry s backoff-om
      return await op()
    } catch (e) {
      zadnja = e
      if (!jeRetryableAuth(e)) throw e
      // eslint-disable-next-line no-await-in-loop -- backoff pauza između pokušaja
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw zadnja
}

/** Nađi auth korisnika po emailu. NAPOMENA: listUsers je eventual-consistent —
 *  ne vraća uvijek korisnika kreiranog trenutak ranije (npr. u drugom projektu). */
async function nadjiAuthIdPoEmailu(email: string): Promise<string | undefined> {
  const { data } = await saAuthRetry(async () => {
    const r = await db.auth.admin.listUsers()
    if (r.error && jeRetryableAuth(r.error)) throw r.error
    return r
  })
  return data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id
}

/** Idempotentno nađi/kreiraj auth korisnika; vrati id. Otporno na cross-projekt
 *  race (chromium→webkit) gdje stale listUsers ne vrati upravo kreiranog korisnika
 *  pa createUser javi "already been registered" — u tom slučaju ponovo pronađi id. */
async function nadjiIliKreirajAuthId(email: string, lozinka: string): Promise<string> {
  const postojeci = await nadjiAuthIdPoEmailu(email)
  if (postojeci) return postojeci
  const { data, error } = await saAuthRetry(async () => {
    const r = await db.auth.admin.createUser({ email, password: lozinka, email_confirm: true })
    if (r.error && jeRetryableAuth(r.error)) throw r.error
    return r
  })
  if (!error) return data.user.id
  if (!/already.*registered/i.test(error.message)) throw error
  // Korisnik postoji ali ga stale listUsers nije vratio → kratki retry dok se ne pojavi.
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop -- namjeran sekvencijalni retry protiv eventual-consistency
    const id = await nadjiAuthIdPoEmailu(email)
    if (id) return id
    // eslint-disable-next-line no-await-in-loop -- pauza između pokušaja
    await new Promise((r) => setTimeout(r, 300))
  }
  throw error
}

/** Nađi/kreiraj operatera sa fiksnom lozinkom; vrati id. */
export async function ensureOperater(email: string, lozinka: string, ime: string): Promise<string> {
  const id = await nadjiIliKreirajAuthId(email, lozinka)
  const { error } = await db.from("korisnici").upsert({ id, ime, email, uloga: "operater", aktivan: true }, { onConflict: "id" })
  if (error) throw new Error(`ensureOperater upsert: ${error.message}`)
  return id
}

/** Nađi/kreiraj korisnika date uloge sa fiksnom lozinkom; vrati id. */
export async function ensureKorisnik(
  email: string,
  lozinka: string,
  ime: string,
  uloga: "admin" | "operater" | "pregled",
): Promise<string> {
  const id = await nadjiIliKreirajAuthId(email, lozinka)
  const { error } = await db.from("korisnici").upsert({ id, ime, email, uloga, aktivan: true }, { onConflict: "id" })
  if (error) throw new Error(`ensureKorisnik upsert: ${error.message}`)
  return id
}

/** Obriši auth korisnika + korisnici red po emailu (čišćenje throwaway naloga). */
export async function deleteKorisnikByEmail(email: string): Promise<void> {
  const { data: list } = await db.auth.admin.listUsers()
  const u = list?.users.find((x) => x.email?.toLowerCase() === email.toLowerCase())
  if (!u) return
  await db.from("korisnici").delete().eq("id", u.id)
  await db.auth.admin.deleteUser(u.id)
}

export async function assignKlijent(korisnikId: string, klijentId: string): Promise<void> {
  const { error } = await db.from("korisnik_klijent").upsert({ korisnik_id: korisnikId, klijent_id: klijentId })
  if (error) throw new Error(`assignKlijent(${korisnikId},${klijentId}): ${error.message}`)
}
export async function clearDodjele(korisnikId: string): Promise<void> {
  const { error } = await db.from("korisnik_klijent").delete().eq("korisnik_id", korisnikId)
  if (error) throw new Error(`clearDodjele(${korisnikId}): ${error.message}`)
}

// ─── Podsjetnici v2 — singleton postavke (id=1) ──────────────────────────────

export type PostavkeV2 = {
  vrijeme_slanja_sat: number
  salji_klijentima: boolean
  zadnje_slanje_datum: string | null
}

/** Pročitaj podsjetnici-v2 kolone iz singleton postavke (id=1) — za read-before-restore u e2e. */
export async function getPostavkeV2(): Promise<PostavkeV2> {
  const { data, error } = await db
    .from("postavke")
    .select("vrijeme_slanja_sat, salji_klijentima, zadnje_slanje_datum")
    .eq("id", 1)
    .maybeSingle()
  if (error) throw new Error(`getPostavkeV2: ${error.message}`)
  return {
    vrijeme_slanja_sat: (data?.vrijeme_slanja_sat as number | null) ?? 8,
    salji_klijentima: (data?.salji_klijentima as boolean | null) ?? false,
    zadnje_slanje_datum: (data?.zadnje_slanje_datum as string | null) ?? null,
  }
}

/** Piši proizvoljan patch na singleton postavke (id=1) — koristi se za setup/restore (nikad hardkodiraj: pročitaj pa vrati). */
export async function setPostavkeV2(patch: Partial<PostavkeV2>): Promise<void> {
  const { error } = await db.from("postavke").update(patch).eq("id", 1)
  if (error) throw new Error(`setPostavkeV2: ${JSON.stringify(patch)}: ${error.message}`)
}
