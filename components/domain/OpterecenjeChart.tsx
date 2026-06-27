import Link from "next/link"
import { MONTHS_BS } from "@/lib/date"
import { cn } from "@/lib/utils"

export type OpterecenjeRow = {
  mjesec: number
  ukupno: number
  izvrseno: number
  kasni: number
  u_planu: number
}

export function OpterecenjeChart({
  data, currentMonth, godina,
}: {
  data: OpterecenjeRow[]
  currentMonth?: number
  // Kad je zadana godina, svaki mjesec je link na Prikaz "Po mjesecu" za taj mjesec.
  godina?: number
}) {
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
      <p className="text-sm font-semibold text-slate-700 mb-3">Opterećenje po mjesecima (broj termina)</p>
      <div className="flex items-end gap-2 h-44">
        {months.map((m) => {
          const naziv = MONTHS_BS[m.mjesec - 1] ?? ""
          const inner = (
            <>
              <div className="w-full mt-auto flex flex-col-reverse" style={{ height: `${(seg(m) / max) * 100}%` }} title={`${naziv}: ${m.ukupno}`}>
                {/* stacked: izvrseno (zeleno), kasni (crveno), u_planu (plavo) */}
                <div className="w-full bg-green-500" style={{ flexGrow: m.izvrseno }} />
                <div className="w-full bg-red-500" style={{ flexGrow: m.kasni }} />
                <div className={cn("w-full rounded-t bg-blue-500", currentMonth === m.mjesec && "ring-2 ring-brand")} style={{ flexGrow: m.u_planu }} />
              </div>
              <span className="text-[10px] text-slate-400">{naziv.slice(0, 3)}</span>
            </>
          )
          const common = "flex-1 self-stretch flex flex-col items-center gap-1"
          return godina ? (
            <Link
              key={m.mjesec}
              href={`/plan-aktivnosti?view=matrica&mode=mjesec&godina=${godina}&mjesec=${m.mjesec}`}
              data-testid="chart-bar"
              data-mjesec={m.mjesec}
              data-ukupno={m.ukupno}
              aria-label={`${naziv}: ${m.ukupno} termina — otvori mjesec u matrici`}
              className={cn(common, "cursor-pointer rounded transition hover:bg-slate-50")}
            >
              {inner}
            </Link>
          ) : (
            <div key={m.mjesec} data-testid="chart-bar" data-mjesec={m.mjesec} data-ukupno={m.ukupno} className={common}>
              {inner}
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" />Izvršeno</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 inline-block" />Kasni</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block" />U planu</span>
      </div>
    </div>
  )
}
