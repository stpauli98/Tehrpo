'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { buildZapisnikDocx } from "@/lib/zapisnik/template"
import { snimiZapisnikDokument } from "@/lib/zapisnik/snimi"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "asistent.actions" })

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const schema = z.object({
  termin_id: z.string().uuid(t("neispravanTermin")),
  nalaz: z.string().min(1).max(8000),
  zakljucak: z.string().min(1).max(8000),
})

/** Two-step potvrda: snima predloženi (AI) zapisnik kao .docx u Storage + dokumenti red. */
export async function snimiZapisnik(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  // Sva tri polja su `hidden` (dolaze iz AI prijedloga) — korisnik ih ne može ispraviti,
  // pa inline per-field greška nema smisla: vraća se `message` koji ide u toast (S2).
  if (!parsed.success) return { ok: false, message: t("neispravniPodaci") }
  const { termin_id, nalaz, zakljucak } = parsed.data

  const supabase = await createServerSupabaseClient()
  const { data: term, error: termErr } = await supabase
    .from("termini_view")
    .select("klijent_id, klijent_naziv, lokacija_naziv, vrsta_naziv, datum_izvrsenja")
    .eq("id", termin_id)
    .maybeSingle()
  // S1: pad upita nije isto što i „nema reda" — bez ove grane oboje bi javljalo
  // „Termin ne postoji", pa bi kvar baze izgledao kao pogrešan podatak u prijedlogu.
  if (termErr) return { ok: false, message: t("greskaCitanja") }
  if (!term || !term.klijent_id) return { ok: false, message: t("terminNePostoji") }

  const datum = (term.datum_izvrsenja ?? new Date().toISOString()).slice(0, 10)
  const docx = await buildZapisnikDocx({
    klijent: term.klijent_naziv ?? "—",
    lokacija: term.lokacija_naziv ?? null,
    vrstaProvjere: term.vrsta_naziv ?? "—",
    datum,
    zaduzeni: null,
    nalaz,
    zakljucak,
  })
  const snimljeno = await snimiZapisnikDokument(supabase, {
    terminId: termin_id,
    klijentId: term.klijent_id,
    vrstaNaziv: term.vrsta_naziv,
    datum,
    docx,
    uploadGreskaFallback: t("snimanjeNijeUspjelo"),
  })
  if (!snimljeno.ok) return snimljeno

  revalidatePath("/zapisnici")
  if (term.klijent_id) revalidatePath(`/klijenti/${term.klijent_id}`)
  return { ok: true }
}
