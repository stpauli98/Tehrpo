import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { AlertTriangle } from "lucide-react"
import { rokDatumOznaka, rokRelativnaOznaka } from "@/lib/hitno"
import type { HitnoKasniItem } from "@/lib/queries/pregled"
import { cn, FOCUS_RING } from "@/lib/utils"
import { href } from "@/i18n/routes"

const TONE: Record<"danger" | "warning", string> = {
  danger: "text-destructive",
  warning: "text-warning",
}

export async function HitnoKasniList({
  items,
  ukupnoKasni,
  today,
}: {
  items: HitnoKasniItem[]
  ukupnoKasni: number
  today: string
}) {
  const t = await getTranslations("pregled.hitnoKasni")
  return (
    <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4" data-testid="hitno-kasni-list">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-[18px] w-[18px] shrink-0 text-destructive" aria-hidden />
        <h2 className="font-heading text-base font-medium">{t("naslov")}</h2>
      </div>
      {items.length === 0 ? (
        <p data-testid="hitno-kasni-empty" className="text-sm text-muted-foreground">
          {t("prazno")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const oznaka = rokRelativnaOznaka(item.rok_dospijeca, today)
            return (
              <li key={item.id}>
                <Link
                  href={href(`/plan-aktivnosti?view=lista&selected=${item.id}&mjesec=svi`)}
                  data-testid="hitno-kasni-row"
                  className={cn(
                    "flex items-center justify-between gap-2 py-2 hover:bg-muted -mx-2 px-2 rounded",
                    FOCUS_RING,
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.klijent_naziv}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.vrsta_naziv}
                      {item.lokacija_naziv ? ` · ${item.lokacija_naziv}` : ""}
                    </span>
                  </span>
                  {/* Pun datum je vidljiv tekst, ne `title` — tooltip ne postoji za
                      tastaturu ni za čitače ekrana (S12). Kad je termin prezakazan,
                      vide se OBA datuma: „kasni N" mjeri rok, a zakazani datum objašnjava
                      zašto red i dalje stoji crven iako je izlazak dogovoren. */}
                  <span className="shrink-0 text-right">
                    <span className={cn("block text-sm font-medium", TONE[oznaka.tone])}>
                      {oznaka.text}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {rokDatumOznaka(item.rok_dospijeca, item.datum_zakazan)}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {ukupnoKasni > 0 && (
        <Link
          href={href("/plan-aktivnosti?view=lista&status=kasni&mjesec=svi")}
          data-testid="hitno-kasni-footer"
          className={cn("mt-3 inline-block rounded-sm text-xs text-brand hover:underline", FOCUS_RING)}
        >
          {t("footer", { count: ukupnoKasni })}
        </Link>
      )}
    </div>
  )
}
