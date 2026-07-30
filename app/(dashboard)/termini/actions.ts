'use server'

import { z } from "zod"
import { createTranslator } from "next-intl"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { jeAdmin } from "@/lib/auth/roles"
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

/**
 * Zod pad → `ActionResult`, uz jedno pravilo (S2): greška na SKRIVENOM polju `id`
 * nije field-greška korisnika nego neispravan zahtjev, pa ide u toast (`message`).
 * Forme ne renderuju `FieldError` za `id` (nema vidljive kontrole), pa bi je slanje
 * kroz `errors` progutalo bez ikakvog feedbacka — `odlukaToast` na errors-only
 * rezultat namjerno ne prikazuje toast. Isti kanon kao `otkaziTermin`.
 * Kanali ostaju međusobno isključivi — nikad i toast i inline za istu poruku.
 */
function zodRezultat<T>(greska: z.ZodError<T>): ActionResult {
  const { id: idGreske, ...poljaGreske } = greska.flatten().fieldErrors as Record<
    string,
    string[] | undefined
  >
  if (idGreske && idGreske.length > 0) {
    return { ok: false, message: t("neispravanZahtjev") }
  }
  return { ok: false, errors: poljaGreske }
}

type SupabaseServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>

/**
 * Pravila za polje „Zaduženi" po ulozi (yoink zahtjev 2026-07-29):
 * - ne-admin smije upisati SAMO sebe ili osobu koja već ima pristup firmi
 *   (`get_zaduzeni_dodjele()` = admini + `korisnik_klijent` dodjele) — inače
 *   field-greška na `zaduzeni`;
 * - admin smije bilo koga; slobodan tekst koji ne odgovara nijednom korisniku
 *   i dalje prolazi (`termini.zaduzeni` nije FK).
 * Vraća `null` kad je unos dozvoljen.
 */
async function provjeriZaduzenogZaFirmu(
  supabase: SupabaseServerClient,
  klijentId: string,
  zaduzeni: string | undefined,
): Promise<ActionResult | null> {
  if (!zaduzeni) return null
  const korisnik = await getTrenutniKorisnik()
  if (!korisnik || jeAdmin(korisnik.uloga)) return null
  if (zaduzeni === korisnik.ime) return null
  const { data } = await supabase.rpc("get_zaduzeni_dodjele")
  const imaPristup = (data ?? []).some(
    (red) => red.klijent_id === klijentId && red.ime === zaduzeni,
  )
  if (!imaPristup) {
    return { ok: false, errors: { zaduzeni: [t("zaduzeniNemaPristup")] } }
  }
  return null
}

/**
 * Admin auto-dodjela: ako uneseno ime „Zaduženi" odgovara aktivnom ne-admin
 * korisniku, firma mu se upiše u `korisnik_klijent` (pristup + pregled) — isti
 * efekat kao ručna dodjela u Postavke → Korisnici. Best-effort NAKON uspješnog
 * upisa termina: termin je već sačuvan, pa greška dodjele ne smije oboriti akciju
 * (RLS `kk_wr` ionako dozvoljava upis samo adminu). Slobodan tekst bez podudaranja
 * se preskače.
 */
async function dodijeliFirmuZaduzenom(
  supabase: SupabaseServerClient,
  klijentId: string,
  zaduzeni: string | undefined,
): Promise<void> {
  if (!zaduzeni) return
  const korisnik = await getTrenutniKorisnik()
  if (!korisnik || !jeAdmin(korisnik.uloga)) return
  const { data: mete } = await supabase
    .from("korisnici")
    .select("id, uloga")
    .eq("ime", zaduzeni)
    .eq("aktivan", true)
  const redovi = (mete ?? [])
    .filter((m) => m.uloga !== "admin") // admini već vide sve firme
    .map((m) => ({ korisnik_id: m.id, klijent_id: klijentId }))
  if (redovi.length === 0) return
  const { error } = await supabase
    .from("korisnik_klijent")
    .upsert(redovi, { onConflict: "korisnik_id,klijent_id", ignoreDuplicates: true })
  if (error) {
    console.warn(`[zaduzeni-auto-dodjela] dodjela firme ${klijentId} nije upisana: ${error.message}`)
  }
}

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
    return zodRezultat(parsed.error)
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

  // Pravila „Zaduženi" po ulozi — vrijede i pri izmjeni; treba firma termina
  let klijentIdTermina: string | null = null
  if (typeof patch.zaduzeni === "string" && patch.zaduzeni) {
    // S1: pad lookup-a NIJE "nema reda" — bez firme se pravilo ne može provjeriti, pa se upis odbija
    const { data: red, error: redGreska } = await supabase
      .from("termini").select("klijent_id").eq("id", id).maybeSingle()
    if (redGreska) return { ok: false, message: friendlyDbError(redGreska) }
    klijentIdTermina = red?.klijent_id ?? null
    if (klijentIdTermina) {
      const zaduzeniGreska = await provjeriZaduzenogZaFirmu(supabase, klijentIdTermina, patch.zaduzeni)
      if (zaduzeniGreska) return zaduzeniGreska
    }
  }

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

  // Admin: zaduženom radniku auto-dodijeli firmu (pristup) — tek nakon uspješnog upisa
  if (typeof patch.zaduzeni === "string" && patch.zaduzeni && klijentIdTermina) {
    await dodijeliFirmuZaduzenom(supabase, klijentIdTermina, patch.zaduzeni)
  }

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
  ponavlja_se: z.literal("on").optional(),
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

  // Pravila „Zaduženi" po ulozi — prije bilo kakvog upisa
  const zaduzeniGreska = await provjeriZaduzenogZaFirmu(supabase, klijent_id, zaduzeni)
  if (zaduzeniGreska) return zaduzeniGreska

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

  // Yoink 2026-07-30, stavka 11: ponavljajući unos dobija i profil-stavku, inače
  // termin ostaje siroče — ne vidi se u ID karti ni u Uslugama, i po izvršenju
  // nema intervala iz kojeg bi se izračunao sljedeći rok. Oba uslova (lokacija,
  // vrsta sa intervalom) se provjeravaju PRIJE bilo kakvog upisa — korisnik ne
  // smije ostati sa upisanim terminom i greškom.
  const jePonavljajuci = parsed.data.ponavlja_se === "on"
  if (jePonavljajuci) {
    if (!lokacija_id) return { ok: false, message: t("ponavljanjeTraziLokaciju") }

    const { data: vrsta } = await supabase
      .from("vrste_provjera").select("podrazumevani_interval_mjeseci")
      .eq("id", vrsta_provjere_id).maybeSingle()
    if (!vrsta?.podrazumevani_interval_mjeseci) {
      return { ok: false, message: t("ponavljanjeVrstaBezIntervala") }
    }
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

  // Termin je upisan i vidljiv — profil-stavka je odavde best-effort i NE smije
  // poništiti (ni "obrisati") već sačuvan termin. 23505 znači da stavka već
  // postoji (uq_klijent_provjere) — to je uspjeh, ne greška.
  if (jePonavljajuci && lokacija_id) {
    const { error: kpErr } = await supabase.from("klijent_provjere").insert({
      klijent_id,
      vrsta_provjere_id,
      lokacija_id,
      interval_mjeseci: null, // null = prati podrazumijevani interval vrste
      zadnji_datum: null,
    })
    if (kpErr && kpErr.code !== "23505") {
      return { ok: false, message: friendlyDbError(kpErr) }
    }
  }

  // Admin: zaduženom radniku auto-dodijeli firmu (pristup) — tek nakon uspješnog upisa
  await dodijeliFirmuZaduzenom(supabase, klijent_id, zaduzeni)

  // Best-effort: obavijest kad je zakazano poslije roka. Ne obara kreiranje.
  if (datum_zakazan && novi?.id && jeZakazanoPoslijeRoka(rok_dospijeca, datum_zakazan)) {
    const obav = await posaljiZakazanoNakonRoka(supabase, { terminId: novi.id, datumZakazan: datum_zakazan })
    if (obav.razlog === "greska") {
      console.warn(`[zakazano-nakon-roka] obavijest nije poslana (termin ${novi.id}): ${obav.message ?? "nepoznata greška"}`)
    }
  }

  revalidatePath(`/klijenti/${klijent_id}`)

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
    return zodRezultat(parsed.error)
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
