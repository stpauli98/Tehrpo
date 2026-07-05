import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { monthName } from "@/lib/date"
import { cn } from "@/lib/utils"
import { href } from "@/i18n/routes"

export type OpterecenjeRow = {
  mjesec: number
  ukupno: number
  izvrseno: number
  kasni: number
  u_planu: number
}

// Horizontalne vodilice (u %) — daju grafiku prirodnu "mrežu" za čitanje visina.
const GRIDLINES = [0, 25, 50, 75, 100]

function LegendaStavka({ boja, tekst }: { boja: string; tekst: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2.5 w-2.5 rounded-full", boja)} />
      {tekst}
    </span>
  )
}

export async function OpterecenjeChart({
  data,
  currentMonth,
  godina,
}: {
  data: OpterecenjeRow[]
  currentMonth?: number
  // Kad je zadana godina, svaki mjesec je link na Prikaz "Po mjesecu" za taj mjesec.
  godina?: number
}) {
  const t = await getTranslations("pregled.opterecenje")
  // Popuni svih 12 mjeseci (RPC vraća samo mjesece sa podacima)
  const byMonth = new Map(data.map((r) => [r.mjesec, r]))
  const months = Array.from({ length: 12 }, (_, i) => byMonth.get(i + 1) ?? {
    mjesec: i + 1, ukupno: 0, izvrseno: 0, kasni: 0, u_planu: 0,
  })
  // Visina bara = zbir VIDLJIVIH segmenata (izvrseno+kasni+u_planu), NE ukupno
  // (ukupno može uključivati 'otkazano' koji nema segment → gap na vrhu). Tako visina = popunjenost.
  const seg = (m: OpterecenjeRow) => m.izvrseno + m.kasni + m.u_planu
  const max = Math.max(1, ...months.map(seg))

  return (
    <div data-testid="opterecenje-chart">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">{t("naslov")}</p>
          <p className="text-xs text-slate-400">{t("podnaslov")}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <LegendaStavka boja="bg-emerald-500" tekst={t("legenda.izvrseno")} />
          <LegendaStavka boja="bg-rose-500" tekst={t("legenda.kasni")} />
          <LegendaStavka boja="bg-sky-400" tekst={t("legenda.uPlanu")} />
        </div>
      </div>

      <div className="relative h-56">
        {/* Vodilice iza barova */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {GRIDLINES.map((p) => (
            <div
              key={p}
              className={cn(
                "absolute inset-x-0 border-t",
                p === 100 ? "border-slate-200" : "border-dashed border-slate-100",
              )}
              style={{ top: `${p}%` }}
            />
          ))}
        </div>

        {/* Barovi */}
        <div className="relative flex h-full items-end gap-2">
          {months.map((m) => {
            const naziv = monthName(m.mjesec)
            const pct = (seg(m) / max) * 100
            const jeTekuci = currentMonth === m.mjesec
            const bar = (
              <div
                className={cn(
                  "flex w-full flex-col-reverse overflow-hidden rounded-t-md shadow-sm transition-[height] duration-500",
                  jeTekuci && "ring-2 ring-brand ring-offset-1",
                )}
                // Min 4% da i mali mjeseci ostanu vidljivi; 0 mjeseci → bez bara.
                style={{ height: `${seg(m) > 0 ? Math.max(pct, 4) : 0}%` }}
                title={t("barTitle", { naziv, count: m.ukupno })}
              >
                {/* stacked: izvrseno (zeleno) → kasni (crveno) → u_planu (plavo, na vrhu) */}
                <div className="w-full bg-emerald-500" style={{ flexGrow: m.izvrseno }} />
                <div className="w-full bg-rose-500" style={{ flexGrow: m.kasni }} />
                <div className="w-full bg-sky-400" style={{ flexGrow: m.u_planu }} />
              </div>
            )
            const common = "group flex h-full flex-1 items-end"
            return godina ? (
              <Link
                key={m.mjesec}
                href={href(`/plan-aktivnosti?view=matrica&mode=mjesec&godina=${godina}&mjesec=${m.mjesec}`)}
                data-testid="chart-bar"
                data-mjesec={m.mjesec}
                data-ukupno={m.ukupno}
                aria-label={t("barAriaLabel", { naziv, count: m.ukupno })}
                className={cn(common, "cursor-pointer rounded-md transition-colors hover:bg-slate-100/60")}
              >
                {bar}
              </Link>
            ) : (
              <div
                key={m.mjesec}
                data-testid="chart-bar"
                data-mjesec={m.mjesec}
                data-ukupno={m.ukupno}
                className={common}
              >
                {bar}
              </div>
            )
          })}
        </div>
      </div>

      {/* Oznake mjeseci, poravnate sa barovima */}
      <div className="mt-2 flex gap-2">
        {months.map((m) => {
          const naziv = monthName(m.mjesec)
          return (
            <span
              key={m.mjesec}
              className={cn(
                "flex-1 text-center text-[11px] capitalize",
                currentMonth === m.mjesec ? "font-semibold text-brand" : "text-slate-400",
              )}
            >
              {naziv.slice(0, 3)}
            </span>
          )
        })}
      </div>
    </div>
  )
}
