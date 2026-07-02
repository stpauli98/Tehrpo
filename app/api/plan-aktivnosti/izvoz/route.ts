import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { parsePlanFilteri, applyPlanFilteri } from "@/lib/plan-filteri"
import { planToXlsx } from "@/lib/plan-izvoz/xlsx"
import { planToPdf } from "@/lib/plan-izvoz/pdf"
import type { PlanRed } from "@/lib/plan-izvoz/types"
import { formatDatum, MONTHS_BS, tekuciNarednomMjesecuRange } from "@/lib/date"
import { STATUS_LABEL, toDerivedStatus } from "@/lib/termini"
import { APP_NAME } from "@/lib/brand"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function periodLabel(mjesec: string, godina: number): string {
  if (mjesec === "tn") {
    const { from, to } = tekuciNarednomMjesecuRange()
    const fromY = Number(from.slice(0, 4))
    const fromM = Number(from.slice(5, 7)) - 1 // 0-indexed → MONTHS_BS
    const toY = Number(to.slice(0, 4))
    const toM = Number(to.slice(5, 7)) - 1
    if (fromY === toY) return `${MONTHS_BS[fromM]}–${MONTHS_BS[toM]} ${fromY}`
    return `${MONTHS_BS[fromM]} ${fromY} – ${MONTHS_BS[toM]} ${toY}`
  }
  if (mjesec === "svi") return "svi mjeseci"
  const mn = Number(mjesec)
  return mn >= 1 && mn <= 12 ? `${MONTHS_BS[mn - 1]} ${godina}` : "svi mjeseci"
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

  const rows: PlanRed[] = (data ?? []).map((t) => ({
    klijent: t.klijent_naziv ?? "—",
    lokacija: t.lokacija_naziv ?? "—",
    usluga: t.vrsta_naziv ?? "—",
    rok: formatDatum(t.rok_dospijeca),
    status: STATUS_LABEL[toDerivedStatus(t.status_izvedeni)],
    periodikaMj: t.interval_mjeseci ?? null,
    odgovorna: t.zaduzeni ?? "—",
    nacin: t.nacin_izvrsenja === "pracenje" ? "Praćenje" : "Izvršava",
  }))

  const meta = { naslov: APP_NAME, period: periodLabel(f.mjesec, f.godina) }
  let buf: Buffer
  try {
    buf = format === "pdf" ? await planToPdf(rows, meta) : await planToXlsx(rows, meta)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Greška"
    return NextResponse.json({ error: `Greška pri generisanju fajla: ${message}` }, { status: 500 })
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
