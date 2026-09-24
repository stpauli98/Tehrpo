import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Users, MapPin, CalendarDays } from "lucide-react"
import type { Database } from "@/db/types"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { TipOdnosaBadge } from "@/components/domain/TipOdnosaBadge"
import { KlijentAktivanPrekidac } from "@/components/domain/KlijentAktivanPrekidac"
import { href } from "@/i18n/routes"

export type KlijentRow = Database["public"]["Views"]["klijenti_view"]["Row"]

export async function KlijentCard({ klijent }: { klijent: KlijentRow }) {
  const t = await getTranslations("klijenti.karta")
  const kasni = klijent.broj_kasni ?? 0
  // `aktivan` je NOT NULL u bazi; view ga tipizira kao nullable, pa null → aktivan
  // (isto ponašanje kao prije uvođenja kolone — ništa se ne gasi samo od sebe).
  const aktivan = klijent.aktivan ?? true
  return (
    // Prekidač je BRAT anchora, ne dijete: dugme unutar <a> je nevalidan HTML i
    // klik bi se borio sa navigacijom kartice. Anchor pokriva samo gornji dio
    // kartice, pa prekidač u podnožju više ne mora da lebdi iznad njega.
    <Card
      data-aktivan={aktivan ? "1" : "0"}
      className={cn(
        // py-0/gap-0 gase vlastiti `py-(--card-spacing)` Card-a: raspored je full-bleed
        // (podnožje ide do ivice), pa bi default padding ostavio mrtvu traku ispod.
        "h-full flex flex-col overflow-hidden py-0 gap-0 transition motion-reduce:transition-none",
        "hover:ring-foreground/20 hover:shadow-sm",
        // Ugašen klijent ostaje vidljiv i otvoriv (istorija i dokumenti su tu),
        // samo je prigušen da se na prvi pogled razlikuje od aktivnih.
        !aktivan && "opacity-60",
      )}
    >
      <CardContent className="p-0 flex flex-col h-full">
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0">
            <Link
              href={href(`/klijenti/${klijent.id}`)}
              data-testid="klijent-card"
              data-aktivan={aktivan ? "1" : "0"}
              className="block p-4 pb-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-t-xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground leading-tight truncate">{klijent.naziv}</h3>
                  {/* Tiha varijanta: jedini akcenat na kartici je broj koji kasni. */}
                  <TipOdnosaBadge
                    tip={(klijent.tip_odnosa as "ugovor" | "ponuda" | null) ?? null}
                    variant="tekst"
                  />
                </div>
                {/* Kasni UVIJEK prikazan (spec §7.2 E); brojka nosi težinu, label je titl. */}
                <div
                  data-testid="klijent-kasni-badge"
                  data-kasni={kasni}
                  className="shrink-0 text-right leading-none"
                >
                  <div
                    className={cn(
                      "text-2xl font-semibold tabular-nums",
                      kasni > 0 ? "text-destructive" : "text-muted-foreground/50",
                    )}
                  >
                    {kasni}
                  </div>
                  <div
                    className={cn(
                      "mt-1 text-[11px]",
                      kasni > 0 ? "text-destructive/80" : "text-muted-foreground",
                    )}
                  >
                    {t("kasniLabel")}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  <span className="tabular-nums">{t("lokacija", { count: klijent.broj_lokacija ?? 0 })}</span>
                </span>
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <Users className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  <span className="tabular-nums">{t("aktivnih", { count: klijent.broj_aktivnih ?? 0 })}</span>
                </span>
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <CalendarDays className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  <span className="tabular-nums">{t("ukupno", { count: klijent.broj_termina ?? 0 })}</span>
                </span>
              </div>
            </Link>
          </div>
        </div>

        {/* Podnožje: kontrola dobija svoj red umjesto da lebdi nad sadržajem. */}
        <div className="border-t border-border/60 px-4 py-2">
          <KlijentAktivanPrekidac klijentId={klijent.id ?? ""} aktivan={aktivan} />
        </div>
      </CardContent>
    </Card>
  )
}
