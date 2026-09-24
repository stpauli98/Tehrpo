import { NextRequest, NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { monthRange, currentYear, todayIso } from "@/lib/date"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

// S1: ruta nikad ne vraća sirovi PostgrestError — samo `{ error: <i18n string> }`.
const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "common" })

/**
 * GET /api/plan-aktivnosti/matrica
 *
 * Query params (mirror _views/matrica.tsx searchParams):
 *   mode    – "klijent" (default) | "mjesec"
 *   klijent – UUID; used when mode="klijent" to filter by klijent_id
 *   godina  – year (default current year)
 *   mjesec  – "1".."12" (default current month); used when mode="mjesec"
 *
 * Returns:
 *   {
 *     termini:   TerminMatricaRow[]  – raw rows from termini_view for the active branch
 *     preneseni: TerminMatricaRow[]  – open obligations carried over from earlier years
 *                                      (mode="klijent" only; [] otherwise)
 *     klijenti:  { id: string, naziv: string }[]  – full klijenti list for the picker
 *   }
 *
 * Branch "mode=mjesec" — termini columns:
 *   id, vrsta_provjere_id, vrsta_naziv, klijent_id, rok_dospijeca, datum_prikaza, status_izvedeni
 *
 * Branch "mode=klijent" (klijent provided) — termini columns:
 *   id, vrsta_provjere_id, vrsta_naziv, rok_dospijeca, datum_prikaza, status_izvedeni
 *   (ordered by vrsta_naziv)
 *
 * If mode="klijent" and no klijent param → termini: []
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const sp = req.nextUrl.searchParams

  const today = todayIso()
  const godina = Number(sp.get("godina")) || currentYear()
  const klijentId = sp.get("klijent") ?? ""
  const mode = sp.get("mode") ?? "klijent"
  const mjesec = Math.min(
    12,
    Math.max(1, Number(sp.get("mjesec")) || Number(today.slice(5, 7)))
  )

  // Always load klijenti list (needed for picker regardless of mode)
  const { data: klijentiData, error: klijentiError } = await supabase
    .from("klijenti")
    .select("id, naziv")
    .order("naziv")

  if (klijentiError) {
    return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
  }

  let termini: unknown[] = []
  // Otvorene obaveze čiji je datum_prikaza PRIJE odabrane godine. Bez njih godišnja
  // matrica 01.01. izgubi sve zaostalo iz prethodne godine (v. audit B2).
  let preneseni: unknown[] = []

  if (mode === "mjesec") {
    // Svi termini za odabrani mjesec — kolone su klijenti
    const { from: od, to: doIso } = monthRange(godina, mjesec)
    const { data, error } = await supabase
      .from("termini_view")
      .select("id, vrsta_provjere_id, vrsta_naziv, klijent_id, rok_dospijeca, datum_prikaza, status_izvedeni")
      .gte("datum_prikaza", od)
      .lte("datum_prikaza", doIso)
    if (error) return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
    termini = data ?? []
  } else if (klijentId) {
    // Godišnja matrica jednog klijenta — kolone su 12 mjeseci
    const { data, error } = await supabase
      .from("termini_view")
      .select("id, vrsta_provjere_id, vrsta_naziv, rok_dospijeca, datum_prikaza, status_izvedeni")
      .eq("klijent_id", klijentId)
      .gte("datum_prikaza", `${godina}-01-01`)
      .lte("datum_prikaza", `${godina}-12-31`)
      .order("vrsta_naziv")
    if (error) return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
    termini = data ?? []

    // Preneseno: otvoreno (ni izvršeno ni otkazano) sa datumom prije 1. januara.
    const { data: prenData, error: prenError } = await supabase
      .from("termini_view")
      .select("id, vrsta_provjere_id, vrsta_naziv, rok_dospijeca, datum_prikaza, status_izvedeni")
      .eq("klijent_id", klijentId)
      .lt("datum_prikaza", `${godina}-01-01`)
      .neq("status_izvedeni", "izvrseno")
      .neq("status_izvedeni", "otkazano")
      .order("datum_prikaza", { ascending: true })
    if (prenError) return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
    preneseni = prenData ?? []
  }
  // else: mode="klijent" without klijentId → termini stays []

  return NextResponse.json({
    termini,
    preneseni,
    klijenti: klijentiData ?? [],
  })
}
