import Link from "next/link"
import { Calendar, AlertTriangle, CheckCircle, Clock } from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { StatCard } from "@/components/domain/StatCard"
import { OpterecenjeChart, type OpterecenjeRow } from "@/components/domain/OpterecenjeChart"
import { HitnoKasniList } from "@/components/domain/HitnoKasniList"
import { getPredstojeciCount, getHitnoKasni } from "@/lib/termini"
import { currentYear, todayIso } from "@/lib/date"

export default async function PregledPage() {
  const supabase = await createServerSupabaseClient()
  const godina = currentYear()
  const mjesec = Number(todayIso().slice(5, 7))

  const [statsRes, opterecenjeRes, predstojeci, hitnoKasni] = await Promise.all([
    supabase.rpc("get_termini_stats"),
    supabase.rpc("get_opterecenje", { godina }),
    getPredstojeciCount(supabase),
    getHitnoKasni(supabase),
  ])

  const stats = (statsRes.data?.[0] ?? {
    ukupno: 0,
    ovog_mjeseca: 0,
    kasni: 0,
    izvrseno_ovog_mjeseca: 0,
  }) as {
    ukupno: number
    ovog_mjeseca: number
    kasni: number
    izvrseno_ovog_mjeseca: number
  }
  const opterecenje = (opterecenjeRes.data ?? []) as OpterecenjeRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pregled</h1>
        <p className="text-sm text-slate-500">Rokovi i opterećenje</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Klikabilne: vode na filter koji TAČNO odgovara broju na kartici */}
        <Link href={`/plan-aktivnosti?view=lista&mjesec=${mjesec}`} className="block" aria-label="Termini ovog mjeseca">
          <StatCard
            label="Termini ovog mjeseca"
            value={stats.ovog_mjeseca}
            sub="rok dospijeća ovaj mjesec"
            icon={Calendar}
            interactive
            testId="stat-card"
          />
        </Link>
        <Link href="/plan-aktivnosti?view=lista&status=kasni&mjesec=svi" className="block" aria-label="Kasni rokovi">
          <StatCard
            label="Kasni rokovi"
            value={stats.kasni}
            tone="danger"
            sub="zahtijevaju akciju"
            icon={AlertTriangle}
            interactive
            testId="stat-card"
          />
        </Link>
        {/* Neklikabilne: metrika nema 1:1 filter u Termini listi (mjeri se po
            datumu izvršenja / prozoru od 30 dana), pa ne vode na pogrešan prikaz */}
        <StatCard
          label="Izvršeni ovog mjeseca"
          value={stats.izvrseno_ovog_mjeseca}
          tone="success"
          sub="završeno ovaj mjesec"
          icon={CheckCircle}
          testId="stat-card"
        />
        <StatCard
          label="Predstojeći (30 dana)"
          value={predstojeci}
          tone="warning"
          sub="još neizvršeni"
          icon={Clock}
          testId="stat-card"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 p-4" data-testid="dashboard-chart">
          <OpterecenjeChart
            data={opterecenje}
            currentMonth={mjesec}
            godina={godina}
          />
        </div>
        <HitnoKasniList
          items={hitnoKasni}
          ukupnoKasni={stats.kasni}
          today={todayIso()}
        />
      </div>
    </div>
  )
}
