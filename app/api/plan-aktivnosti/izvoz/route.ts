import { NextRequest, NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import type { PostgrestFilterBuilder } from "@supabase/supabase-js"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { parsePlanFilteri, applyPlanFilteri, applyPlanFilteriBezDatuma } from "@/lib/plan-filteri"
import { parseIzvozParams, type IzvozOpseg } from "@/lib/plan-izvoz/params"
import {
  izvozPeriodRange,
  izvozPeriodLabel,
  prenesenoOrIzraz,
  jePreneseniRed,
} from "@/lib/plan-izvoz/period"
import { planToXlsx } from "@/lib/plan-izvoz/xlsx"
import { planToPdf } from "@/lib/plan-izvoz/pdf"
import { povuciSveStranice, IZVOZ_MAX_REDOVA, IZVOZ_STRANICA } from "@/lib/plan-izvoz/stranicenje"
import type { PlanRed } from "@/lib/plan-izvoz/types"
import { formatDatum, monthName, tekuciNarednomMjesecuRange } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import { APP_NAME } from "@/lib/brand"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import { smijeTrenutniPreuzeti } from "@/lib/auth/zahtijevaj-preuzimanje"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const tStatus = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "status" })
const tIzvoz = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "izvoz.plan" })
// S1: ruta vraća jedinstven `{ error: <i18n string> }` envelope (nikad `greska`, nikad sirovi PG tekst).
const tCommon = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "common" })

/** Legacy label (mjesec=tn/svi/1-12) — zadržan radi backward-compat. */
function legacyPeriodLabel(mjesec: string, godina: number): string {
  if (mjesec === "tn") {
    const { from, to } = tekuciNarednomMjesecuRange()
    const fromY = Number(from.slice(0, 4))
    const fromM = Number(from.slice(5, 7))
    const toY = Number(to.slice(0, 4))
    const toM = Number(to.slice(5, 7))
    if (fromY === toY) return `${monthName(fromM)}–${monthName(toM)} ${fromY}`
    return `${monthName(fromM)} ${fromY} – ${monthName(toM)} ${toY}`
  }
  if (mjesec === "svi") return tIzvoz("sviMjeseci")
  const mn = Number(mjesec)
  return mn >= 1 && mn <= 12 ? `${monthName(mn)} ${godina}` : tIzvoz("sviMjeseci")
}

/**
 * Ne-legacy grana: opseg-filteri (bez datuma) + period-raspon. Dijele count i fajl grana.
 * `raspon` se računa JEDNOM u GET-u (mod "om" zavisi od današnjeg dana — dva poziva
 * na prelazu ponoći dala bi count i fajl iz različitih mjeseci).
 * Kad je `preneseno` uključen, uz period se povlače i otvorene obaveze ispod donje
 * granice — inače 01.01. iz godišnjeg plana ispadne sve zaostalo iz prethodne godine.
 */
function applyIzvozNeLegacy<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Q extends PostgrestFilterBuilder<any, any, any, any, any>,
>(
  q: Q,
  opseg: IzvozOpseg,
  raspon: { from: string; to: string } | null,
  sp: URLSearchParams,
  preneseno: boolean,
): Q {
  let out = q
  if (opseg === "filtrirano") out = applyPlanFilteriBezDatuma(out, parsePlanFilteri(sp))
  if (raspon) {
    out = preneseno
      ? out.or(prenesenoOrIzraz(raspon.from, raspon.to))
      : out.gte("datum_prikaza", raspon.from).lte("datum_prikaza", raspon.to)
  }
  return out
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const parsed = parseIzvozParams(sp)
  if (!parsed.ok) {
    return NextResponse.json({ error: tIzvoz("raspon.nevazeci") }, { status: 400 })
  }

  // `pregled` je čisto čitanje na ekranu — bez izvoza plana (potvrđeno 30.07.2026.).
  if (!(await smijeTrenutniPreuzeti())) {
    return NextResponse.json({ error: tCommon("izvozNijeDozvoljen") }, { status: 403 })
  }

  const supabase = await createServerSupabaseClient()

  // Jedan snapshot raspona za obje grane. `granica` = donja ivica perioda; sve otvoreno
  // ispod nje je PRENESENO (null → nema prenosa: legacy, mod "svi" ili preneseno=0).
  const raspon = parsed.legacy ? null : izvozPeriodRange(parsed.period)
  const granica = !parsed.legacy && parsed.preneseno && raspon ? raspon.from : null

  // Count grana: samo broj (head), bez povlačenja redova.
  if (parsed.count) {
    let cq = supabase.from("termini_view").select("*", { count: "exact", head: true })
    if (parsed.legacy) {
      cq = applyPlanFilteri(cq, parsePlanFilteri(sp))
    } else {
      cq = applyIzvozNeLegacy(cq, parsed.opseg, raspon, sp, parsed.preneseno)
    }
    const { count, error } = await cq
    if (error) return NextResponse.json({ error: tCommon("greskaUcitavanja") }, { status: 500 })
    // C4: brojač MORA nositi i granicu — inače modal pokaže pun broj iznad dugmeta
    // koje će vratiti 413, pa korisnik ne zna zašto.
    const broj = count ?? 0
    return NextResponse.json({
      broj,
      granica: IZVOZ_MAX_REDOVA,
      prekoracenje: broj > IZVOZ_MAX_REDOVA,
    })
  }

  // Fajl grana.
  let period: string
  if (parsed.legacy) {
    const f = parsePlanFilteri(sp)
    period = legacyPeriodLabel(f.mjesec, f.godina)
  } else {
    period = izvozPeriodLabel(parsed.period, tIzvoz("sviMjeseci"))
  }

  /**
   * C4: svaka stranica je ZASEBAN upit — PostgREST bez `.range()` vraća najviše
   * `max-rows` (1000) redova i tiho odsijeca ostatak. Upit se gradi iznova za svaku
   * stranicu jer je PostgREST builder jednokratan.
   *
   * Sekundarni `order("id")` je OBAVEZAN: `datum_prikaza` nije jedinstven, a bez
   * totalnog poretka Postgres smije vratiti redove sa istim datumom u različitom
   * redoslijedu po stranici → duplikati i preskočeni redovi na granicama stranica.
   */
  const gradiUpit = () => {
    const q = supabase
      .from("termini_view")
      .select("*")
      .order("datum_prikaza", { ascending: true })
      .order("id", { ascending: true })
    return parsed.legacy
      ? applyPlanFilteri(q, parsePlanFilteri(sp))
      : applyIzvozNeLegacy(q, parsed.opseg, raspon, sp, parsed.preneseno)
  }

  const rezultat = await povuciSveStranice(
    (od, doIndeks) => gradiUpit().range(od, doIndeks),
    { stranica: IZVOZ_STRANICA, maks: IZVOZ_MAX_REDOVA },
  )
  if (!rezultat.ok) {
    // Radije jasno ODBIJ nego tiho isporuči krnji plan koji ide klijentu kao cio.
    if (rezultat.razlog === "previse") {
      return NextResponse.json(
        { error: tIzvoz("previseRedova", { granica: rezultat.granica }) },
        { status: 413 },
      )
    }
    return NextResponse.json({ error: tCommon("greskaUcitavanja") }, { status: 500 })
  }

  const rows: PlanRed[] = rezultat.redovi.map((red) => ({
    klijent: red.klijent_naziv ?? "—",
    lokacija: red.lokacija_naziv ?? "—",
    usluga: red.vrsta_naziv ?? "—",
    rok: formatDatum(red.rok_dospijeca),
    preneseno: jePreneseniRed(red, granica),
    status: tStatus(toDerivedStatus(red.status_izvedeni)),
    periodikaMj: red.interval_mjeseci ?? null,
    odgovorna: red.zaduzeni ?? "—",
    nacin: red.nacin_izvrsenja === "pracenje" ? tIzvoz("nacin.pracenje") : tIzvoz("nacin.izvrsava"),
  }))

  // Napomena samo kad je zaista nešto preneseno — inače je šum na štampi.
  const brojPrenesenih = rows.filter((r) => r.preneseno).length
  const meta = {
    naslov: APP_NAME,
    period,
    napomena:
      granica && brojPrenesenih > 0
        ? tIzvoz("prenesenoNapomena", { broj: brojPrenesenih, datum: formatDatum(granica) })
        : undefined,
  }
  let buf: Buffer
  try {
    buf = parsed.format === "pdf" ? await planToPdf(rows, meta) : await planToXlsx(rows, meta)
  } catch (e) {
    const message = e instanceof Error ? e.message : tIzvoz("greska")
    return NextResponse.json({ error: tIzvoz("greskaGenerisanje", { poruka: message }) }, { status: 500 })
  }
  const ext = parsed.format === "pdf" ? "pdf" : "xlsx"
  const ct = parsed.format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  const slug = meta.period.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": ct, "Content-Disposition": `attachment; filename="plan-aktivnosti-${slug}.${ext}"` },
  })
}
