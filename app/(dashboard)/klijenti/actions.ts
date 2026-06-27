'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { parseEmailList } from "@/lib/reminders/recipients"
import { addMjeseci } from "@/lib/date"
import { validUgovorDatumi } from "@/lib/ugovori"
import type { Database } from "@/db/types"

type LokacijeUpdate = Database["public"]["Tables"]["lokacije"]["Update"]
type KlijentiUpdate = Database["public"]["Tables"]["klijenti"]["Update"]

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const optionalText = (max: number) =>
  z.string().max(max).optional().or(z.literal("").transform(() => undefined))

const createKlijentSchema = z.object({
  naziv: z.string().min(1, "Naziv je obavezan").max(200),
  napomena: optionalText(2000),
})

export async function createKlijent(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createKlijentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("klijenti").insert({
    naziv: parsed.data.naziv,
    napomena: parsed.data.napomena ?? null,
  })
  if (error) {
    // UNIQUE constraint na naziv → prijateljska poruka
    const msg = /duplicate|unique/i.test(error.message)
      ? "Klijent sa tim nazivom već postoji."
      : error.message
    return { ok: false, message: msg }
  }
  revalidatePath("/klijenti")
  return { ok: true }
}

// ─── Klijent update + delete ───────────────────────────────────────────────

const UUID_OR_EMPTY = z
  .string()
  .optional()
  .transform((v) => (!v || v === "none" ? undefined : v))
  .refine(
    (v) => v === undefined || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    "Neispravan korisnik",
  )

const updateKlijentSchema = z.object({
  id: z.string().uuid(),
  naziv: z.string().min(1, "Naziv je obavezan").max(200).optional(),
  napomena: optionalText(2000),
  podsjetnik_emails: z.string().max(2000).optional(),
  tip_odnosa: z
    .union([z.enum(["ugovor", "ponuda"]), z.literal("none"), z.literal(""), z.null()])
    .transform((v) => (v === "none" || v === "" ? null : v))
    .optional(),
  adresa: optionalText(300),
  pib: optionalText(40),
  maticni_broj: optionalText(40),
  sifra_djelatnosti: optionalText(40),
  telefon: optionalText(60),
  email: optionalText(200),
  zaduzeni_tehpro_id: UUID_OR_EMPTY,
})

export async function updateKlijent(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = updateKlijentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, ...f } = parsed.data
  const patch: KlijentiUpdate = { updated_at: new Date().toISOString() }
  if (formData.has("naziv") && f.naziv) patch.naziv = f.naziv
  if (formData.has("napomena")) patch.napomena = f.napomena ?? null
  if (formData.has("podsjetnik_emails")) {
    patch.podsjetnik_emails = parseEmailList(f.podsjetnik_emails ?? "")
  }
  if (formData.has("tip_odnosa")) {
    patch.tip_odnosa = f.tip_odnosa ?? null
  }
  if (formData.has("adresa")) patch.adresa = f.adresa ?? null
  if (formData.has("pib")) patch.pib = f.pib ?? null
  if (formData.has("maticni_broj")) patch.maticni_broj = f.maticni_broj ?? null
  if (formData.has("sifra_djelatnosti")) patch.sifra_djelatnosti = f.sifra_djelatnosti ?? null
  if (formData.has("telefon")) patch.telefon = f.telefon ?? null
  if (formData.has("email")) patch.email = f.email ?? null
  if (formData.has("zaduzeni_tehpro_id")) patch.zaduzeni_tehpro_id = f.zaduzeni_tehpro_id ?? null
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("klijenti").update(patch).eq("id", id)
  if (error) {
    const msg = /duplicate|unique/i.test(error.message)
      ? "Klijent sa tim nazivom već postoji."
      : error.message
    return { ok: false, message: msg }
  }
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

const deleteKlijentSchema = z.object({ id: z.string().uuid() })

export async function deleteKlijent(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = deleteKlijentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("klijenti").delete().eq("id", parsed.data.id)
  if (error) {
    const msg = /foreign key|violates|restrict/i.test(error.message)
      ? "Ne možete obrisati klijenta koji ima termine."
      : error.message
    return { ok: false, message: msg }
  }
  revalidatePath("/klijenti")
  return { ok: true }
}

// ─── Lokacije ──────────────────────────────────────────────────────────────

const lokacijaFields = {
  naziv: z.string().min(1, "Naziv je obavezan").max(200),
  grad: optionalText(120),
  regija: optionalText(120),
  adresa: optionalText(300),
  kontakt_osoba: optionalText(200),
  kontakt_email: optionalText(200),
  kontakt_telefon: optionalText(60),
}

const createLokacijaSchema = z.object({ klijent_id: z.string().uuid(), ...lokacijaFields })
const updateLokacijaSchema = z.object({ id: z.string().uuid(), ...lokacijaFields })
const deleteLokacijaSchema = z.object({ id: z.string().uuid() })

export async function createLokacija(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createLokacijaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { klijent_id, ...f } = parsed.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("lokacije").insert({
    klijent_id,
    naziv: f.naziv,
    grad: f.grad ?? null,
    regija: f.regija ?? null,
    adresa: f.adresa ?? null,
    kontakt_osoba: f.kontakt_osoba ?? null,
    kontakt_email: f.kontakt_email ?? null,
    kontakt_telefon: f.kontakt_telefon ?? null,
  })
  if (error) return { ok: false, message: error.message }
  // 'layout' revalidira i /klijenti listu (broj_lokacija count) i /klijenti/[id] detalje
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

export async function updateLokacija(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = updateLokacijaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, ...f } = parsed.data
  const patch: LokacijeUpdate = {}
  if (formData.has("naziv") && f.naziv) patch.naziv = f.naziv
  if (formData.has("grad")) patch.grad = f.grad ?? null
  if (formData.has("regija")) patch.regija = f.regija ?? null
  if (formData.has("adresa")) patch.adresa = f.adresa ?? null
  if (formData.has("kontakt_osoba")) patch.kontakt_osoba = f.kontakt_osoba ?? null
  if (formData.has("kontakt_email")) patch.kontakt_email = f.kontakt_email ?? null
  if (formData.has("kontakt_telefon")) patch.kontakt_telefon = f.kontakt_telefon ?? null
  if (Object.keys(patch).length === 0) return { ok: true }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("lokacije").update(patch).eq("id", id)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

export async function deleteLokacija(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = deleteLokacijaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("lokacije").delete().eq("id", parsed.data.id)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

// ─── Profil provjere ───────────────────────────────────────────────────────

export async function createProfilProvjere(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const klijent_id = String(formData.get("klijent_id") ?? "")
  const vrsta_provjere_id = String(formData.get("vrsta_provjere_id") ?? "")
  const lokRaw = String(formData.get("lokacija_id") ?? "")
  const lokacija_id = lokRaw && lokRaw !== "none" ? lokRaw : null
  const intRaw = String(formData.get("interval_mjeseci") ?? "").trim()
  const interval_override = intRaw ? Number(intRaw) : null
  const zadnji_datum = String(formData.get("zadnji_datum") ?? "")

  if (!klijent_id || !vrsta_provjere_id || !zadnji_datum) {
    return { ok: false, message: "Vrsta i zadnji datum su obavezni." }
  }
  if (interval_override !== null && (!Number.isInteger(interval_override) || interval_override < 1 || interval_override > 120)) {
    return { ok: false, message: "Interval mora biti 1–120 mjeseci." }
  }

  const supabase = await createServerSupabaseClient()

  // lokacija mora pripadati klijentu
  if (lokacija_id) {
    const { data: lok } = await supabase.from("lokacije").select("id").eq("id", lokacija_id).eq("klijent_id", klijent_id).maybeSingle()
    if (!lok) return { ok: false, message: "Lokacija ne pripada klijentu." }
  }

  // interval: override → vrsta default
  const { data: vrsta } = await supabase.from("vrste_provjera").select("podrazumevani_interval_mjeseci").eq("id", vrsta_provjere_id).maybeSingle()
  const interval = interval_override ?? (vrsta?.podrazumevani_interval_mjeseci ?? null)
  if (!interval) return { ok: false, message: "Interval je obavezan (vrsta nema podrazumevani)." }

  // upiši profil-stavku
  const { error: insErr } = await supabase.from("klijent_provjere").insert({
    klijent_id, vrsta_provjere_id, lokacija_id,
    interval_mjeseci: interval_override, zadnji_datum,
  })
  if (insErr) {
    return insErr.code === "23505"
      ? { ok: false, message: "Ova provjera već postoji u profilu." }
      : { ok: false, message: insErr.message }
  }

  // generiši jedan termin ako ne postoji aktivan za (klijent+vrsta+lokacija)
  const rok = addMjeseci(zadnji_datum, interval)
  let q = supabase.from("termini").select("id").eq("klijent_id", klijent_id).eq("vrsta_provjere_id", vrsta_provjere_id).not("status", "in", "(izvrseno,otkazano)")
  q = lokacija_id ? q.eq("lokacija_id", lokacija_id) : q.is("lokacija_id", null)
  const { data: postoji } = await q.limit(1)
  if (!postoji || postoji.length === 0) {
    await supabase.from("termini").insert({
      klijent_id, vrsta_provjere_id, lokacija_id,
      rok_dospijeca: rok, status: "planirano", interval_mjeseci: interval,
    })
  }

  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function deleteProfilProvjere(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "Nedostaje id." }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("klijent_provjere").delete().eq("id", id)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

// ─── Ugovori ────────────────────────────────────────────────────────────────

const intOrNull = (min: number, max: number) =>
  z.string().trim().optional()
    .transform((s) => (!s ? null : Number(s)))
    .refine((n) => n === null || (Number.isInteger(n) && n >= min && n <= max), `Broj mora biti ${min}–${max}`)

const dateOrNull = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Neispravan datum").optional()
  .or(z.literal("").transform(() => undefined)).transform((v) => v ?? null)

const boolFromCheckbox = z.string().optional().transform((v) => v === "on" || v === "true")

const ugovorFields = {
  zavodni_broj: optionalText(120),
  datum_potpisivanja: dateOrNull,
  datum_isteka: dateOrNull,
  vazenje_mjeseci: intOrNull(1, 600),
  broj_obilazaka_mjesecno: intOrNull(0, 31),
  automatsko_obnavljanje: boolFromCheckbox,
  aktivan: boolFromCheckbox,
  napomena: optionalText(2000),
}

const createUgovorSchema = z.object({ klijent_id: z.string().uuid(), ...ugovorFields })
const updateUgovorSchema = z.object({ id: z.string().uuid(), klijent_id: z.string().uuid(), ...ugovorFields })

// "Jedan aktivan ugovor po klijentu" se enforce-uje DB trigerom
// (tg_ugovor_jedan_aktivan) atomično — app ne radi zasebnu deaktivaciju.

export async function createUgovor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = createUgovorSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { klijent_id, aktivan, ...f } = parsed.data
  if (!validUgovorDatumi(f.datum_potpisivanja, f.datum_isteka)) {
    return { ok: false, message: "Datum isteka mora biti nakon datuma potpisivanja." }
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("ugovori").insert({ klijent_id, aktivan, ...f })
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function updateUgovor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = updateUgovorSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, klijent_id, aktivan, ...f } = parsed.data
  if (!validUgovorDatumi(f.datum_potpisivanja, f.datum_isteka)) {
    return { ok: false, message: "Datum isteka mora biti nakon datuma potpisivanja." }
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("ugovori").update({ aktivan, ...f }).eq("id", id).eq("klijent_id", klijent_id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function deleteUgovor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid(), klijent_id: z.string().uuid() })
    .safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, message: "Neispravan zahtjev." }
  const { id, klijent_id } = parsed.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("ugovori").delete().eq("id", id).eq("klijent_id", klijent_id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

// ─── Kontakt osobe ────────────────────────────────────────────────────────────

const kontaktFields = {
  ime: z.string().min(1, "Ime je obavezno").max(200),
  funkcija: optionalText(120),
  telefon: optionalText(60),
  email: optionalText(200),
}
const createKontaktSchema = z.object({ klijent_id: z.string().uuid(), ...kontaktFields })
const updateKontaktSchema = z.object({ id: z.string().uuid(), klijent_id: z.string().uuid(), ...kontaktFields })
const deleteKontaktSchema = z.object({ id: z.string().uuid(), klijent_id: z.string().uuid() })

export async function createKontakt(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = createKontaktSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { klijent_id, ...f } = parsed.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("kontakt_osobe").insert({
    klijent_id, ime: f.ime, funkcija: f.funkcija ?? null, telefon: f.telefon ?? null, email: f.email ?? null,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function updateKontakt(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = updateKontaktSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, klijent_id, ...f } = parsed.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("kontakt_osobe").update({
    ime: f.ime, funkcija: f.funkcija ?? null, telefon: f.telefon ?? null, email: f.email ?? null,
  }).eq("id", id).eq("klijent_id", klijent_id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function deleteKontakt(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = deleteKontaktSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, message: "Neispravan zahtjev." }
  const { id, klijent_id } = parsed.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("kontakt_osobe").delete().eq("id", id).eq("klijent_id", klijent_id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}
