'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { parseEmailList } from "@/lib/reminders/recipients"
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

const updateKlijentSchema = z.object({
  id: z.string().uuid(),
  naziv: z.string().min(1, "Naziv je obavezan").max(200).optional(),
  napomena: optionalText(2000),
  podsjetnik_emails: z.string().max(2000).optional(),
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
