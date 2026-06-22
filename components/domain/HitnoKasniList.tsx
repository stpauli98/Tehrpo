import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { formatDatum } from "@/lib/date"
import type { HitnoKasniItem } from "@/lib/termini"

export function HitnoKasniList({
  items,
  ukupnoPredstojeci,
}: {
  items: HitnoKasniItem[]
  ukupnoPredstojeci: number
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4" data-testid="hitno-kasni-list">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-red-600" aria-hidden />
        <h2 className="font-semibold">Hitno / kasni</h2>
      </div>
      {items.length === 0 ? (
        <p data-testid="hitno-kasni-empty" className="text-sm text-slate-500">
          Nema hitnih ni kasnih termina.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((t) => (
            <li key={t.id}>
              <Link
                href={`/termini?klijent_id=${t.klijent_id}`}
                data-testid="hitno-kasni-row"
                className="flex items-center justify-between py-2 hover:bg-slate-50 -mx-2 px-2 rounded"
              >
                <span>
                  <span className="font-medium">{t.klijent_naziv}</span>
                  <span className="block text-xs text-slate-500">{t.vrsta_naziv}</span>
                </span>
                <span
                  className={
                    t.status_izvedeni === "kasni"
                      ? "text-sm text-red-600"
                      : "text-sm text-slate-600"
                  }
                >
                  {formatDatum(t.rok_dospijeca)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-400">
        + {ukupnoPredstojeci} termina dospijeva u narednih 30 dana
      </p>
    </div>
  )
}
