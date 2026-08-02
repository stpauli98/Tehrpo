import "server-only"
import { createTranslator } from "next-intl"
import type { SupabaseClient } from "@supabase/supabase-js"
import { uploadDokument, removeDokument } from "@/lib/supabase/storage"
import { APP_LOCALE } from "@/lib/locale"
import { formatDatum } from "@/lib/date"
import { getMessages } from "@/i18n/messages"
import { zapisnikDryRun, type ZapisnikIzvor } from "./content"
import type { Database } from "@/db/types"

const tIzvoz = createTranslator({
  locale: APP_LOCALE,
  messages: getMessages(),
  namespace: "izvoz.zapisnik",
})

/** MIME .docx dokumenata — jedini izvor za cijelu aplikaciju (S15). */
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/**
 * Snima generisani zapisnik (.docx) u Storage + red u `dokumenti`.
 *
 * Jedan izvor za oba puta snimanja — `dokumenti/actions.ts` (Generiši zapisnik) i
 * `asistent/actions.ts` (Snimi zapisnik) — pa je ime fajla i18n na oba mjesta (N18/N19).
 *
 * Insert ide PROSLIJEĐENIM (SSR/RLS) klijentom; `revalidatePath` ostaje pozivaocu.
 */
export async function snimiZapisnikDokument(
  supabase: SupabaseClient<Database>,
  opts: {
    terminId: string
    klijentId: string
    vrstaNaziv: string | null
    datum: string
    docx: Buffer
    /**
     * Porijeklo sadržaja (N11) — upisuje se u `dokumenti.zapisnik_izvor`.
     *
     * Kad ga pozivalac ne proslijedi, izvodi se iz okruženja: ako zapisnik u ovoj
     * instalaciji uopšte NE MOŽE biti model-generisan (nema ANTHROPIC_API_KEY ili je
     * ZAPISNIK_DRY_RUN=1), sadržaj je šablonski.
     *
     * NE dira `generated_by_ai` — ta kolona odgovara na drugo pitanje („je li dokument
     * generisan ili otpremljen?") i za svaki zapisnik iz ovog puta je tačno. Ranije je
     * ovdje stajalo `generated_by_ai: izvor === "model"`, čime je šablonski zapisnik
     * postajao neraspoznatljiv od ručno otpremljenog dokumenta — druga neistina umjesto prve.
     */
    izvor?: ZapisnikIzvor
    /** i18n fallback pozivaoca kad Storage padne bez `Error` poruke (namespace mu je vlastiti). */
    uploadGreskaFallback: string
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { terminId, klijentId, vrstaNaziv, datum, docx, uploadGreskaFallback } = opts
  const izvor: ZapisnikIzvor = opts.izvor ?? (zapisnikDryRun() ? "sablon" : "model")

  // `datum` je interno ISO ("YYYY-MM-DD"); ime fajla nosi standard prikaza dd.MM.yyyy
  const naziv = tIzvoz("imeFajla", {
    vrsta: vrstaNaziv ?? tIzvoz("provjeraFallback"),
    datum: formatDatum(datum),
  })
  const path = `termini/${terminId}/zapisnik-${crypto.randomUUID()}.docx`

  try {
    await uploadDokument(path, docx, DOCX_MIME)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : uploadGreskaFallback }
  }

  const { error } = await supabase.from("dokumenti").insert({
    termin_id: terminId,
    klijent_id: klijentId,
    naziv,
    storage_path: path,
    mime_type: DOCX_MIME,
    velicina_bajt: docx.length,
    tip: "zapisnik",
    generated_by_ai: true,
    zapisnik_izvor: izvor,
  })
  if (error) {
    try {
      await removeDokument(path) // rollback fajla ako DB upis padne
    } catch (cleanupErr) {
      console.error("Rollback brisanja fajla nije uspio (orphan):", cleanupErr)
    }
    return { ok: false, message: error.message }
  }

  return { ok: true }
}
