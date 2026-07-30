'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { addMjeseci } from "@/lib/date"
import { friendlyDbError } from "@/lib/db-errors"
import { normalizujNaziv } from "@/lib/klijenti"
import { validUgovorDatumi } from "@/lib/ugovori"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import type { Database } from "@/db/types"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "klijenti.actions" })

type LokacijeUpdate = Database["public"]["Tables"]["lokacije"]["Update"]
type KlijentiUpdate = Database["public"]["Tables"]["klijenti"]["Update"]

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

// PostgREST DELETE koji RLS odbije vraća 0 redova BEZ greške. Bez `.select()` + provjere
// dužine akcija bi javila uspjeh, a red bi ostao — sa `smije_brisati_klijente` koji je
// podrazumijevano false to je zatečeno stanje svakog operatera. Isti obrazac koji
// deleteDokumentAction već koristi.
function nijeObrisano(redovi: { id: string }[] | null): boolean {
  return !redovi || redovi.length === 0
}

/**
 * Postoji li red koji brišemo? Provjera je RLS-scoped: red na firmi koja korisniku nije
 * dodijeljena čita se kao „ne postoji", što mu je i tačno reći — ne odajemo postojanje
 * zapisa na tuđim firmama. Bez ovoga svako brisanje bez pogotka (dupli submit, ustajala
 * stranica, neko drugi već obrisao) tvrdi da je problem u dozvolama.
 */
async function postojiRed(
  upit: PromiseLike<{ data: { id: string } | null }>,
): Promise<boolean> {
  const { data } = await upit
  return data !== null
}

const optionalText = (max: number) =>
  z.string().max(max).optional().or(z.literal("").transform(() => undefined))

// Opcioni email: prazno polje → undefined, neprazno mora proći .email()
// (S2 — server ostaje izvor istine za ono što browser validacija propusti).
const optionalEmail = (max: number) =>
  z.string().max(max).email(t("emailNeispravan")).optional().or(z.literal("").transform(() => undefined))

const requiredText = (max: number, msg: string) =>
  z.string({ error: msg }).trim().min(1, msg).max(max)

// Obavezna polja klijenta (odluka 2026-07-03): adresa, telefon, email — uz naziv.
// Ista pravila važe za kreiranje i uređivanje, da podaci ostanu potpuni.
const klijentObavezniFields = {
  naziv: requiredText(200, t("nazivObavezan")),
  adresa: requiredText(300, t("adresaObavezna")),
  telefon: requiredText(60, t("telefonObavezan")),
  email: requiredText(200, t("emailObavezan")).pipe(z.string().email(t("emailNeispravan"))),
}

// Premješteno iznad createKlijentSchema (yoink stavka 4, 2026-07-30): oba schema-a
// sada koriste UUID_OR_EMPTY, pa deklaracija ispod createKlijentSchema baca TDZ grešku.
const UUID_OR_EMPTY = z
  .string()
  .optional()
  .transform((v) => (!v || v === "none" ? undefined : v))
  .refine(
    (v) => v === undefined || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    t("korisnikNeispravan"),
  )

const createKlijentSchema = z.object({
  ...klijentObavezniFields,
  napomena: optionalText(2000),
  // Polja koja su do 2026-07-30 postojala samo u edit formi (yoink stavka 4).
  pib: optionalText(40),
  maticni_broj: optionalText(40),
  sifra_djelatnosti: optionalText(40),
  zaduzeni_tehpro_id: UUID_OR_EMPTY,
  tip_odnosa: z
    .union([z.enum(["ugovor", "ponuda"]), z.literal("none"), z.literal(""), z.null()])
    .transform((v) => (v === "none" || v === "" ? null : v))
    .optional(),
  // Prva lokacija — opciona, ali preporučena: klijent bez lokacije ne može
  // dobiti nijednu uslugu (createProfilProvjere odbija stavku bez lokacije).
  lokacija_naziv: optionalText(200),
  lokacija_grad: optionalText(120),
  lokacija_adresa: optionalText(300),
})

export async function createKlijent(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createKlijentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const f = parsed.data
  // M10: grad/adresa bez naziva su se tiho gubili (upis lokacije je gejtovan
  // nazivom). Provjera ide PRIJE upisa klijenta da forma ne ostavi pola stanja.
  const lokNaziv = (f.lokacija_naziv ?? "").trim()
  if (!lokNaziv && (f.lokacija_grad || f.lokacija_adresa)) {
    return { ok: false, errors: { lokacija_naziv: [t("lokacijaNazivObavezan")] } }
  }
  const supabase = await createServerSupabaseClient()
  const { data: novi, error } = await supabase.from("klijenti").insert({
    naziv: f.naziv,
    adresa: f.adresa,
    telefon: f.telefon,
    email: f.email,
    napomena: f.napomena ?? null,
    pib: f.pib ?? null,
    maticni_broj: f.maticni_broj ?? null,
    sifra_djelatnosti: f.sifra_djelatnosti ?? null,
    zaduzeni_tehpro_id: f.zaduzeni_tehpro_id ?? null,
    tip_odnosa: f.tip_odnosa ?? null,
  }).select("id").single()
  if (error) {
    // UNIQUE constraint na naziv → prijateljska poruka
    const msg = /duplicate|unique/i.test(error.message)
      ? t("klijentNazivPostoji")
      : friendlyDbError(error)
    return { ok: false, message: msg }
  }

  // Prva lokacija: ako upis padne, klijent se POVLAČI (rollback). Bez toga je
  // ishod lažan — dijalog ostaje otvoren (NoviKlijentButton zatvara samo na
  // state.ok), pa bi ponovni submit udario u UNIQUE(naziv) i korisnik bi dobio
  // „klijent sa tim nazivom već postoji" za klijenta kojeg je sam upravo
  // napravio. Sa rollbackom je poruka tačna, a ponovni submit prolazi.
  if (lokNaziv) {
    const { error: lokErr } = await supabase.from("lokacije").insert({
      klijent_id: novi.id,
      naziv: lokNaziv,
      grad: f.lokacija_grad ?? null,
      adresa: f.lokacija_adresa ?? null,
    })
    if (lokErr) {
      // .select() je bitan: pod RLS-om delete bez prava vraća uspjeh sa 0 redova,
      // pa broj obrisanih redova (ne odsustvo greške) dokazuje da je rollback prošao.
      const { data: povuceni, error: rbErr } = await supabase
        .from("klijenti").delete().eq("id", novi.id).select("id")
      revalidatePath("/klijenti", "layout")
      if (rbErr || (povuceni?.length ?? 0) !== 1) {
        // Rollback nije prošao → klijent POSTOJI. Reci to umjesto da poruka laže.
        return { ok: false, message: t("klijentBezLokacije", { poruka: friendlyDbError(lokErr) }) }
      }
      return { ok: false, message: friendlyDbError(lokErr) }
    }
  }

  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

// ─── Klijent update + delete ───────────────────────────────────────────────

const updateKlijentSchema = z.object({
  id: z.string().uuid(),
  ...klijentObavezniFields,
  napomena: optionalText(2000),
  tip_odnosa: z
    .union([z.enum(["ugovor", "ponuda"]), z.literal("none"), z.literal(""), z.null()])
    .transform((v) => (v === "none" || v === "" ? null : v))
    .optional(),
  pib: optionalText(40),
  maticni_broj: optionalText(40),
  sifra_djelatnosti: optionalText(40),
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
      ? t("klijentNazivPostoji")
      : friendlyDbError(error)
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
  if (!(await postojiRed(supabase.from("klijenti").select("id").eq("id", parsed.data.id).maybeSingle()))) {
    return { ok: false, message: t("zapisNePostoji") }
  }
  const { data: obrisano, error } = await supabase
    .from("klijenti")
    .delete()
    .eq("id", parsed.data.id)
    .select("id")
  if (error) {
    const msg = /foreign key|violates|restrict/i.test(error.message)
      ? t("klijentImaTermine")
      : friendlyDbError(error)
    return { ok: false, message: msg }
  }
  if (nijeObrisano(obrisano)) return { ok: false, message: t("brisanjeNijeDozvoljeno") }
  revalidatePath("/klijenti")
  return { ok: true }
}

// ─── Lokacije ──────────────────────────────────────────────────────────────

const lokacijaFields = {
  naziv: z.string().min(1, t("nazivObavezan")).max(200),
  grad: optionalText(120),
  regija: optionalText(120),
  adresa: optionalText(300),
  // Izbor kontakta za lokaciju (v. LokacijaSheet). Kontakt lokacije živi
  // isključivo u kontakt_osobe od 2026-07-30.
  kontakt_izbor: z.enum(["bez", "postojeci", "novi"]).optional(),
  kontakt_id: z.union([z.string().uuid(), z.literal("")]).optional(),
  kontakt_ime: optionalText(200),
  kontakt_novi_email: optionalEmail(200),
  kontakt_novi_telefon: optionalText(60),
  kontakt_prima: z.literal("1").optional(),
  // Kad je checkbox iznad onemogućen (slanje ugašeno), disabled input ne šalje
  // vrijednost pa server ne može razlikovati "isključeno" od "zaključano" bez ovoga.
  kontakt_prima_zakljucan: z.literal("1").optional(),
}

const createLokacijaSchema = z.object({ klijent_id: z.string().uuid(), ...lokacijaFields })
const updateLokacijaSchema = z.object({ id: z.string().uuid(), ...lokacijaFields })
const deleteLokacijaSchema = z.object({ id: z.string().uuid() })

/**
 * Veže kontakt za lokaciju poslije uspješnog upisa lokacije.
 *
 * Namjerno NE ruši rezultat lokacije: lokacija je već kreirana i to je vidljivo.
 * Vraća poruku o grešci da korisnik zna da veza nije napravljena, umjesto da tiho
 * ostane lokacija bez kontakta koji je mislio da je dodao.
 */
async function veziKontaktZaLokaciju(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  args: {
    klijentId: string
    lokacijaId: string
    izbor?: "bez" | "postojeci" | "novi"
    kontaktId?: string
    ime?: string
    email?: string
    telefon?: string
    prima: boolean
    /**
     * Checkbox je bio onemogućen (slanje ugašeno) — disabled input ne šalje vrijednost,
     * pa `prima` je uvijek false ovdje i NE smije se uzeti kao "korisnik je isključio".
     * Za postojeći kontakt: ne diramo stored `podsjetnik_primalac` (ne gasi tuđi izbor
     * tiho preko onemogućene kontrole). Za novog kontakta nema šta da se čuva, pa upisujemo
     * false — novi kontakt se ne smije tiho pretvoriti u primaoca dok je slanje ugašeno.
     */
    zakljucan: boolean
  },
): Promise<string | null> {
  if (!args.izbor || args.izbor === "bez") return null

  if (args.izbor === "postojeci") {
    if (!args.kontaktId) return null
    const patch: { lokacija_id: string; podsjetnik_primalac?: boolean } = { lokacija_id: args.lokacijaId }
    if (!args.zakljucan) patch.podsjetnik_primalac = args.prima
    const { error } = await supabase
      .from("kontakt_osobe")
      .update(patch)
      .eq("id", args.kontaktId)
      .eq("klijent_id", args.klijentId)
    return error ? friendlyDbError(error) : null
  }

  if (!args.ime) return null
  const { error } = await supabase.from("kontakt_osobe").insert({
    klijent_id: args.klijentId,
    ime: args.ime,
    email: args.email ?? null,
    telefon: args.telefon ?? null,
    lokacija_id: args.lokacijaId,
    podsjetnik_primalac: args.prima,
  })
  return error ? friendlyDbError(error) : null
}

export async function createLokacija(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createLokacijaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { klijent_id, ...f } = parsed.data
  const supabase = await createServerSupabaseClient()
  // App-nivo dedup (S8.7): DB još nema UNIQUE (klijent_id, naziv), a bez ovoga
  // se ista lokacija unosi dvaput samo zbog razmaka/veličine slova.
  // S1: pad ovog upita se NE smije protumačiti kao „nema duplikata" — prazan
  // odgovor zbog greške bi tiho propustio unos koji provjera treba da odbije.
  const { data: postojece, error: dupErr } = await supabase.from("lokacije").select("id, naziv").eq("klijent_id", klijent_id)
  if (dupErr) return { ok: false, message: friendlyDbError(dupErr) }
  if ((postojece ?? []).some((l) => normalizujNaziv(l.naziv) === normalizujNaziv(f.naziv))) {
    return { ok: false, errors: { naziv: [t("lokacijaPostoji")] } }
  }
  const { data: nova, error } = await supabase.from("lokacije").insert({
    klijent_id,
    naziv: f.naziv,
    grad: f.grad ?? null,
    regija: f.regija ?? null,
    adresa: f.adresa ?? null,
  }).select("id").single()
  if (error) return { ok: false, message: friendlyDbError(error) }

  const vezaGreska = await veziKontaktZaLokaciju(supabase, {
    klijentId: klijent_id,
    lokacijaId: nova.id,
    izbor: f.kontakt_izbor,
    kontaktId: f.kontakt_id || undefined,
    ime: f.kontakt_ime,
    email: f.kontakt_novi_email,
    telefon: f.kontakt_novi_telefon,
    prima: f.kontakt_prima === "1",
    zakljucan: f.kontakt_prima_zakljucan === "1",
  })
  if (vezaGreska) {
    revalidatePath("/klijenti", "layout")
    return { ok: false, message: vezaGreska }
  }
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
  // Prazan patch nije razlog za izlaz ako korisnik mijenja SAMO vezu kontakta.
  if (Object.keys(patch).length === 0 && (!f.kontakt_izbor || f.kontakt_izbor === "bez")) return { ok: true }
  const supabase = await createServerSupabaseClient()
  const { data: red, error } = await supabase
    .from("lokacije").update(patch).eq("id", id).select("klijent_id").single()
  if (error) return { ok: false, message: friendlyDbError(error) }

  const vezaGreska = await veziKontaktZaLokaciju(supabase, {
    klijentId: red.klijent_id,
    lokacijaId: id,
    izbor: f.kontakt_izbor,
    kontaktId: f.kontakt_id || undefined,
    ime: f.kontakt_ime,
    email: f.kontakt_novi_email,
    telefon: f.kontakt_novi_telefon,
    prima: f.kontakt_prima === "1",
    zakljucan: f.kontakt_prima_zakljucan === "1",
  })
  revalidatePath("/klijenti", "layout")
  return vezaGreska ? { ok: false, message: vezaGreska } : { ok: true }
}

export async function deleteLokacija(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = deleteLokacijaSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const supabase = await createServerSupabaseClient()
  if (!(await postojiRed(supabase.from("lokacije").select("id").eq("id", parsed.data.id).maybeSingle()))) {
    return { ok: false, message: t("zapisNePostoji") }
  }
  const { data: obrisano, error } = await supabase
    .from("lokacije")
    .delete()
    .eq("id", parsed.data.id)
    .select("id")
  if (error) return { ok: false, message: friendlyDbError(error) }
  if (nijeObrisano(obrisano)) return { ok: false, message: t("brisanjeNijeDozvoljeno") }
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

// ─── Profil provjere ───────────────────────────────────────────────────────

const ISO_DATUM_RE = /^\d{4}-\d{2}-\d{2}$/

export async function createProfilProvjere(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const klijent_id = String(formData.get("klijent_id") ?? "")
  const vrsta_provjere_id = String(formData.get("vrsta_provjere_id") ?? "")
  const lokRaw = String(formData.get("lokacija_id") ?? "")
  const lokacija_id = lokRaw && lokRaw !== "none" ? lokRaw : null
  // "vec_radeno" (unosi se zadnji datum) ili "prvi_put" (provjera nikad nije
  // rađena — unosi se prvi rok direktno, zadnji_datum ostaje NULL)
  const rezim = String(formData.get("rezim") ?? "vec_radeno") === "prvi_put" ? "prvi_put" : "vec_radeno"
  const zadnji_datum = String(formData.get("zadnji_datum") ?? "")
  const prvi_rok = String(formData.get("prvi_rok") ?? "")
  const nacinRaw = String(formData.get("nacin_izvrsenja") ?? "izvrsava")
  const nacin_izvrsenja = nacinRaw === "pracenje" ? "pracenje" : "izvrsava"

  if (!klijent_id || !vrsta_provjere_id) {
    return { ok: false, message: t("vrstaObavezna") }
  }
  // Poslovno pravilo: svaka provjera u profilu mora imati konkretnu lokaciju.
  if (!lokacija_id) {
    return { ok: false, message: t("lokacijaObavezna") }
  }
  if (rezim === "vec_radeno" && !ISO_DATUM_RE.test(zadnji_datum)) {
    return { ok: false, message: t("zadnjiDatumObavezan") }
  }
  if (rezim === "prvi_put" && !ISO_DATUM_RE.test(prvi_rok)) {
    return { ok: false, message: t("prviRokObavezan") }
  }

  const supabase = await createServerSupabaseClient()

  // lokacija mora pripadati klijentu
  const { data: lok } = await supabase.from("lokacije").select("id").eq("id", lokacija_id).eq("klijent_id", klijent_id).maybeSingle()
  if (!lok) return { ok: false, message: t("lokacijaNePripada") }

  // Periodika je ISKLJUČIVO podrazumijevani interval vrste (uređuje se u Postavkama);
  // ručni unos po stavci je ukinut — eventualna vrijednost iz forme se ignoriše.
  const { data: vrsta } = await supabase.from("vrste_provjera").select("podrazumevani_interval_mjeseci").eq("id", vrsta_provjere_id).maybeSingle()
  const interval = vrsta?.podrazumevani_interval_mjeseci ?? null
  if (!interval) return { ok: false, message: t("vrstaNemaInterval") }

  // upiši profil-stavku (interval_mjeseci: null = prati default vrste)
  const { error: insErr } = await supabase.from("klijent_provjere").insert({
    klijent_id, vrsta_provjere_id, lokacija_id,
    interval_mjeseci: null,
    zadnji_datum: rezim === "vec_radeno" ? zadnji_datum : null,
    nacin_izvrsenja,
  })
  if (insErr) {
    return insErr.code === "23505"
      ? { ok: false, message: t("provjeraVecPostoji") }
      : { ok: false, message: friendlyDbError(insErr) }
  }

  // generiši jedan termin ako ne postoji aktivan za (klijent+vrsta+lokacija);
  // rok: iz zadnjeg datuma + interval, ili direktno zadani prvi rok
  const rok = rezim === "vec_radeno" ? addMjeseci(zadnji_datum, interval) : prvi_rok
  const { data: postoji, error: selErr } = await supabase
    .from("termini").select("id")
    .eq("klijent_id", klijent_id).eq("vrsta_provjere_id", vrsta_provjere_id).eq("lokacija_id", lokacija_id)
    .not("status", "in", "(izvrseno,otkazano)")
    .limit(1)
  if (selErr) return { ok: false, message: t("terminProvjeraOsvjezi") }
  if (!postoji || postoji.length === 0) {
    const { error: terminErr } = await supabase.from("termini").insert({
      klijent_id, vrsta_provjere_id, lokacija_id,
      rok_dospijeca: rok, status: "planirano", interval_mjeseci: interval, nacin_izvrsenja,
    })
    if (terminErr) return { ok: false, message: t("terminNijeGenerisan", { poruka: terminErr.message }) }
  }

  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function deleteProfilProvjere(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: t("nedostajeId") }
  const supabase = await createServerSupabaseClient()
  if (!(await postojiRed(supabase.from("klijent_provjere").select("id").eq("id", id).maybeSingle()))) {
    return { ok: false, message: t("zapisNePostoji") }
  }
  const { data: obrisano, error } = await supabase
    .from("klijent_provjere")
    .delete()
    .eq("id", id)
    .select("id")
  if (error) return { ok: false, message: friendlyDbError(error) }
  if (nijeObrisano(obrisano)) return { ok: false, message: t("brisanjeNijeDozvoljeno") }
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

// ─── Ugovori ────────────────────────────────────────────────────────────────

const intOrNull = (min: number, max: number) =>
  z.string().trim().optional()
    .transform((s) => (!s ? null : Number(s)))
    .refine((n) => n === null || (Number.isInteger(n) && n >= min && n <= max), t("brojOpseg", { min, max }))

const dateOrNull = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t("datumNeispravan")).optional()
  .or(z.literal("").transform(() => undefined)).transform((v) => v ?? null)

const boolFromCheckbox = z.string().optional().transform((v) => v === "on" || v === "true")

const ugovorFields = {
  zavodni_broj: optionalText(120),
  datum_potpisivanja: dateOrNull,
  datum_isteka: dateOrNull,
  vazenje_mjeseci: intOrNull(1, 600),
  na_neodredjeno: z.literal("on").optional().transform((v) => v === "on"),
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
    return { ok: false, message: t("datumIstekaNakonPotpisivanja") }
  }
  // Neodređeno i konkretan istek se isključuju (isto pravilo kao DB CHECK) —
  // hvatamo ga ovdje da korisnik dobije poruku umjesto sirove PG greške.
  if (f.na_neodredjeno && f.datum_isteka) {
    return { ok: false, errors: { datum_isteka: [t("ugovorIstekNeodredjeno")] } }
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("ugovori").insert({
    klijent_id,
    aktivan,
    ...f,
    na_neodredjeno: f.na_neodredjeno,
    datum_isteka: f.na_neodredjeno ? null : f.datum_isteka,
  })
  if (error) return { ok: false, message: friendlyDbError(error) }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function updateUgovor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = updateUgovorSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, klijent_id, aktivan, ...f } = parsed.data
  if (!validUgovorDatumi(f.datum_potpisivanja, f.datum_isteka)) {
    return { ok: false, message: t("datumIstekaNakonPotpisivanja") }
  }
  // Neodređeno i konkretan istek se isključuju (isto pravilo kao DB CHECK) —
  // hvatamo ga ovdje da korisnik dobije poruku umjesto sirove PG greške.
  if (f.na_neodredjeno && f.datum_isteka) {
    return { ok: false, errors: { datum_isteka: [t("ugovorIstekNeodredjeno")] } }
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("ugovori").update({
    aktivan,
    ...f,
    na_neodredjeno: f.na_neodredjeno,
    datum_isteka: f.na_neodredjeno ? null : f.datum_isteka,
  }).eq("id", id).eq("klijent_id", klijent_id)
  if (error) return { ok: false, message: friendlyDbError(error) }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function deleteUgovor(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid(), klijent_id: z.string().uuid() })
    .safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, message: t("neispravanZahtjev") }
  const { id, klijent_id } = parsed.data
  const supabase = await createServerSupabaseClient()
  if (
    !(await postojiRed(
      supabase.from("ugovori").select("id").eq("id", id).eq("klijent_id", klijent_id).maybeSingle(),
    ))
  ) {
    return { ok: false, message: t("zapisNePostoji") }
  }
  const { data: obrisano, error } = await supabase
    .from("ugovori")
    .delete()
    .eq("id", id)
    .eq("klijent_id", klijent_id)
    .select("id")
  if (error) return { ok: false, message: friendlyDbError(error) }
  if (nijeObrisano(obrisano)) return { ok: false, message: t("brisanjeNijeDozvoljeno") }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

// ─── Kontakt osobe ────────────────────────────────────────────────────────────

const kontaktFields = {
  ime: z.string().min(1, t("imeObavezno")).max(200),
  funkcija: optionalText(120),
  telefon: optionalText(60),
  email: optionalEmail(200),
  // Prazan string iz selecta = „Sve lokacije — kontakt firme" → upisuje se NULL.
  // Bazna brava (fk na lokacije(id, klijent_id)) hvata pokušaj vezivanja za tuđu lokaciju.
  lokacija_id: z.union([z.string().uuid(), z.literal("")]).optional(),
  // Yoink 2026-07-30, stavka 7: kontakt forma može odmah kreirati novu lokaciju
  // umjesto da korisnik prvo ide u tab Lokacije.
  // "firma" = izričit izbor „Sve lokacije — kontakt firme" (lokacija_id = null).
  // Postoji zbog firme BEZ ijedne lokacije: tamo se Select ne renderuje, pa bez
  // ove grane kontakt firme ne bi bio unosiv (regresija C1, 2026-07-30).
  lokacija_izbor: z.enum(["postojeca", "nova", "firma"]).optional(),
  nova_lokacija_naziv: optionalText(200),
  nova_lokacija_grad: optionalText(120),
  nova_lokacija_adresa: optionalText(300),
}
const createKontaktSchema = z.object({ klijent_id: z.string().uuid(), ...kontaktFields })
const updateKontaktSchema = z.object({ id: z.string().uuid(), klijent_id: z.string().uuid(), ...kontaktFields })
const deleteKontaktSchema = z.object({ id: z.string().uuid(), klijent_id: z.string().uuid() })

export async function createKontakt(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = createKontaktSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { klijent_id, ...f } = parsed.data
  const supabase = await createServerSupabaseClient()
  // App-nivo dedup (S8.7) — v. createLokacija (uklj. S1 provjeru greške).
  const { data: postojeci, error: dupErr } = await supabase.from("kontakt_osobe").select("id, ime").eq("klijent_id", klijent_id)
  if (dupErr) return { ok: false, message: friendlyDbError(dupErr) }
  if ((postojeci ?? []).some((k) => normalizujNaziv(k.ime) === normalizujNaziv(f.ime))) {
    return { ok: false, errors: { ime: [t("kontaktPostoji")] } }
  }

  // Yoink 2026-07-30, stavka 7: kontakt može povući novu lokaciju sa sobom.
  // Ista dedup provjera kao createLokacija — bez nje se ista lokacija unese
  // dvaput samo zbog razmaka ili veličine slova.
  // „firma" je izričit izbor kontakta firme — zanemari eventualni zaostali
  // lokacija_id iz formData da izbor ne bi tiho ostao vezan za lokaciju.
  let lokacijaId = f.lokacija_izbor === "firma" ? null : f.lokacija_id || null
  if (f.lokacija_izbor === "nova") {
    const naziv = (f.nova_lokacija_naziv ?? "").trim()
    if (!naziv) return { ok: false, errors: { nova_lokacija_naziv: [t("lokacijaNazivObavezan")] } }

    const { data: postojeceLokacije, error: dupLokErr } = await supabase
      .from("lokacije").select("id, naziv").eq("klijent_id", klijent_id)
    if (dupLokErr) return { ok: false, message: friendlyDbError(dupLokErr) }

    const vec = (postojeceLokacije ?? []).find((l) => normalizujNaziv(l.naziv) === normalizujNaziv(naziv))
    if (vec) {
      // Lokacija sa tim nazivom već postoji → veži se na nju umjesto duplikata.
      lokacijaId = vec.id
    } else {
      const { data: nova, error: lokErr } = await supabase.from("lokacije").insert({
        klijent_id,
        naziv,
        grad: f.nova_lokacija_grad ?? null,
        adresa: f.nova_lokacija_adresa ?? null,
      }).select("id").single()
      if (lokErr) return { ok: false, message: friendlyDbError(lokErr) }
      lokacijaId = nova.id
    }
  }

  const { error } = await supabase.from("kontakt_osobe").insert({
    klijent_id, ime: f.ime, funkcija: f.funkcija ?? null, telefon: f.telefon ?? null, email: f.email ?? null,
    lokacija_id: lokacijaId,
  })
  if (error) return { ok: false, message: friendlyDbError(error) }
  // 'layout' revalidira i /klijenti listu (broj_lokacija count, kad se kreira
  // nova lokacija zajedno sa kontaktom) i /klijenti/[id] detalje.
  revalidatePath("/klijenti", "layout")
  return { ok: true }
}

export async function updateKontakt(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = updateKontaktSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { id, klijent_id, ...f } = parsed.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("kontakt_osobe").update({
    ime: f.ime, funkcija: f.funkcija ?? null, telefon: f.telefon ?? null, email: f.email ?? null,
    lokacija_id: f.lokacija_id || null,
  }).eq("id", id).eq("klijent_id", klijent_id)
  if (error) return { ok: false, message: friendlyDbError(error) }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}

export async function deleteKontakt(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = deleteKontaktSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, message: t("neispravanZahtjev") }
  const { id, klijent_id } = parsed.data
  const supabase = await createServerSupabaseClient()
  if (
    !(await postojiRed(
      supabase.from("kontakt_osobe").select("id").eq("id", id).eq("klijent_id", klijent_id).maybeSingle(),
    ))
  ) {
    return { ok: false, message: t("zapisNePostoji") }
  }
  const { data: obrisano, error } = await supabase
    .from("kontakt_osobe")
    .delete()
    .eq("id", id)
    .eq("klijent_id", klijent_id)
    .select("id")
  if (error) return { ok: false, message: friendlyDbError(error) }
  if (nijeObrisano(obrisano)) return { ok: false, message: t("brisanjeNijeDozvoljeno") }
  revalidatePath(`/klijenti/${klijent_id}`)
  return { ok: true }
}
