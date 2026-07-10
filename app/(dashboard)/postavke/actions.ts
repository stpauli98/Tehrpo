'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { validirajNovuLozinku } from "@/lib/auth/lozinka"
import { revalidateVrste } from "@/lib/cache"
import { sendEmail } from "@/lib/email/resend"
import { testEmailSubject, testEmailHtml } from "@/lib/email/templates"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import { env } from "@/lib/env"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "postavke.actions" })
// Dedikovan translator za poruke greške vezane za "Moj nalog" (promjena lozinke) —
// ključevi žive pod postavke.mojNalog.greske.*, odvojeno od postavke.actions.
const tMoj = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "postavke.mojNalog" })

export type ActionResult =
  | { ok: true; danaPrije?: number[] }
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
  return { ok: true, danaPrije: dana }
}

// ─── Intervali po vrsti (podrazumevani_interval_mjeseci) ─────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function updateIntervali(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  // Forma šalje polja "interval_<vrsta_uuid>" = "" | "1".."120"
  const updates: { id: string; val: number | null }[] = []
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("interval_")) continue
    const id = key.slice("interval_".length)
    if (!UUID_RE.test(id)) continue
    const s = String(raw).trim()
    if (s === "") {
      updates.push({ id, val: null })
      continue
    }
    const n = Number(s)
    if (!Number.isInteger(n) || n < 1 || n > 120) {
      return { ok: false, message: t("intervalGreskaVrijednost", { vrijednost: s }) }
    }
    updates.push({ id, val: n })
  }
  if (updates.length === 0) return { ok: true }

  const supabase = await createServerSupabaseClient()
  // Bez await-in-loop: svi update-ovi konkurentno
  const results = await Promise.all(
    updates.map((u) =>
      supabase.from("vrste_provjera").update({ podrazumevani_interval_mjeseci: u.val }).eq("id", u.id),
    ),
  )
  const errored = results.find((r) => r.error)
  if (errored?.error) return { ok: false, message: errored.error.message }
  revalidateVrste()
  revalidatePath("/postavke")
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

export async function zahtijevajAdmina() {
  const k = await getTrenutniKorisnik()
  if (!k || k.uloga !== "admin") throw new Error(t("samoAdministrator"))
  return k
}

// Vrati broj aktivnih administratora (za zaštitu od zaključavanja sistema).
async function brojAktivnihAdmina(admin: ReturnType<typeof createAdminSupabaseClient>): Promise<number> {
  const { count } = await admin
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
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email, password: parsed.data.lozinka, email_confirm: true,
  })
  if (error || !data.user) {
    return { ok: false, message: /already|registered|exists/i.test(error?.message ?? "")
      ? t("korisnikEmailPostoji") : (error?.message ?? t("greskaFallback")) }
  }
  const { error: pErr } = await admin.from("korisnici").insert({
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
  const admin = createAdminSupabaseClient()
  // Zaštita: ne dozvoli da skidanjem admin uloge ostane bez ijednog aktivnog admina.
  if (uloga !== "admin") {
    const { data: cilj } = await admin.from("korisnici").select("uloga, aktivan").eq("id", korisnikId).maybeSingle()
    if (cilj?.uloga === "admin" && cilj.aktivan && (await brojAktivnihAdmina(admin)) <= 1) {
      return { ok: false, message: t("barJedanAdmin") }
    }
  }
  const { error } = await admin.from("korisnici").update({ uloga }).eq("id", korisnikId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

export async function postaviAktivan(korisnikId: string, aktivan: boolean): Promise<ActionResult> {
  const ja = await zahtijevajAdmina()
  if (!aktivan && korisnikId === ja.id) {
    return { ok: false, message: t("deaktivirajVlastitiNalog") }
  }
  const admin = createAdminSupabaseClient()
  // Zaštita: ne dozvoli deaktivaciju zadnjeg aktivnog administratora.
  if (!aktivan) {
    const { data: cilj } = await admin.from("korisnici").select("uloga").eq("id", korisnikId).maybeSingle()
    if (cilj?.uloga === "admin" && (await brojAktivnihAdmina(admin)) <= 1) {
      return { ok: false, message: t("barJedanAdmin") }
    }
  }
  const { error } = await admin.from("korisnici").update({ aktivan }).eq("id", korisnikId)
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
    const res = await sendEmail({
      to: [data.email],
      subject: testEmailSubject(),
      html: testEmailHtml({ ime: data.ime }),
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
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from("korisnici").update({ prima_podsjetnike: prima }).eq("id", korisnikId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

/** Postavi tačan skup dodijeljenih klijenata za korisnika (zamijeni postojeće). */
export async function postaviDodjele(korisnikId: string, klijentIds: string[]): Promise<ActionResult> {
  await zahtijevajAdmina()
  const admin = createAdminSupabaseClient()
  // Provjeri da svi klijent ID-jevi postoje prije brisanja (atomičnost)
  if (klijentIds.length > 0) {
    const { data: valid, error: chkErr } = await admin.from("klijenti").select("id").in("id", klijentIds)
    if (chkErr) return { ok: false, message: chkErr.message }
    if (!valid || valid.length !== klijentIds.length) {
      return { ok: false, message: t("klijentNepostojeciUDodjeli") }
    }
  }
  const { error: delErr } = await admin.from("korisnik_klijent").delete().eq("korisnik_id", korisnikId)
  if (delErr) return { ok: false, message: delErr.message }
  if (klijentIds.length > 0) {
    const rows = klijentIds.map((klijent_id) => ({ korisnik_id: korisnikId, klijent_id }))
    const { error: insErr } = await admin.from("korisnik_klijent").insert(rows)
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

// ─── Vrijeme slanja (lokalni sat Europe/Vienna) ─────────────────────────────

export async function updateVrijemeSlanja(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const raw = String(formData.get("vrijeme_slanja_sat") ?? "")
  const sat = Number(raw)
  if (!Number.isInteger(sat) || sat < 0 || sat > 23) {
    return { ok: false, message: t("vrijemeSatNeispravan") }
  }
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
  let data: { sent?: unknown[]; skipped?: unknown[]; errors?: unknown[]; deferred?: number }
  try {
    data = (await res.json()) as { sent?: unknown[]; skipped?: unknown[]; errors?: unknown[]; deferred?: number }
  } catch {
    return { ok: false, message: t("pokreniGreska") }
  }
  return {
    ok: true,
    poslano: data.sent?.length ?? 0,
    preskoceno: data.skipped?.length ?? 0,
    odgodjeno: data.deferred ?? 0,
    greske: data.errors?.length ?? 0,
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

/** Admin okine reset-email za korisnika (ne postavlja/ne vidi lozinku). */
export async function posaljiResetKorisniku(email: string): Promise<ActionResult> {
  await zahtijevajAdmina()
  const origin = (await headers()).get("origin") ?? ""
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/confirm` })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
