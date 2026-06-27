'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { buildZapisnikDocx } from "@/lib/zapisnik/template"
import { uploadDokument, removeDokument } from "@/lib/supabase/storage"

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

const schema = z.object({
  termin_id: z.string().uuid("Neispravan termin"),
  nalaz: z.string().min(1).max(8000),
  zakljucak: z.string().min(1).max(8000),
})

/** Two-step potvrda: snima predloženi (AI) zapisnik kao .docx u Storage + dokumenti red. */
export async function snimiZapisnik(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  const { termin_id, nalaz, zakljucak } = parsed.data

  const supabase = await createServerSupabaseClient()
  const { data: t } = await supabase
    .from("termini_view")
    .select("klijent_id, klijent_naziv, lokacija_naziv, vrsta_naziv, datum_izvrsenja")
    .eq("id", termin_id)
    .maybeSingle()
  if (!t || !t.klijent_id) return { ok: false, message: "Termin ne postoji." }

  const datum = (t.datum_izvrsenja ?? new Date().toISOString()).slice(0, 10)
  const docx = await buildZapisnikDocx({
    klijent: t.klijent_naziv ?? "—",
    lokacija: t.lokacija_naziv ?? null,
    vrstaProvjere: t.vrsta_naziv ?? "—",
    datum,
    zaduzeni: null,
    nalaz,
    zakljucak,
  })
  const naziv = `Zapisnik - ${t.vrsta_naziv ?? "provjera"} - ${datum}.docx`
  const path = `termini/${termin_id}/zapisnik-${crypto.randomUUID()}.docx`

  try {
    await uploadDokument(path, docx, DOCX_MIME)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Snimanje nije uspjelo." }
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
      await removeDokument(path) // rollback fajla ako DB upis padne
    } catch (e) {
      console.error("Rollback brisanja fajla nije uspio (orphan):", e)
    }
    return { ok: false, message: error.message }
  }

  revalidatePath("/zapisnici")
  if (t.klijent_id) revalidatePath(`/klijenti/${t.klijent_id}`)
  return { ok: true }
}
