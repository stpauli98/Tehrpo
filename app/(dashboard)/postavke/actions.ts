'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"

export type ActionResult =
  | { ok: true; danaPrije?: number[] }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const schema = z.object({
  // "30, 14, 7, 1" → niz brojeva
  dana_prije: z
    .string()
    .min(1, "Unesite barem jedan prag")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
        .map((x) => Number(x)),
    )
    .refine((arr) => arr.length > 0 && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 365), {
      message: "Pragovi moraju biti cijeli brojevi 0–365, odvojeni zarezom",
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
      return { ok: false, message: `Interval mora biti cijeli broj 1–120 ili prazno (greška: "${s}")` }
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
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Nova vrsta pregleda ─────────────────────────────────────────────────────

const createVrstaSchema = z.object({
  naziv: z.string().trim().min(1, "Naziv je obavezan").max(200),
  // prazno = bez auto-zakazivanja (NULL); inače cijeli broj 1–120
  interval: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine(
      (s) => s === undefined || (Number.isInteger(Number(s)) && Number(s) >= 1 && Number(s) <= 120),
      { message: "Interval mora biti cijeli broj 1–120 ili prazno" },
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
      ? "Vrsta pregleda sa tim nazivom već postoji."
      : error.message
    return { ok: false, message: msg }
  }
  revalidatePath("/postavke")
  return { ok: true }
}

// ─── Admin: upravljanje korisnicima ──────────────────────────────────────────

async function zahtijevajAdmina(): Promise<void> {
  const k = await getTrenutniKorisnik()
  if (!k || k.uloga !== "admin") throw new Error("Samo administrator.")
}

const noviKorisnikSchema = z.object({
  ime: z.string().trim().min(1, "Ime je obavezno").max(120),
  email: z.string().email("Neispravan email"),
  lozinka: z.string().min(8, "Lozinka min 8 znakova"),
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
      ? "Korisnik sa tim emailom već postoji." : (error?.message ?? "Greška.") }
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
  await zahtijevajAdmina()
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from("korisnici").update({ uloga }).eq("id", korisnikId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}

export async function postaviAktivan(korisnikId: string, aktivan: boolean): Promise<ActionResult> {
  await zahtijevajAdmina()
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from("korisnici").update({ aktivan }).eq("id", korisnikId)
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
      return { ok: false, message: "Nepostojeći klijent u dodjeli." }
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
  naziv: z.string().trim().min(1, "Naziv je obavezan").max(200),
  interval: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine(
      (s) => s === undefined || (Number.isInteger(Number(s)) && Number(s) >= 1 && Number(s) <= 120),
      { message: "Interval mora biti 1–120 ili prazno" },
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
    const msg = /duplicate|unique/i.test(error.message) ? "Vrsta sa tim nazivom već postoji." : error.message
    return { ok: false, message: msg }
  }
  revalidatePath("/postavke")
  return { ok: true }
}

export async function postaviVrstaAktivna(vrstaId: string, aktivna: boolean): Promise<ActionResult> {
  await zahtijevajAdmina()
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("vrste_provjera").update({ aktivna }).eq("id", vrstaId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true }
}
