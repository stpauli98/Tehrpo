'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import {
  uploadDokument,
  removeDokument,
  ALLOWED_MIME,
  MAX_BYTES,
} from "@/lib/supabase/storage"
import { generateZapisnik } from "@/lib/zapisnik/generate"
import { buildZapisnikDocx } from "@/lib/zapisnik/template"
import { dokumentStoragePath, jeValidanTip } from "@/lib/dokumenti"

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "dokument"
}

function revalidateDokumenti(klijentId?: string | null): void {
  revalidatePath("/zapisnici")
  if (klijentId) revalidatePath(`/klijenti/${klijentId}`)
}

const uploadSchema = z.object({ termin_id: z.string().uuid("Termin je obavezan") })

export async function uploadDokumentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = uploadSchema.safeParse({ termin_id: formData.get("termin_id") })
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { termin_id } = parsed.data

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Izaberite fajl." }
  }
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return { ok: false, message: "Nedozvoljen tip fajla (docx, pdf, png, jpeg, webp)." }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: "Fajl je veći od 10 MB." }
  }

  const supabase = await createServerSupabaseClient()
  const { data: termin } = await supabase
    .from("termini")
    .select("id, klijent_id")
    .eq("id", termin_id)
    .maybeSingle()
  if (!termin) return { ok: false, message: "Termin ne postoji." }

  const naziv = safeName(file.name)
  const path = `termini/${termin_id}/${crypto.randomUUID()}-${naziv}`
  const bytes = Buffer.from(await file.arrayBuffer())

  try {
    await uploadDokument(path, bytes, file.type)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Upload nije uspio." }
  }

  const { error } = await supabase.from("dokumenti").insert({
    termin_id,
    klijent_id: termin.klijent_id,
    naziv,
    storage_path: path,
    mime_type: file.type,
    velicina_bajt: file.size,
    tip: "strucni_nalaz",
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

const genSchema = z.object({ termin_id: z.string().uuid("Termin je obavezan") })

export async function generateZapisnikAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = genSchema.safeParse({ termin_id: formData.get("termin_id") })
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { termin_id } = parsed.data

  const supabase = await createServerSupabaseClient()
  const { data: t } = await supabase
    .from("termini_view")
    .select("klijent_id, klijent_naziv, lokacija_naziv, vrsta_naziv, datum_izvrsenja, zaduzeni, status")
    .eq("id", termin_id)
    .maybeSingle()
  if (!t || !t.klijent_id) return { ok: false, message: "Termin ne postoji." }

  // Zapisnik dokumentuje IZVRŠENU provjeru — ne generiši za otkazane/neizvršene termine
  if (t.status !== "izvrseno") {
    return { ok: false, message: "Zapisnik se generiše samo za izvršen termin." }
  }

  const datum = (t.datum_izvrsenja ?? new Date().toISOString()).slice(0, 10)
  const content = await generateZapisnik({
    klijent: t.klijent_naziv ?? "—",
    lokacija: t.lokacija_naziv ?? null,
    vrstaProvjere: t.vrsta_naziv ?? "—",
    datum,
    zaduzeni: t.zaduzeni ?? null,
  })

  const docx = await buildZapisnikDocx({
    klijent: t.klijent_naziv ?? "—",
    lokacija: t.lokacija_naziv ?? null,
    vrstaProvjere: t.vrsta_naziv ?? "—",
    datum,
    zaduzeni: t.zaduzeni ?? null,
    nalaz: content.nalaz,
    zakljucak: content.zakljucak,
  })

  const naziv = `Zapisnik - ${t.vrsta_naziv ?? "provjera"} - ${datum}.docx`
  const path = `termini/${termin_id}/zapisnik-${crypto.randomUUID()}.docx`

  try {
    await uploadDokument(path, docx, DOCX_MIME)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Generisanje nije uspjelo." }
  }

  const { error } = await supabase.from("dokumenti").insert({
    termin_id,
    klijent_id: t.klijent_id,
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

  revalidateDokumenti(t.klijent_id)
  return { ok: true }
}

const delSchema = z.object({ dokument_id: z.string().uuid() })

export async function deleteDokumentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = delSchema.safeParse({ dokument_id: formData.get("dokument_id") })
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { dokument_id } = parsed.data

  const supabase = await createServerSupabaseClient()
  const { data: dok } = await supabase
    .from("dokumenti")
    .select("storage_path, klijent_id")
    .eq("id", dokument_id)
    .maybeSingle()
  if (!dok) return { ok: false, message: "Dokument ne postoji." }

  // App-level cleanup: prvo fajl, pa red (orphan red gori od orphan fajla).
  try {
    await removeDokument(dok.storage_path)
  } catch (cleanupErr) {
    console.error("Brisanje fajla iz Storage-a nije uspjelo (orphan):", cleanupErr)
  }
  const { error } = await supabase.from("dokumenti").delete().eq("id", dokument_id)
  if (error) return { ok: false, message: error.message }

  revalidateDokumenti(dok.klijent_id)
  return { ok: true }
}

// ─── Upload na nivou klijenta / ugovora (ne mora biti vezan za termin) ────────

const uploadKlijentSchema = z.object({
  klijent_id: z.string().uuid("Klijent je obavezan"),
  ugovor_id: z.union([z.string().uuid(), z.literal("").transform(() => undefined)]).optional(),
  tip: z.string().refine(jeValidanTip, "Neispravan tip"),
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
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { klijent_id, ugovor_id, tip } = parsed.data

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Izaberite fajl." }
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return { ok: false, message: "Nedozvoljen tip fajla (docx, pdf, png, jpeg, webp)." }
  }
  if (file.size > MAX_BYTES) return { ok: false, message: "Fajl je veći od 10 MB." }

  const supabase = await createServerSupabaseClient()
  // Pristup PRIJE upload-a u storage: RLS vraća null ako korisnik nema pristup klijentu
  // → izbjegava tranzitni orphan blob za neovlaštenog korisnika.
  const { data: kl } = await supabase.from("klijenti").select("id").eq("id", klijent_id).maybeSingle()
  if (!kl) return { ok: false, message: "Klijent ne postoji ili nemate pristup." }
  // Integritet: ako je dat ugovor, mora pripadati klijentu
  if (ugovor_id) {
    const { data: ug } = await supabase.from("ugovori").select("id").eq("id", ugovor_id).eq("klijent_id", klijent_id).maybeSingle()
    if (!ug) return { ok: false, message: "Ugovor ne pripada klijentu." }
  }

  const naziv = safeName(file.name)
  const path = ugovor_id
    ? dokumentStoragePath({ ugovorId: ugovor_id }, naziv)
    : dokumentStoragePath({ klijentId: klijent_id }, naziv)
  const bytes = Buffer.from(await file.arrayBuffer())

  try {
    await uploadDokument(path, bytes, file.type)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Upload nije uspio." }
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
