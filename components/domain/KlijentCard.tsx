import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Users, MapPin, AlertTriangle, CircleCheck } from "lucide-react"
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
    // klik bi se borio sa navigacijom kartice.
    <div className="relative h-full">
      <Link
        href={href(`/klijenti/${klijent.id}`)}
        data-testid="klijent-card"
        data-aktivan={aktivan ? "1" : "0"}
        className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-xl"
      >
        <Card
          className={cn(
            "h-full transition motion-reduce:transition-none hover:ring-foreground/20 hover:shadow-sm",
            // Ugašen klijent ostaje vidljiv i otvoriv (istorija i dokumenti su tu),
            // samo je prigušen da se na prvi pogled razlikuje od aktivnih.
            !aktivan && "opacity-60",
          )}
        >
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <h3 className="font-semibold text-foreground leading-tight truncate">{klijent.naziv}</h3>
                <TipOdnosaBadge tip={(klijent.tip_odnosa as "ugovor" | "ponuda" | null) ?? null} />
              </div>
              {/* Kasni badge UVIJEK prikazan (spec §7.2 E); crven kad >0, neutralan kad 0 */}
              <span
                data-testid="klijent-kasni-badge"
                data-kasni={kasni}
                className={cn(
                  "inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset",
                  kasni > 0
                    ? "bg-destructive/10 text-destructive ring-destructive/20"
                    : "bg-muted text-muted-foreground ring-border"
                )}
              >
                {kasni > 0 ? (
                  <AlertTriangle className="w-3 h-3" aria-hidden />
                ) : (
                  <CircleCheck className="w-3 h-3" aria-hidden />
                )}
                {t("kasniBadge", { count: kasni })}
              </span>
            </div>
            {/* pr-32 ostavlja mjesto prekidaču koji lebdi iznad donjeg desnog ugla */}
            <div className="flex items-center gap-4 border-t border-border/60 pt-3 pr-32 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" aria-hidden />
                {t("lokacija", { count: klijent.broj_lokacija ?? 0 })}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="w-3.5 h-3.5" aria-hidden />
                {t("aktivnih", { count: klijent.broj_aktivnih ?? 0 })}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {t("ukupno", { count: klijent.broj_termina ?? 0 })}
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>
      <div className="absolute bottom-3.5 right-4">
        <KlijentAktivanPrekidac klijentId={klijent.id ?? ""} aktivan={aktivan} />
      </div>
    </div>
  )
}
