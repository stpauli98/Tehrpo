import { NextRequest, NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import type { TerminRow } from "@/components/domain/TerminiTable"
import type { Database } from "@/db/types"

type DokumentRow = Database["public"]["Tables"]["dokumenti"]["Row"]

// S1: ruta nikad ne vraća sirovi PostgrestError niti englesku poruku —
// samo `{ error: <i18n string> }`.
const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "common" })
const tPlan = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "plan.api" })

/**
 * GET /api/plan-aktivnosti/detail?id=<terminId>
 *
 * Returns the full termin detail for the TerminSheet:
 *   {
 *     termin:   TerminRow | null
 *     istorija: TerminRow[]   – last 5 executed cycles for same klijent+vrsta
 *     dokumenti: DokumentiRow[]
 *   }
 *
 * Used by all three plan-aktivnosti views (lista, matrica, kalendar) to open
 * the detail sheet on the client without a server round-trip on the parent view.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: tPlan("nedostajeId") }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()

  const { data: terminData, error } = await supabase
    .from("termini_view")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
  }

  const termin = (terminData as TerminRow | null)

  if (!termin) {
    return NextResponse.json({ termin: null, istorija: [], dokumenti: [] })
  }

  // S1: greške pod-upita se NE gutaju kroz `r.data ?? []` — prazna istorija/dokumenti
  // moraju značiti „nema redova", nikad „upit je pao".
  const [istorijaRes, dokumentiRes] = await Promise.all([
    termin.klijent_id && termin.vrsta_provjere_id
      ? supabase
          .from("termini_view")
          .select("*")
          .eq("klijent_id", termin.klijent_id)
          .eq("vrsta_provjere_id", termin.vrsta_provjere_id)
          .eq("status", "izvrseno")
          .neq("id", termin.id ?? "")
          .order("datum_izvrsenja", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] as TerminRow[], error: null }),
    supabase
      .from("dokumenti")
      .select("*")
      .eq("termin_id", id)
      .order("uploaded_at", { ascending: false }),
  ])

  if (istorijaRes.error || dokumentiRes.error) {
    return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
  }

  return NextResponse.json({
    termin,
    istorija: (istorijaRes.data ?? []) as TerminRow[],
    dokumenti: (dokumentiRes.data ?? []) as DokumentRow[],
  })
}
