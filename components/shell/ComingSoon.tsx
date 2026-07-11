import type { LucideIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

export async function ComingSoon({
  naslov,
  faza,
  opis,
  icon: Icon,
}: {
  naslov: string
  faza: string
  opis: string
  icon: LucideIcon
}) {
  const t = await getTranslations("shell.comingSoon")
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{naslov}</h1>
      <div
        data-testid="coming-soon"
        className="flex flex-col items-center rounded-xl bg-card p-10 text-center ring-1 ring-foreground/10"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-light text-brand">
          <Icon className="h-6 w-6" aria-hidden />
        </div>
        <p className="mt-4 text-base font-medium text-foreground">{t("naslovUskoro", { naslov })}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{opis}</p>
        <span className="mt-4 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          {faza}
        </span>
      </div>
    </div>
  )
}
