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

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "dokument"
}

function revalidateDokumenti(klijentId?: string | null): void {
  revalidatePath("/termini")
  revalidatePath("/zapisnici")
  revalidatePath("/plan")
  revalidatePath("/prikaz")
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
    return { ok: false, message: "Fajl je veći od 50 MB." }
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
    naziv,
    storage_path: path,
    mime_type: file.type,
    velicina_bajt: file.size,
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
    .select("klijent_id, klijent_naziv, lokacija_naziv, vrsta_naziv, datum_izvrsenja, zaduzeni")
    .eq("id", termin_id)
    .maybeSingle()
  if (!t) return { ok: false, message: "Termin ne postoji." }

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
    naziv,
    storage_path: path,
    mime_type: DOCX_MIME,
    velicina_bajt: docx.length,
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
    .select("storage_path, termin_id")
    .eq("id", dokument_id)
    .maybeSingle()
  if (!dok) return { ok: false, message: "Dokument ne postoji." }

  // klijent_id preko zasebnog upita (BEZ embed-a) — dokumenti↔termini ima dvostruku
  // FK relaciju u tipovima (termini + termini_view) pa embed kardinalnost nije pouzdana.
  const { data: termin } = await supabase
    .from("termini")
    .select("klijent_id")
    .eq("id", dok.termin_id)
    .maybeSingle()

  // App-level cleanup: prvo fajl, pa red (orphan red gori od orphan fajla).
  try {
    await removeDokument(dok.storage_path)
  } catch (cleanupErr) {
    console.error("Brisanje fajla iz Storage-a nije uspjelo (orphan):", cleanupErr)
  }
  const { error } = await supabase.from("dokumenti").delete().eq("id", dokument_id)
  if (error) return { ok: false, message: error.message }

  revalidateDokumenti(termin?.klijent_id ?? null)
  return { ok: true }
}
