import { NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

// S1: ruta nikad ne vraća sirovi PostgrestError — samo `{ error: <i18n string> }`.
const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "common" })

/**
 * GET /api/plan-aktivnosti/form-podaci
 *
 * Skupovi za "Novi termin" formu VAN lista view-a (kalendar "+" na danu) — isti
 * selecti kao meta dio lista rute (lista/route.ts), ali bez termina/paginacije.
 * RLS scope-uje klijente/lokacije po pozivaocu.
 */
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const [klijentiRes, vrsteRes, lokacijeRes] = await Promise.all([
    supabase.from("klijenti").select("id, naziv").order("naziv"),
    supabase.from("vrste_provjera").select("id, naziv").eq("aktivna", true).order("naziv"),
    supabase.from("lokacije").select("id, naziv, klijent_id").order("naziv"),
  ])

  if (klijentiRes.error || vrsteRes.error || lokacijeRes.error) {
    return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
  }

  return NextResponse.json({
    klijenti: klijentiRes.data ?? [],
    vrste: vrsteRes.data ?? [],
    lokacije: lokacijeRes.data ?? [],
  })
}
