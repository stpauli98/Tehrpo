import Link from "next/link"
import { MapPin } from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { ObilasciToolbar } from "@/components/domain/ObilasciToolbar"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { groupByGrad, type ObilazakItem } from "@/lib/obilasci"
import { periodRange, currentYear, todayIso, formatDatum } from "@/lib/date"

export default async function ObilasciPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const period = (typeof sp.period === "string" ? sp.period : "mjesec") as "mjesec" | "kvartal" | "godina"
  const godina = Number(typeof sp.godina === "string" ? sp.godina : "") || currentYear()
  const today = todayIso()
  const mjesec = Number(typeof sp.mjesec === "string" ? sp.mjesec : "") || Number(today.slice(5, 7))
  const kvartal = Number(typeof sp.kvartal === "string" ? sp.kvartal : "") || 1

  const { od, do: doIso } = periodRange(period, godina, mjesec, kvartal)

  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from("termini_view")
    .select("id, klijent_id, klijent_naziv, vrsta_naziv, lokacija_naziv, lokacija_grad, rok_dospijeca, status_izvedeni")
    .gte("rok_dospijeca", od)
    .lte("rok_dospijeca", doIso)
    .order("lokacija_grad", { ascending: true })
    .order("rok_dospijeca", { ascending: true })

  const grupe = groupByGrad((data ?? []) as ObilazakItem[])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Obilasci</h1>
        <p className="text-sm text-slate-500">Grupisano po gradu za efikasniji raspored izlazaka.</p>
      </div>

      <ObilasciToolbar
        period={period}
        godina={godina}
        mjesec={mjesec}
        kvartal={kvartal}
      />

      {grupe.length === 0 ? (
        <div
          data-testid="obilasci-empty"
          className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500"
        >
          Nema termina u izabranom periodu.
        </div>
      ) : (
        grupe.map((g) => (
          <section key={g.grad} data-testid="obilasci-grupa" className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-red-600" aria-hidden />
              <h2 className="font-semibold">{g.grad}</h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {g.items.map((t) => (
                <Link
                  key={t.id}
                  href={`/termini?klijent_id=${t.klijent_id}`}
                  data-testid="obilasci-card"
                  className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50"
                >
                  <span>
                    <span className="font-medium">{t.klijent_naziv}</span>
                    <span className="block text-xs text-slate-500">
                      {t.vrsta_naziv}{t.lokacija_naziv ? ` · ${t.lokacija_naziv}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-sm text-slate-600">
                    {formatDatum(t.rok_dospijeca)}
                    <StatusBadge status={t.status_izvedeni} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
