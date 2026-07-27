import { NextRequest, NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { parsePlanFilteri, applyPlanFilteri, TERMINI_PER_PAGE } from "@/lib/plan-filteri"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

// S1: ruta nikad ne vraća sirovi PostgrestError — samo `{ error: <i18n string> }`.
const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "common" })

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const sp = req.nextUrl.searchParams

  const pageNum = Math.max(1, Number(sp.get("page") ?? "1") || 1)
  const from = (pageNum - 1) * TERMINI_PER_PAGE
  const to = from + TERMINI_PER_PAGE - 1

  const f = parsePlanFilteri(sp)

  let listQuery = supabase
    .from("termini_view")
    .select("*", { count: "exact" })
    .order("datum_prikaza", { ascending: true })

  listQuery = applyPlanFilteri(listQuery, f)

  listQuery = listQuery.range(from, to)

  // NB: `get_termini_stats` se ovdje NE zove — nijedan Plan view ne prikazuje stats,
  // a RPC agregira cijelu tabelu na svaki zahtjev liste (i njegov pad je obarao listu).
  // RPC ostaje u bazi: koristi ga tab Pregled (`pregled/page.tsx`).
  const [listRes, klijentiRes, vrsteRes, lokacijeRes] = await Promise.all([
    listQuery,
    supabase.from("klijenti").select("id, naziv").order("naziv"),
    supabase.from("vrste_provjera").select("id, naziv").eq("aktivna", true).order("naziv"),
    supabase.from("lokacije").select("id, naziv, klijent_id").order("naziv"),
  ])

  const meta = { klijentiRes, vrsteRes, lokacijeRes }
  const prviErr = listRes.error
    ?? Object.values(meta).map((r) => r.error).find(Boolean)
  if (prviErr) {
    return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
  }

  return NextResponse.json({
    rows: listRes.data ?? [],
    total: listRes.count ?? 0,
    klijenti: klijentiRes.data ?? [],
    vrste: vrsteRes.data ?? [],
    lokacije: lokacijeRes.data ?? [],
  })
}
