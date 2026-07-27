'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { uploadDokument, removeDokument } from "@/lib/supabase/storage"
import { generateZapisnik } from "@/lib/zapisnik/generate"
import { buildZapisnikDocx } from "@/lib/zapisnik/template"
import {
  dokumentStoragePath,
  jeValidanTip,
  safeName,
  validirajFajl,
  MAX_MB,
} from "@/lib/dokumenti"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { jeAdmin } from "@/lib/auth/roles"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "dokumenti" })
const tIzvoz = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "izvoz.zapisnik" })

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

function revalidateDokumenti(klijentId?: string | null): void {
  revalidatePath("/zapisnici")
  if (klijentId) revalidatePath(`/klijenti/${klijentId}`)
}

const uploadSchema = z.object({
  termin_id: z.string().uuid(t("terminObavezan")),
  tip: z.string().refine(jeValidanTip, t("tipNeispravan")),
})

export async function uploadDokumentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = uploadSchema.safeParse({
    termin_id: formData.get("termin_id"),
    // default čuva ponašanje starih formi/testova bez `tip` polja
    tip: formData.get("tip") ?? "strucni_nalaz",
  })
  if (!parsed.success) {
    // Hidden polja (termin_id/dokument_id/klijent_id) korisnik ne može ispraviti → `message`
    // je smisleni kanal (toast); `errors` ostaju za polja koja bira (tip) i dijagnostiku (S2).
    return { ok: false, message: t("neispravniPodaci"), errors: parsed.error.flatten().fieldErrors }
  }
  const { termin_id, tip } = parsed.data

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: t("izaberiteFajl") }
  }
  const provjera = validirajFajl(file)
  if (!provjera.ok) {
    return {
      ok: false,
      message:
        provjera.razlog === "tip" ? t("nedozvoljenTip") : t("fajlPrevelik", { max: MAX_MB }),
    }
  }

  const supabase = await createServerSupabaseClient()
  const { data: termin } = await supabase
    .from("termini")
    .select("id, klijent_id")
    .eq("id", termin_id)
    .maybeSingle()
  if (!termin) return { ok: false, message: t("terminNePostoji") }

  const naziv = safeName(file.name)
  const path = `termini/${termin_id}/${crypto.randomUUID()}-${naziv}`
  const bytes = Buffer.from(await file.arrayBuffer())

  try {
    await uploadDokument(path, bytes, file.type)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : t("uploadNijeUspio") }
  }

  const { error } = await supabase.from("dokumenti").insert({
    termin_id,
    klijent_id: termin.klijent_id,
    naziv,
    storage_path: path,
    mime_type: file.type,
    velicina_bajt: file.size,
    tip,
    generated_by_ai: false,
  })
  if (error) {
    try {
      await removeDokument(path) // rollback fajla ako DB upis padne
    } catch (cleanupErr) {
      console.error("Rollback brisanja fajla nije uspio (orphan):", cleanupErr)
    }
    return { ok: false, message: error.message }
  }

  revalidateDokumenti(termin.klijent_id)
  return { ok: true }
}

const genSchema = z.object({ termin_id: z.string().uuid(t("terminObavezan")) })

export async function generateZapisnikAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = genSchema.safeParse({ termin_id: formData.get("termin_id") })
  if (!parsed.success) {
    // Hidden polja (termin_id/dokument_id/klijent_id) korisnik ne može ispraviti → `message`
    // je smisleni kanal (toast); `errors` ostaju za polja koja bira (tip) i dijagnostiku (S2).
    return { ok: false, message: t("neispravniPodaci"), errors: parsed.error.flatten().fieldErrors }
  }
  const { termin_id } = parsed.data

  const supabase = await createServerSupabaseClient()
  const { data: term } = await supabase
    .from("termini_view")
    .select("klijent_id, klijent_naziv, lokacija_naziv, vrsta_naziv, datum_izvrsenja, zaduzeni, status")
    .eq("id", termin_id)
    .maybeSingle()
  if (!term || !term.klijent_id) return { ok: false, message: t("terminNePostoji") }

  // Zapisnik dokumentuje IZVRŠENU provjeru — ne generiši za otkazane/neizvršene termine
  if (term.status !== "izvrseno") {
    return { ok: false, message: t("zapisnikSamoIzvrsen") }
  }

  const datum = (term.datum_izvrsenja ?? new Date().toISOString()).slice(0, 10)
  const content = await generateZapisnik({
    klijent: term.klijent_naziv ?? "—",
    lokacija: term.lokacija_naziv ?? null,
    vrstaProvjere: term.vrsta_naziv ?? "—",
    datum,
    zaduzeni: term.zaduzeni ?? null,
  })

  const docx = await buildZapisnikDocx({
    klijent: term.klijent_naziv ?? "—",
    lokacija: term.lokacija_naziv ?? null,
    vrstaProvjere: term.vrsta_naziv ?? "—",
    datum,
    zaduzeni: term.zaduzeni ?? null,
    nalaz: content.nalaz,
    zakljucak: content.zakljucak,
  })

  const naziv = tIzvoz("imeFajla", { vrsta: term.vrsta_naziv ?? tIzvoz("provjeraFallback"), datum })
  const path = `termini/${termin_id}/zapisnik-${crypto.randomUUID()}.docx`

  try {
    await uploadDokument(path, docx, DOCX_MIME)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : t("generisanjeNijeUspjelo") }
  }

  const { error } = await supabase.from("dokumenti").insert({
    termin_id,
    klijent_id: term.klijent_id,
    naziv,
    storage_path: path,
    mime_type: DOCX_MIME,
    velicina_bajt: docx.length,
    tip: "zapisnik",
    generated_by_ai: true,
  })
  if (error) {
    try {
      await removeDokument(path)
    } catch (cleanupErr) {
      console.error("Rollback brisanja fajla nije uspio (orphan):", cleanupErr)
    }
    return { ok: false, message: error.message }
  }

  revalidateDokumenti(term.klijent_id)
  return { ok: true }
}

const delSchema = z.object({ dokument_id: z.string().uuid() })

export async function deleteDokumentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = delSchema.safeParse({ dokument_id: formData.get("dokument_id") })
  if (!parsed.success) {
    // Hidden polja (termin_id/dokument_id/klijent_id) korisnik ne može ispraviti → `message`
    // je smisleni kanal (toast); `errors` ostaju za polja koja bira (tip) i dijagnostiku (S2).
    return { ok: false, message: t("neispravniPodaci"), errors: parsed.error.flatten().fieldErrors }
  }
  const { dokument_id } = parsed.data

  // Poslovno pravilo: dokumente briše ISKLJUČIVO administrator. Provjera mora biti
  // ovdje (ne samo u RLS-u) jer removeDokument ide service-role klijentom koji RLS zaobilazi.
  const korisnik = await getTrenutniKorisnik()
  if (!korisnik || !jeAdmin(korisnik.uloga)) {
    return { ok: false, message: t("samoAdminBrise") }
  }

  const supabase = await createServerSupabaseClient()
  const { data: dok } = await supabase
    .from("dokumenti")
    .select("storage_path, klijent_id")
    .eq("id", dokument_id)
    .maybeSingle()
  if (!dok) return { ok: false, message: t("dokumentNePostoji") }

  // Prvo DB red pod RLS-om uz potvrdu da je stvarno obrisan, pa tek onda fajl —
  // inače bi korisnik kojem RLS blokira delete (0 pogođenih redova, bez greške)
  // mogao uništiti fajl kroz service-role klijent. Rezidualni rizik je orphan
  // fajl ako storage remove padne poslije DB delete-a (isti toleransni obrazac
  // kao rollback grane upload akcija).
  const { data: deleted, error } = await supabase
    .from("dokumenti")
    .delete()
    .eq("id", dokument_id)
    .select("id")
  if (error) return { ok: false, message: error.message }
  if (!deleted || deleted.length === 0) {
    return { ok: false, message: t("dokumentNePostojiIliNemaPristupa") }
  }
  try {
    await removeDokument(dok.storage_path)
  } catch (cleanupErr) {
    console.error("Brisanje fajla iz Storage-a nije uspjelo (orphan fajl):", cleanupErr)
  }

  revalidateDokumenti(dok.klijent_id)
  return { ok: true }
}

// ─── Upload na nivou klijenta / ugovora (ne mora biti vezan za termin) ────────

const uploadKlijentSchema = z.object({
  klijent_id: z.string().uuid(t("klijentObavezan")),
  ugovor_id: z.union([z.string().uuid(), z.literal("").transform(() => undefined)]).optional(),
  tip: z.string().refine(jeValidanTip, t("tipNeispravan")),
})

export async function uploadKlijentDokumentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = uploadKlijentSchema.safeParse({
    klijent_id: formData.get("klijent_id"),
    ugovor_id: formData.get("ugovor_id") ?? "",
    tip: formData.get("tip") ?? "ostalo",
  })
  if (!parsed.success) {
    // Hidden polja (termin_id/dokument_id/klijent_id) korisnik ne može ispraviti → `message`
    // je smisleni kanal (toast); `errors` ostaju za polja koja bira (tip) i dijagnostiku (S2).
    return { ok: false, message: t("neispravniPodaci"), errors: parsed.error.flatten().fieldErrors }
  }
  const { klijent_id, ugovor_id, tip } = parsed.data

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: t("izaberiteFajl") }
  const provjera = validirajFajl(file)
  if (!provjera.ok) {
    return {
      ok: false,
      message:
        provjera.razlog === "tip" ? t("nedozvoljenTip") : t("fajlPrevelik", { max: MAX_MB }),
    }
  }

  const supabase = await createServerSupabaseClient()
  // Pristup PRIJE upload-a u storage: RLS vraća null ako korisnik nema pristup klijentu
  // → izbjegava tranzitni orphan blob za neovlaštenog korisnika.
  const { data: kl } = await supabase.from("klijenti").select("id").eq("id", klijent_id).maybeSingle()
  if (!kl) return { ok: false, message: t("klijentNePostojiIliNemaPristupa") }
  // Integritet: ako je dat ugovor, mora pripadati klijentu
  if (ugovor_id) {
    const { data: ug } = await supabase.from("ugovori").select("id").eq("id", ugovor_id).eq("klijent_id", klijent_id).maybeSingle()
    if (!ug) return { ok: false, message: t("ugovorNePripadaKlijentu") }
  }

  const naziv = safeName(file.name)
  const path = ugovor_id
    ? dokumentStoragePath({ ugovorId: ugovor_id }, naziv)
    : dokumentStoragePath({ klijentId: klijent_id }, naziv)
  const bytes = Buffer.from(await file.arrayBuffer())

  try {
    await uploadDokument(path, bytes, file.type)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : t("uploadNijeUspio") }
  }

  const { error } = await supabase.from("dokumenti").insert({
    klijent_id,
    ugovor_id: ugovor_id ?? null,
    termin_id: null,
    naziv,
    storage_path: path,
    mime_type: file.type,
    velicina_bajt: file.size,
    tip,
    generated_by_ai: false,
  })
  if (error) {
    try { await removeDokument(path) } catch (e) { console.error("Rollback fajla nije uspio:", e) }
    return { ok: false, message: error.message }
  }

  revalidateDokumenti(klijent_id)
  return { ok: true }
}
