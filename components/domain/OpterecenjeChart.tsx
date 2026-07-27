import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { monthName } from "@/lib/date"
import { cn, FOCUS_RING } from "@/lib/utils"
import { href } from "@/i18n/routes"
import { STATUS_DOT_CLASS } from "@/lib/termini"

// Boje segmenata čitaju se iz jedinog izvora status-boja (STATUS_DOT_CLASS):
// izvrseno=zelena, kasni=crvena, u planu=planirano/plava.
const CHART_BOJE = {
  izvrseno: STATUS_DOT_CLASS.izvrseno,
  kasni: STATUS_DOT_CLASS.kasni,
  uPlanu: STATUS_DOT_CLASS.planirano,
} as const

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
  const prazno = months.every((m) => seg(m) === 0)

  return (
    <div data-testid="opterecenje-chart">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-base font-medium text-foreground">{t("naslov")}</h2>
          <p className="text-xs text-muted-foreground">{t("podnaslov")}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <LegendaStavka boja={CHART_BOJE.izvrseno} tekst={t("legenda.izvrseno")} />
          <LegendaStavka boja={CHART_BOJE.kasni} tekst={t("legenda.kasni")} />
          <LegendaStavka boja={CHART_BOJE.uPlanu} tekst={t("legenda.uPlanu")} />
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
                p === 100 ? "border-border" : "border-dashed border-border",
              )}
              style={{ top: `${p}%` }}
            />
          ))}
        </div>

        {/* Empty state godine — overlay, NE zamjena barova: 12 `chart-bar`
            elemenata mora ostati u DOM-u (navigacija po mjesecima i dalje radi). */}
        {prazno && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {t("prazno")}
          </p>
        )}

        {/* Barovi */}
        <div className="relative flex h-full items-end gap-2">
          {months.map((m) => {
            const naziv = monthName(m.mjesec)
            const pct = (seg(m) / max) * 100
            const jeTekuci = currentMonth === m.mjesec
            // Labela broji ISTO što se i vidi (seg), ne `m.ukupno` iz RPC-a —
            // `ukupno` uključuje otkazane, koji nemaju segment u baru.
            const vidljivo = seg(m)
            const bar = (
              <div
                className={cn(
                  "flex w-full flex-col-reverse overflow-hidden rounded-t-md shadow-sm transition-[height] duration-500 motion-reduce:transition-none",
                  jeTekuci && "ring-2 ring-brand ring-offset-1",
                )}
                // Min 4% da i mali mjeseci ostanu vidljivi; 0 mjeseci → bez bara.
                style={{ height: `${seg(m) > 0 ? Math.max(pct, 4) : 0}%` }}
                title={t("barTitle", { naziv, count: vidljivo })}
              >
                {/* stacked: izvrseno (zeleno) → kasni (crveno) → u_planu (plavo, na vrhu) */}
                <div className={cn("w-full", CHART_BOJE.izvrseno)} style={{ flexGrow: m.izvrseno }} />
                <div className={cn("w-full", CHART_BOJE.kasni)} style={{ flexGrow: m.kasni }} />
                <div className={cn("w-full", CHART_BOJE.uPlanu)} style={{ flexGrow: m.u_planu }} />
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
                aria-label={t("barAriaLabel", { naziv, count: vidljivo })}
                className={cn(
                  common,
                  "cursor-pointer rounded-md transition-colors motion-reduce:transition-none hover:bg-muted/60",
                  FOCUS_RING,
                )}
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
                "flex-1 text-center text-xs capitalize",
                currentMonth === m.mjesec ? "font-semibold text-brand" : "text-muted-foreground",
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
