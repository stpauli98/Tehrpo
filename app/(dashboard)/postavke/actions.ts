'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
// integracija-dozvoli: admin-klijent — Supabase Auth Admin API nema anon ekvivalent
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { zahtijevajAdmina } from "@/lib/auth/zahtijevaj-admina"
import { validirajNovuLozinku } from "@/lib/auth/lozinka"
import { revalidateVrste } from "@/lib/cache"
import { posaljiIzabiljezi } from "@/lib/email/posaljiIzabiljezi"
import { testEmailSubject, testEmailHtml } from "@/lib/email/templates"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import { env } from "@/lib/env"
import { satIzTermina } from "@/lib/reminders/rasporedSlanja"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "postavke.actions" })
// Dedikovan translator za poruke greške vezane za "Moj nalog" (promjena lozinke) —
// ključevi žive pod postavke.mojNalog.greske.*, odvojeno od postavke.actions.
const tMoj = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "postavke.mojNalog" })

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

// Rezultat slanja testnog emaila — UI razlikuje stvarno slanje od dry-run-a
// (kad RESEND_API_KEY nije postavljen) i upozorava ako korisnik ne prima podsjetnike.
export type TestEmailResult =
  | { ok: true; dryRun: boolean; email: string; primaPodsjetnike: boolean }
  | { ok: false; message: string }

const schema = z.object({
  // "30, 14, 7, 1" → niz brojeva
  dana_prije: z
    .string()
    .min(1, t("pragObavezan"))
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
        .map((x) => Number(x)),
    )
    .refine((arr) => arr.length > 0 && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 365), {
      message: t("pragoviNeispravni"),
    }),
})

export async function updatePostavke(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  // dedupe + sort opadajuće (30,14,7,1)
  const dana = Array.from(new Set(parsed.data.dana_prije)).sort((a, b) => b - a)
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("postavke")
    .update({ dana_prije: dana, updated_at: new Date().toISOString() })
    .eq("id", 1)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Intervali po vrsti (podrazumevani_interval_mjeseci) ─────────────────────

// Koristi ga postaviVrstaInterval (inline autosave u tabeli Vrste pregleda).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// C1: uklanjanje periodike sa vrste TIHO ubija lance obaveza.
//
// tg_termini_auto_cycle sljedeći ciklus računa iz
// coalesce(termini.interval_mjeseci, vrste_provjera.podrazumevani_interval_mjeseci).
// Otvoreni ponavljajući termin koji nema VLASTITI interval visi, dakle, o intervalu vrste:
// čim se on obriše, zatvaranje tog termina prolazi bez sljedećeg ciklusa — zakonska obaveza
// nestane iz plana. Baza to od sada bilježi (prekinuti_lanci) i javlja u zdravlje_sistema(),
// ali ovdje se sprječava da uopšte nastane.
//
// Zašto SPRJEČAVANJE, a ne samo upozorenje: rezultat akcije koji UI prikazuje je ili uspjeh
// ili poruka greške (lib/akcija-toast.ts) — „uspjeh sa upozorenjem" se ne bi vidio nigdje, a
// upozorenje koje niko ne pročita je isto što i tišina. Sistem uz to VEĆ odbija da napravi
// ponavljajući termin nad vrstom bez intervala (app/(dashboard)/termini/actions.ts i
// klijenti/actions.ts); ovo je isto pravilo, samo na drugom kraju — inače invarijanta vrijedi
// pri unosu, a ruši se naknadnim brisanjem.
//
// Izlaz iz situacije postoji i bez ove akcije: termini se mogu otkazati/zatvoriti, ili im se
// isključi ponavljanje — tek onda periodika vrste više nikome ne treba.
type SupabaseKlijent = Awaited<ReturnType<typeof createServerSupabaseClient>>

async function periodikaSeSmijeUkloniti(
  supabase: SupabaseKlijent,
  vrstaId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { count, error } = await supabase
    .from("termini")
    .select("id", { count: "exact", head: true })
    .eq("vrsta_provjere_id", vrstaId)
    .eq("ponavlja_se", true)
    .is("interval_mjeseci", null)
    .is("datum_izvrsenja", null)
    .in("status", ["planirano", "zakazano"])

  // Neprovjereno ≠ bezopasno: ako provjera ne uspije, radnja se ne pušta. Uklanjanje
  // periodike nije hitno i ponovni pokušaj ništa ne košta; tiho ubijen lanac košta rok.
  if (error) return { ok: false, message: t("periodikaProvjeraNijeUspjela") }
  if ((count ?? 0) > 0) return { ok: false, message: t("periodikaUklanjanjeBlokirano", { broj: count ?? 0 }) }
  return { ok: true }
}

// ─── Nova vrsta pregleda ─────────────────────────────────────────────────────

const createVrstaSchema = z.object({
  naziv: z.string().trim().min(1, t("nazivObavezan")).max(200),
  // prazno = bez auto-zakazivanja (NULL); inače cijeli broj 1–120
  interval: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine(
      (s) => s === undefined || (Number.isInteger(Number(s)) && Number(s) >= 1 && Number(s) <= 120),
      { message: t("intervalNeispravan") },
    )
    .transform((s) => (s === undefined ? null : Number(s))),
  zakonski_osnov: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
})

export async function createVrsta(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const parsed = createVrstaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("vrste_provjera").insert({
    naziv: parsed.data.naziv,
    podrazumevani_interval_mjeseci: parsed.data.interval,
    zakonski_osnov: parsed.data.zakonski_osnov ?? null,
    aktivna: true,
  })
  if (error) {
    const msg = /duplicate|unique/i.test(error.message)
      ? t("vrstaPregledaNazivPostoji")
      : error.message
    return { ok: false, message: msg }
  }
  revalidateVrste()
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Admin: upravljanje korisnicima ──────────────────────────────────────────

// Vrati broj aktivnih administratora (za zaštitu od zaključavanja sistema).
// Prima SSR (RLS) klijent — admin kroz korisnici_sel (je_admin()) vidi sve korisnike.
async function brojAktivnihAdmina(sb: Awaited<ReturnType<typeof createServerSupabaseClient>>): Promise<number> {
  const { count } = await sb
    .from("korisnici")
    .select("id", { count: "exact", head: true })
    .eq("uloga", "admin")
    .eq("aktivan", true)
  return count ?? 0
}

const noviKorisnikSchema = z.object({
  ime: z.string().trim().min(1, t("imeObavezno")).max(120),
  email: z.string().email(t("emailNeispravan")),
  lozinka: z.string().min(8, t("lozinkaMin")),
  uloga: z.enum(["admin", "operater", "pregled"]),
})

export async function kreirajKorisnika(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await zahtijevajAdmina()
  const parsed = noviKorisnikSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  // integracija-dozvoli: admin-klijent — Supabase Auth Admin API nema anon ekvivalent
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email, password: parsed.data.lozinka, email_confirm: true,
  })
  if (error || !data.user) {
    return { ok: false, message: /already|registered|exists/i.test(error?.message ?? "")
      ? t("korisnikEmailPostoji") : (error?.message ?? t("greskaFallback")) }
  }
  // Profil upisuje SSR (RLS) klijent da audit trigger zabilježi ADMINA koji kreira nalog.
  // (service-role → auth.uid()=NULL → audit bez aktera.) Auth korisnik gore mora ostati service-role.
  const supabase = await createServerSupabaseClient()
  const { error: pErr } = await supabase.from("korisnici").insert({
    id: data.user.id, ime: parsed.data.ime, email: parsed.data.email, uloga: parsed.data.uloga, aktivan: true,
  })
  if (pErr) {
    // Rollback: ukloni auth korisnika kako ne bi zauzimao email
    const { error: delErr } = await admin.auth.admin.deleteUser(data.user.id)
    if (delErr) console.error("Rollback orphan auth korisnika nije uspio:", data.user.id, delErr.message)
    return { ok: false, message: pErr.message }
  }
  revalidatePath("/postavke")
  return { ok: true }
}

export async function postaviUlogu(korisnikId: string, uloga: "admin"|"operater"|"pregled"): Promise<ActionResult> {
  const ja = await zahtijevajAdmina()
  if (korisnikId === ja.id && uloga !== "admin") {
    return { ok: false, message: t("sebiOduzetiUlogu") }
  }
  // SSR (RLS) klijent: korisnici_wr = je_admin() prolazi za admina, a auth.uid() je postavljen
  // pa audit trigger zabilježi aktera (service-role bi upisao korisnik_id=NULL).
  const supabase = await createServerSupabaseClient()
  // Zaštita: ne dozvoli da skidanjem admin uloge ostane bez ijednog aktivnog admina.
  if (uloga !== "admin") {
    const { data: cilj } = await supabase.from("korisnici").select("uloga, aktivan").eq("id", korisnikId).maybeSingle()
    if (cilj?.uloga === "admin" && cilj.aktivan && (await brojAktivnihAdmina(supabase)) <= 1) {
      return { ok: false, message: t("barJedanAdmin") }
    }
  }
  const { error } = await supabase.from("korisnici").update({ uloga }).eq("id", korisnikId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

export async function postaviAktivan(korisnikId: string, aktivan: boolean): Promise<ActionResult> {
  const ja = await zahtijevajAdmina()
  if (!aktivan && korisnikId === ja.id) {
    return { ok: false, message: t("deaktivirajVlastitiNalog") }
  }
  const supabase = await createServerSupabaseClient()
  // Zaštita: ne dozvoli deaktivaciju zadnjeg aktivnog administratora.
  if (!aktivan) {
    const { data: cilj } = await supabase.from("korisnici").select("uloga").eq("id", korisnikId).maybeSingle()
    if (cilj?.uloga === "admin" && (await brojAktivnihAdmina(supabase)) <= 1) {
      return { ok: false, message: t("barJedanAdmin") }
    }
  }
  const { error } = await supabase.from("korisnici").update({ aktivan }).eq("id", korisnikId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

// Pošalji testni email korisniku da se provjeri stiže li dostava na njegovu adresu.
export async function posaljiTestniEmail(korisnikId: string): Promise<TestEmailResult> {
  await zahtijevajAdmina()
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("korisnici")
    .select("ime, email, prima_podsjetnike")
    .eq("id", korisnikId)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  if (!data?.email) return { ok: false, message: t("korisnikNemaEmail") }

  try {
    const res = await posaljiIzabiljezi(supabase, {
      to: [data.email],
      subject: testEmailSubject(),
      html: testEmailHtml({ ime: data.ime }),
      tip: "test",
    })
    return { ok: true, dryRun: res.dryRun, email: data.email, primaPodsjetnike: data.prima_podsjetnike }
  } catch (e) {
    const raw = e instanceof Error ? e.message : t("greskaSlanjaEmailaFallback")
    return { ok: false, message: objasniEmailGresku(raw) }
  }
}

// Prevod čestih Resend grešaka u jasnu poruku na domaćem jeziku.
function objasniEmailGresku(msg: string): string {
  if (/only send testing emails|verify a domain|resend\.com\/domains/i.test(msg)) {
    return t("resendTestniRezim")
  }
  return msg
}

export async function postaviPrimaPodsjetnike(korisnikId: string, prima: boolean): Promise<ActionResult> {
  await zahtijevajAdmina()
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("korisnici").update({ prima_podsjetnike: prima }).eq("id", korisnikId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

/** Postavi tačan skup dodijeljenih klijenata za korisnika (zamijeni postojeće). */
export async function postaviDodjele(korisnikId: string, klijentIds: string[]): Promise<ActionResult> {
  await zahtijevajAdmina()
  // SSR (RLS) klijent: kk_wr = je_admin() prolazi za admina; auth.uid() postavljen → audit hvata aktera
  // za svaki delete/insert dodjele (service-role bi upisao korisnik_id=NULL).
  const supabase = await createServerSupabaseClient()
  // Provjeri da svi klijent ID-jevi postoje prije brisanja (atomičnost)
  if (klijentIds.length > 0) {
    const { data: valid, error: chkErr } = await supabase.from("klijenti").select("id").in("id", klijentIds)
    if (chkErr) return { ok: false, message: chkErr.message }
    if (!valid || valid.length !== klijentIds.length) {
      return { ok: false, message: t("klijentNepostojeciUDodjeli") }
    }
  }
  const { error: delErr } = await supabase.from("korisnik_klijent").delete().eq("korisnik_id", korisnikId)
  if (delErr) return { ok: false, message: delErr.message }
  if (klijentIds.length > 0) {
    const rows = klijentIds.map((klijent_id) => ({ korisnik_id: korisnikId, klijent_id }))
    const { error: insErr } = await supabase.from("korisnik_klijent").insert(rows)
    if (insErr) return { ok: false, message: insErr.message }
  }
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Uređivanje / deaktivacija vrste ─────────────────────────────────────────

const updateVrstaSchema = z.object({
  id: z.string().uuid(),
  naziv: z.string().trim().min(1, t("nazivObavezan")).max(200),
  interval: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine(
      (s) => s === undefined || (Number.isInteger(Number(s)) && Number(s) >= 1 && Number(s) <= 120),
      { message: t("intervalNeispravanKratko") },
    )
    .transform((s) => (s === undefined ? null : Number(s))),
  zakonski_osnov: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  vodi_dokumentaciju: z.string().optional().transform((v) => v === "on" || v === "true"),
})

export async function updateVrsta(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await zahtijevajAdmina()
  const parsed = updateVrstaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, naziv, interval, zakonski_osnov, vodi_dokumentaciju } = parsed.data
  const supabase = await createServerSupabaseClient()

  // C1: periodika se smije UKLONITI samo ako od nje ne visi nijedan otvoren lanac.
  // Provjerava se prije upisa — ostatak izmjene (naziv, osnov, dokumentacija) se ne smije
  // primijeniti napola.
  if (interval === null) {
    const { data: trenutna } = await supabase
      .from("vrste_provjera").select("podrazumevani_interval_mjeseci").eq("id", id).maybeSingle()
    if (trenutna?.podrazumevani_interval_mjeseci != null) {
      const provjera = await periodikaSeSmijeUkloniti(supabase, id)
      if (!provjera.ok) return { ok: false, message: provjera.message }
    }
  }

  const { error } = await supabase.from("vrste_provjera").update({
    naziv,
    podrazumevani_interval_mjeseci: interval,
    zakonski_osnov: zakonski_osnov ?? null,
    vodi_dokumentaciju,
  }).eq("id", id)
  if (error) {
    const msg = /duplicate|unique/i.test(error.message) ? t("vrstaNazivPostoji") : error.message
    return { ok: false, message: msg }
  }
  revalidateVrste()
  revalidatePath("/postavke")
  return { ok: true }
}

export async function postaviVrstaAktivna(vrstaId: string, aktivna: boolean): Promise<ActionResult> {
  await zahtijevajAdmina()
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("vrste_provjera").update({ aktivna }).eq("id", vrstaId)
  if (error) return { ok: false, message: error.message }
  revalidateVrste()
  revalidatePath("/postavke")
  return { ok: true }
}

// Snimanje intervala za JEDNU vrstu (inline autosave u tabeli Vrste pregleda).
// interval = null → bez auto-zakazivanja; inače cijeli broj 1–120.
export async function postaviVrstaInterval(vrstaId: string, interval: number | null): Promise<ActionResult> {
  await zahtijevajAdmina()
  if (!UUID_RE.test(vrstaId)) return { ok: false, message: t("vrstaIdNeispravan") }
  if (interval !== null && (!Number.isInteger(interval) || interval < 1 || interval > 120)) {
    return { ok: false, message: t("intervalNeispravanTacka") }
  }
  const supabase = await createServerSupabaseClient()

  // C1: brisanje intervala (polje se isprazni pa se izgubi fokus) je do sada prolazilo bez
  // ijedne provjere, iako je to jedini korak koji otvorenim ponavljajućim terminima te vrste
  // oduzima periodiku.
  if (interval === null) {
    const { data: trenutna } = await supabase
      .from("vrste_provjera").select("podrazumevani_interval_mjeseci").eq("id", vrstaId).maybeSingle()
    if (trenutna?.podrazumevani_interval_mjeseci != null) {
      const provjera = await periodikaSeSmijeUkloniti(supabase, vrstaId)
      if (!provjera.ok) return { ok: false, message: provjera.message }
    }
  }

  const { error } = await supabase
    .from("vrste_provjera")
    .update({ podrazumevani_interval_mjeseci: interval })
    .eq("id", vrstaId)
  if (error) return { ok: false, message: error.message }
  revalidateVrste()
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Uključivanje/isključivanje automatskih podsjetnika ─────────────────────

export async function updatePodsjetniciAktivni(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const aktivni = formData.get("aktivni") === "on"
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("postavke")
    .update({ podsjetnici_aktivni: aktivni })
    .eq("id", 1)
  if (error) return { ok: false, message: t("podsjetniciToggleGreska") }
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Vrijeme slanja (lokalni sat Europe/Belgrade) ───────────────────────────

export async function updateVrijemeSlanja(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const raw = String(formData.get("vrijeme_slanja_sat") ?? "")
  // Forma šalje termin, ne sat: dopuštene su tačno dvije vrijednosti, pa nedostižan
  // sat ne može ni nastati kroz UI. `check` u bazi pokriva direktan upis.
  if (raw !== "ujutro" && raw !== "poslijepodne") {
    return { ok: false, message: t("vrijemeSatNeispravan") }
  }
  const sat = satIzTermina(raw)
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("postavke").update({ vrijeme_slanja_sat: sat }).eq("id", 1)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Globalni Krug-2 prekidač: slanje podsjetnika i firmama ──────────────────

export async function updateSaljiKlijentima(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const salji = formData.get("salji") === "on"
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("postavke").update({ salji_klijentima: salji }).eq("id", 1)
  if (error) return { ok: false, message: t("saljiKlijentimaGreska") }
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Prekidač: automatska "zakazano poslije roka" obavijest ──────────────────
// Zaseban od podsjetnici_aktivni: gasi mejl koji se šalje internim primaocima kad
// se termin zakaže na datum poslije roka (termini/actions.ts). Efektivni gejt je u
// DEFINER RPC-u zabiljezi_zakazano_obavijest — ovaj toggle samo postavlja kolonu.

export async function updateZakazanoObavijest(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const aktivna = formData.get("aktivna") === "on"
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("postavke")
    .update({ zakazano_obavijest_aktivna: aktivna })
    .eq("id", 1)
  if (error) return { ok: false, message: t("zakazanoObavijestGreska") }
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Ručno pokretanje podsjetnika (poziva cron rutu preko HTTP-a) ───────────

export type PokreniRezultat =
  | { ok: true; poslano: number; preskoceno: number; odgodjeno: number; greske: number }
  | { ok: false; message: string }

export async function pokreniPodsjetnikeSada(): Promise<PokreniRezultat> {
  // Ista provjera uloge kao zahtijevajAdmina, ali vraćamo poruku umjesto bacanja
  // greške — dugme "Pokreni sada" nije forma pa nema _prev/formData obrazac.
  const korisnik = await getTrenutniKorisnik()
  if (!korisnik || korisnik.uloga !== "admin") return { ok: false, message: t("samoAdmin") }
  if (!env.CRON_SECRET) return { ok: false, message: t("pokreniNijeKonfigurisan") }
  // Origin: prioritet ima konfigurisani NEXT_PUBLIC_APP_URL; headers su fallback
  // (host header dolazi iz requesta — konfigurisan URL je čvršći izvor istine).
  let origin = env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "")
  if (!origin) {
    const h = await headers()
    const proto = h.get("x-forwarded-proto") ?? "https"
    const host = h.get("host")
    if (!host) return { ok: false, message: t("pokreniGreska") }
    origin = `${proto}://${host}`
  }
  const res = await fetch(`${origin}/api/cron/reminders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CRON_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: false }),
    cache: "no-store",
  })
  if (!res.ok) return { ok: false, message: t("pokreniGreska") }
  // Ruta vraća { preDue, postDue } (ne korijenske sent/skipped/errors) — oba kruga se
  // moraju uračunati u prikazane brojače. postDue nema `deferred` (samo pre-due kapira
  // broj obrada po run-u), pa je odgođeno isključivo iz preDue.
  type StranaRezultat = { sent?: unknown[]; skipped?: unknown[]; errors?: unknown[]; deferred?: number }
  let data: { preDue?: StranaRezultat; postDue?: StranaRezultat }
  try {
    data = (await res.json()) as { preDue?: StranaRezultat; postDue?: StranaRezultat }
  } catch {
    return { ok: false, message: t("pokreniGreska") }
  }
  const preDue = data.preDue
  const postDue = data.postDue
  return {
    ok: true,
    poslano: (preDue?.sent?.length ?? 0) + (postDue?.sent?.length ?? 0),
    preskoceno: (preDue?.skipped?.length ?? 0) + (postDue?.skipped?.length ?? 0),
    odgodjeno: preDue?.deferred ?? 0,
    greske: (preDue?.errors?.length ?? 0) + (postDue?.errors?.length ?? 0),
  }
}

// ─── Lozinka: samostalna promjena + admin reset ──────────────────────────────

/** Prijavljeni korisnik mijenja svoju lozinku (traži trenutnu radi re-autentifikacije). */
export async function promijeniLozinku(trenutna: string, nova: string, potvrda: string): Promise<ActionResult> {
  const v = validirajNovuLozinku(nova, potvrda)
  if (!v.ok) {
    return { ok: false, message: v.razlog === "min" ? tMoj("greske.minDuzina") : tMoj("greske.nePoklapaju") }
  }
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, message: tMoj("greske.opsta") }
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: trenutna })
  if (authErr) return { ok: false, message: tMoj("greske.trenutnaPogresna") }
  const { error } = await supabase.auth.updateUser({ password: nova })
  if (error) return { ok: false, message: tMoj("greske.opsta") }
  return { ok: true }
}

// ─── Prekidači dozvola po korisniku (brisanje, zatvaranje bez nalaza) ────────

const DOZVOLE_KLJUCEVI = [
  "smije_brisati_svoje",
  "smije_brisati_tudje",
  "smije_brisati_klijente",
  "smije_zatvoriti_bez_nalaza",
] as const

/**
 * Prekidači dozvola po korisniku (potvrđeno 30.07.2026.). Ima smisla samo za operatera —
 * admin ionako smije sve, pregled ništa (vidi efektivneDozvole / SQL helpere).
 * SSR (RLS) klijent: korisnici_wr = je_admin(), a auth.uid() je postavljen pa audit
 * trigger zabilježi aktera.
 */
export async function postaviDozvolu(
  korisnikId: string,
  kljuc: (typeof DOZVOLE_KLJUCEVI)[number],
  vrijednost: boolean,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  if (!DOZVOLE_KLJUCEVI.includes(kljuc)) return { ok: false, message: t("nepoznataDozvola") }
  const supabase = await createServerSupabaseClient()
  // Prekidači važe samo za operatera (admin ima sve, pregled ništa — ni jedno ne čita
  // kolone). Upis na admin/pregled red je danas bezopasan, ali vrijednost preživi kasniju
  // promjenu uloge u operatera i tiho proradi, pa se odbija odmah.
  const { data: meta } = await supabase
    .from("korisnici")
    .select("uloga")
    .eq("id", korisnikId)
    .maybeSingle()
  if (!meta) return { ok: false, message: t("korisnikNePostoji") }
  if (meta.uloga !== "operater") return { ok: false, message: t("dozvoleSamoOperater") }
  // Eksplicitno tipizovan patch: computed-key literal direktno u .update({ [kljuc]: ... })
  // gubi vezu sa uskim tipom kolone pa ga Supabase generisani Update tip odbija.
  const patch: Partial<Record<(typeof DOZVOLE_KLJUCEVI)[number], boolean>> = { [kljuc]: vrijednost }
  const { error } = await supabase.from("korisnici").update(patch).eq("id", korisnikId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

/** Admin okine reset-email za korisnika (ne postavlja/ne vidi lozinku). */
export async function posaljiResetKorisniku(email: string): Promise<ActionResult> {
  await zahtijevajAdmina()
  const origin = (await headers()).get("origin") ?? ""
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/confirm` })
  if (error) {
    console.error("[posaljiResetKorisniku]", error.message)
    // Supabase auth poruke nisu prevedene (ni stabilne) — nikad se ne prosljeđuju sirove.
    // Rate limit je jedini slučaj koji korisnik može sam riješiti (sačekati), pa ima
    // vlastitu poruku; sve ostalo dobija generičku.
    return {
      ok: false,
      message: /rate limit/i.test(error.message) ? t("resetRateLimit") : t("resetEmailGreska"),
    }
  }
  return { ok: true }
}
