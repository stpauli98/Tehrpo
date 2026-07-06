import { NextRequest, NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { parsePlanFilteri, applyPlanFilteri } from "@/lib/plan-filteri"
import { planToXlsx } from "@/lib/plan-izvoz/xlsx"
import { planToPdf } from "@/lib/plan-izvoz/pdf"
import type { PlanRed } from "@/lib/plan-izvoz/types"
import { formatDatum, monthName, tekuciNarednomMjesecuRange } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import { APP_NAME } from "@/lib/brand"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const tStatus = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "status" })
const tIzvoz = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "izvoz.plan" })

function periodLabel(mjesec: string, godina: number): string {
  if (mjesec === "tn") {
    const { from, to } = tekuciNarednomMjesecuRange()
    const fromY = Number(from.slice(0, 4))
    const fromM = Number(from.slice(5, 7)) // 1-indeksiran mjesec (monthName očekuje 1..12)
    const toY = Number(to.slice(0, 4))
    const toM = Number(to.slice(5, 7))
    if (fromY === toY) return `${monthName(fromM)}–${monthName(toM)} ${fromY}`
    return `${monthName(fromM)} ${fromY} – ${monthName(toM)} ${toY}`
  }
  if (mjesec === "svi") return tIzvoz("sviMjeseci")
  const mn = Number(mjesec)
  return mn >= 1 && mn <= 12 ? `${monthName(mn)} ${godina}` : tIzvoz("sviMjeseci")
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx"
  const f = parsePlanFilteri(sp)
  const supabase = await createServerSupabaseClient()

  let q = supabase.from("termini_view").select("*").order("rok_dospijeca", { ascending: true })
  q = applyPlanFilteri(q, f)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows: PlanRed[] = (data ?? []).map((red) => ({
    klijent: red.klijent_naziv ?? "—",
    lokacija: red.lokacija_naziv ?? "—",
    usluga: red.vrsta_naziv ?? "—",
    rok: formatDatum(red.rok_dospijeca),
    status: tStatus(toDerivedStatus(red.status_izvedeni)),
    periodikaMj: red.interval_mjeseci ?? null,
    odgovorna: red.zaduzeni ?? "—",
    nacin: red.nacin_izvrsenja === "pracenje" ? tIzvoz("nacin.pracenje") : tIzvoz("nacin.izvrsava"),
  }))

  const meta = { naslov: APP_NAME, period: periodLabel(f.mjesec, f.godina) }
  let buf: Buffer
  try {
    buf = format === "pdf" ? await planToPdf(rows, meta) : await planToXlsx(rows, meta)
  } catch (e) {
    const message = e instanceof Error ? e.message : tIzvoz("greska")
    return NextResponse.json({ error: tIzvoz("greskaGenerisanje", { poruka: message }) }, { status: 500 })
  }
  const ext = format === "pdf" ? "pdf" : "xlsx"
  const ct = format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  const slug = meta.period.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": ct, "Content-Disposition": `attachment; filename="plan-aktivnosti-${slug}.${ext}"` },
  })
}
