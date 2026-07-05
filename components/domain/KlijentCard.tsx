import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Users, MapPin, AlertTriangle } from "lucide-react"
import type { Database } from "@/db/types"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { TipOdnosaBadge } from "@/components/domain/TipOdnosaBadge"

export type KlijentRow = Database["public"]["Views"]["klijenti_view"]["Row"]

export async function KlijentCard({ klijent }: { klijent: KlijentRow }) {
  const t = await getTranslations("klijenti.karta")
  const kasni = klijent.broj_kasni ?? 0
  return (
    <Link
      href={`/klijenti/${klijent.id}`}
      data-testid="klijent-card"
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-xl"
    >
      <Card className="h-full transition hover:border-slate-300">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-semibold text-slate-900 leading-tight">{klijent.naziv}</h3>
              <TipOdnosaBadge tip={(klijent.tip_odnosa as "ugovor" | "ponuda" | null) ?? null} />
            </div>
            {/* Kasni badge UVIJEK prikazan (spec §7.2 E); crven kad >0, neutralan kad 0 */}
            <span
              data-testid="klijent-kasni-badge"
              data-kasni={kasni}
              className={cn(
                "inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset",
                kasni > 0
                  ? "bg-red-50 text-red-700 ring-red-600/20"
                  : "bg-slate-50 text-slate-500 ring-slate-400/20"
              )}
            >
              <AlertTriangle className="w-3 h-3" aria-hidden />
              {t("kasniBadge", { count: kasni })}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" aria-hidden />
              {t("lokacija", { count: klijent.broj_lokacija ?? 0 })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" aria-hidden />
              {t("aktivnih", { count: klijent.broj_aktivnih ?? 0 })}
            </span>
            <span className={cn("ml-auto tabular-nums", "text-slate-400")}>
              {t("ukupno", { count: klijent.broj_termina ?? 0 })}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
