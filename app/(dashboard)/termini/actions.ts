'use server'

import { z } from "zod"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { friendlyDbError } from "@/lib/db-errors"
import { todayIso } from "@/lib/date"
import { jeZakazanoPoslijeRoka } from "@/lib/plan-datum"
import { posaljiZakazanoNakonRoka } from "@/lib/reminders/zakazanoNakonRoka"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import type { Database } from "@/db/types"

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

type TerminiUpdate = Database["public"]["Tables"]["termini"]["Update"]

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "termini.actions" })

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, t("datumNeispravan"))
  .optional()
  .or(z.literal("").transform(() => undefined))

const NE_U_BUDUCNOSTI = t("datumUBuducnosti")

const updateSchema = z.object({
  id: z.string().uuid(),
  datum_zakazan: optionalDate,
  datum_izvrsenja: optionalDate.refine((d) => !d || d <= todayIso(), NE_U_BUDUCNOSTI),
  zaduzeni: z.string().max(200).optional().or(z.literal("").transform(() => undefined)),
  napomena: z.string().max(2000).optional().or(z.literal("").transform(() => undefined)),
  status: z.enum(["planirano", "zakazano", "izvrseno", "otkazano"]).optional(),
})

export async function updateTermin(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    // S2: Zod field-greške idu ISKLJUČIVO inline (FieldError) — bez `message`,
    // inače bi ista poruka išla i u toast (dupli kanal).
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const { id, ...fields } = parsed.data

  // Ažuriraj SAMO polja prisutna u formi (sprječava null-wipe datum_izvrsenja
  // kada edit forma ne sadrži to polje za ne-izvršene termine).
  const patch: TerminiUpdate = {}
  if (formData.has("datum_zakazan")) patch.datum_zakazan = fields.datum_zakazan ?? null
  if (formData.has("datum_izvrsenja")) patch.datum_izvrsenja = fields.datum_izvrsenja ?? null
  if (formData.has("zaduzeni")) patch.zaduzeni = fields.zaduzeni ?? null
  if (formData.has("napomena")) patch.napomena = fields.napomena ?? null
  if (fields.status) patch.status = fields.status

  const supabase = await createServerSupabaseClient()

  // Sinhronizuj status sa "Datum zakazan": planirano ↔ zakazano; usput dohvati rok
  // (treba za detekciju zakazano-poslije-roka nakon upisa).
  let rokDospijeca: string | null = null
  if (formData.has("datum_zakazan")) {
    const { data: cur } = await supabase
      .from("termini").select("status, rok_dospijeca").eq("id", id).maybeSingle()
    rokDospijeca = cur?.rok_dospijeca ?? null
    if (!fields.status) {
      if (cur?.status === "planirano" && patch.datum_zakazan) patch.status = "zakazano"
      else if (cur?.status === "zakazano" && !patch.datum_zakazan) patch.status = "planirano"
    }
  }

  if (Object.keys(patch).length === 0) return { ok: true }

  const { error } = await supabase.from("termini").update(patch).eq("id", id)

  if (error) return { ok: false, message: friendlyDbError(error) }

  // Best-effort: obavijest kad je zakazano poslije roka. Ne obara čuvanje.
  const noviZakazan = patch.datum_zakazan
  if (typeof noviZakazan === "string" && jeZakazanoPoslijeRoka(rokDospijeca, noviZakazan)) {
    const obav = await posaljiZakazanoNakonRoka(supabase, { terminId: id, datumZakazan: noviZakazan })
    if (obav.razlog === "greska") {
      console.warn(`[zakazano-nakon-roka] obavijest nije poslana (termin ${id}): ${obav.message ?? "nepoznata greška"}`)
    }
  }

  return { ok: true }
}

const otkaziSchema = z.object({ id: z.string().uuid() })

/** Otkaži termin — postavi status na 'otkazano'. */
export async function otkaziTermin(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = otkaziSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, message: t("neispravanZahtjev") }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("termini").update({ status: "otkazano" }).eq("id", parsed.data.id)
  if (error) return { ok: false, message: friendlyDbError(error) }
  return { ok: true }
}

const createSchema = z.object({
  klijent_id: z.string().uuid(t("klijentObavezan")),
  vrsta_provjere_id: z.string().uuid(t("vrstaObavezna")),
  lokacija_id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  rok_dospijeca: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t("rokObavezan")),
  datum_zakazan: optionalDate,
  zaduzeni: z.string().max(200).optional().or(z.literal("").transform(() => undefined)),
})

export async function createTermin(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const { klijent_id, vrsta_provjere_id, lokacija_id, rok_dospijeca, datum_zakazan, zaduzeni } =
    parsed.data

  const supabase = await createServerSupabaseClient()

  // Integritet: izabrana lokacija mora pripadati izabranoj firmi (klijentu)
  if (lokacija_id) {
    const { data: lok } = await supabase
      .from("lokacije")
      .select("id")
      .eq("id", lokacija_id)
      .eq("klijent_id", klijent_id)
      .maybeSingle()
    if (!lok) return { ok: false, message: t("lokacijaNePripada") }
  }

  // Provjera duplikata: isti klijent + vrsta + rok (+ ista lokacija) koji nije otkazan
  let dupQuery = supabase
    .from("termini")
    .select("id")
    .eq("klijent_id", klijent_id)
    .eq("vrsta_provjere_id", vrsta_provjere_id)
    .eq("rok_dospijeca", rok_dospijeca)
    .neq("status", "otkazano")
  dupQuery = lokacija_id ? dupQuery.eq("lokacija_id", lokacija_id) : dupQuery.is("lokacija_id", null)
  const { data: dup } = await dupQuery.limit(1)
  if (dup && dup.length > 0) {
    return { ok: false, message: t("terminVecPostoji") }
  }

  const { data: novi, error } = await supabase.from("termini").insert({
    klijent_id,
    vrsta_provjere_id,
    lokacija_id: lokacija_id ?? null,
    rok_dospijeca,
    datum_zakazan: datum_zakazan ?? null,
    zaduzeni: zaduzeni ?? null,
    status: datum_zakazan ? "zakazano" : "planirano",
  }).select("id").single()

  if (error) return { ok: false, message: friendlyDbError(error) }

  // Best-effort: obavijest kad je zakazano poslije roka. Ne obara kreiranje.
  if (datum_zakazan && novi?.id && jeZakazanoPoslijeRoka(rok_dospijeca, datum_zakazan)) {
    const obav = await posaljiZakazanoNakonRoka(supabase, { terminId: novi.id, datumZakazan: datum_zakazan })
    if (obav.razlog === "greska") {
      console.warn(`[zakazano-nakon-roka] obavijest nije poslana (termin ${novi.id}): ${obav.message ?? "nepoznata greška"}`)
    }
  }

  return { ok: true }
}

const markSchema = z.object({
  id: z.string().uuid(),
  datum_izvrsenja: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, t("datumObavezan"))
    .refine((d) => d <= todayIso(), NE_U_BUDUCNOSTI),
})

export async function markIzvrseno(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = markSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    // S2: Zod field-greške idu ISKLJUČIVO inline (FieldError) — bez `message`,
    // inače bi ista poruka išla i u toast (dupli kanal).
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const { id, datum_izvrsenja } = parsed.data

  const supabase = await createServerSupabaseClient()
  // Mark-done u JEDNOM pozivu (datum + status) → tg_termini_auto_cycle spawn-uje sljedeći termin
  const { error } = await supabase
    .from("termini")
    .update({ datum_izvrsenja, status: "izvrseno" })
    .eq("id", id)

  if (error) return { ok: false, message: friendlyDbError(error) }

  return { ok: true }
}
