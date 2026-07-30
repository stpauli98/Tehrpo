import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Calendar, AlertTriangle, CheckCircle, Clock } from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { StatCard } from "@/components/domain/StatCard"
import { OpterecenjeChart, type OpterecenjeRow } from "@/components/domain/OpterecenjeChart"
import { HitnoKasniList } from "@/components/domain/HitnoKasniList"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"
import { getPredstojeciCount, getHitnoKasni } from "@/lib/queries/pregled"
import { todayIso } from "@/lib/date"
import { href } from "@/i18n/routes"
import { cn, FOCUS_RING } from "@/lib/utils"

export default async function PregledPage() {
  const t = await getTranslations("pregled")
  const supabase = await createServerSupabaseClient()
  // Godina i mjesec IZ ISTOG izvora — jedan poziv `todayIso()` (zidni datum po
  // APP_TIME_ZONE, SQL parnjak `(now() at time zone 'Europe/Belgrade')::date`);
  // dva odvojena čitanja sata bi oko Nove godine mogla dati prsten „tekućeg
  // mjeseca" na pogrešnom baru (nova godina + mjesec 12).
  const danas = todayIso()
  const godina = Number(danas.slice(0, 4))
  const mjesec = Number(danas.slice(5, 7))

  const [statsRes, opterecenjeRes, predstojeciRes, hitnoKasniRes] = await Promise.all([
    supabase.rpc("get_termini_stats"),
    supabase.rpc("get_opterecenje", { godina }),
    getPredstojeciCount(supabase),
    getHitnoKasni(supabase),
  ])

  const zaglavlje = (
    <div>
      <h1 className="text-2xl font-semibold">{t("naslov")}</h1>
      <p className="text-sm text-muted-foreground">{t("podnaslov")}</p>
    </div>
  )

  // S1: pad bilo kog od 4 upita → jasna greška umjesto lažnih nula i prazne liste.
  // Parcijalni prikaz se namjerno ne renderuje — pola tačnih brojki je gore od greške.
  const greska =
    statsRes.error ?? opterecenjeRes.error ?? predstojeciRes.error ?? hitnoKasniRes.error
  if (greska) {
    return (
      <div className="space-y-6">
        {zaglavlje}
        <GreskaUcitavanja />
      </div>
    )
  }

  // Ispod ove tačke su svi upiti uspjeli, pa su `??` fallback-ovi samo type-narrowing
  // (prazan rezultat je stvarno prazno stanje, ne maskirana greška).
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
  const predstojeci = predstojeciRes.count ?? 0
  const hitnoKasni = hitnoKasniRes.data ?? []
  const terminiLabel = t("statCard.terminiOvogMjeseca.label")
  const kasniLabel = t("statCard.kasniRokovi.label")

  return (
    <div className="space-y-6">
      {zaglavlje}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Klikabilne: vode na filter koji TAČNO odgovara broju na kartici */}
        <Link href={href(`/plan-aktivnosti?view=lista&mjesec=${mjesec}`)} className={cn("block rounded-xl", FOCUS_RING)} aria-label={terminiLabel}>
          <StatCard
            label={terminiLabel}
            value={stats.ovog_mjeseca}
            sub={t("statCard.terminiOvogMjeseca.sub")}
            icon={Calendar}
            interactive
            testId="stat-card"
          />
        </Link>
        <Link href={href("/plan-aktivnosti?view=lista&status=kasni&mjesec=svi")} className={cn("block rounded-xl", FOCUS_RING)} aria-label={kasniLabel}>
          <StatCard
            label={kasniLabel}
            value={stats.kasni}
            tone="danger"
            sub={t("statCard.kasniRokovi.sub")}
            icon={AlertTriangle}
            interactive
            testId="stat-card"
          />
        </Link>
        {/* Neklikabilne: metrika nema 1:1 filter u Termini listi (mjeri se po
            datumu izvršenja / prozoru od 30 dana), pa ne vode na pogrešan prikaz */}
        <StatCard
          label={t("statCard.izvrseniOvogMjeseca.label")}
          value={stats.izvrseno_ovog_mjeseca}
          tone="success"
          sub={t("statCard.izvrseniOvogMjeseca.sub")}
          icon={CheckCircle}
          testId="stat-card"
        />
        <StatCard
          label={t("statCard.predstojeci.label")}
          value={predstojeci}
          tone="warning"
          sub={t("statCard.predstojeci.sub")}
          icon={Clock}
          testId="stat-card"
        />
      </div>

      <HitnoKasniList
        items={hitnoKasni}
        ukupnoKasni={stats.kasni}
        today={danas}
      />

      {/* Grafik na dnu, pune širine — pregledniji uvid u godišnje opterećenje */}
      <div
        className="rounded-xl ring-1 ring-foreground/10 bg-card p-4"
        data-testid="dashboard-chart"
      >
        <OpterecenjeChart
          data={opterecenje}
          currentMonth={mjesec}
          godina={godina}
        />
      </div>
    </div>
  )
}
