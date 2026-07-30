import { NextRequest, NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { monthRange, todayIso } from "@/lib/date"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

// S1: ruta nikad ne vraća sirovi PostgrestError — samo `{ error: <i18n string> }`.
const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "common" })

/**
 * GET /api/plan-aktivnosti/kalendar
 *
 * Query params (mirror _views/kalendar.tsx searchParams):
 *   godina – year (default current year derived from todayIso(), APP_TIME_ZONE)
 *   mjesec – "1".."12" (default current month; clamped 1–12)
 *
 * Returns:
 *   {
 *     termini: TerminRow[]  – all columns from termini_view for the month,
 *                             ordered by datum_prikaza ascending
 *   }
 *
 * termini element fields (full termini_view select *):
 *   id, rok_dospijeca, klijent_id, klijent_naziv, lokacija_id, lokacija_naziv,
 *   vrsta_provjere_id, vrsta_naziv, status_izvedeni, datum_izvrsenja, …
 *   (all columns exposed by the termini_view DB view)
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const sp = req.nextUrl.searchParams

  const today = todayIso()
  const godina = Number(sp.get("godina")) || Number(today.slice(0, 4))
  const mjesecRaw = Number(sp.get("mjesec")) || Number(today.slice(5, 7))
  const mjesec = Math.min(12, Math.max(1, mjesecRaw))

  const { from, to } = monthRange(godina, mjesec)

  const { data, error } = await supabase
    .from("termini_view")
    .select("*")
    .gte("datum_prikaza", from)
    .lte("datum_prikaza", to)
    .order("datum_prikaza")

  if (error) {
    return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
  }

  return NextResponse.json({ termini: data ?? [] })
}
