"use client"

import { TriangleAlert } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Standardni prikaz greške pri učitavanju podataka (S1) — vizuelni jezik
 * identičan empty state-ovima (centriran blok na kanonskoj površini).
 *
 * Primjeri upotrebe:
 * - server komponenta (bez `onRetry` — retry pokriva `error.tsx`/reload):
 *   ```tsx
 *   <GreskaUcitavanja />
 *   ```
 * - `useQuery` ekran (dugme "Pokušaj ponovo" se renderuje samo uz `onRetry`):
 *   ```tsx
 *   <GreskaUcitavanja onRetry={refetch} />
 *   ```
 *
 * Nema vlastiti default `data-testid` — konzumenti ga prosljeđuju kroz
 * `testId` po potrebi.
 */
export function GreskaUcitavanja({
  poruka,
  onRetry,
  testId,
  className,
}: {
  poruka?: string
  onRetry?: () => void
  testId?: string
  className?: string
}) {
  const t = useTranslations("common")

  return (
    <div
      data-testid={testId}
      className={cn(
        "rounded-xl bg-card p-10 text-center ring-1 ring-foreground/10",
        className
      )}
    >
      <p className="inline-flex items-center gap-2 text-sm text-destructive">
        <TriangleAlert className="h-[18px] w-[18px] shrink-0" aria-hidden />
        {poruka ?? t("greskaUcitavanja")}
      </p>
      {onRetry && (
        <div className="mt-4">
          <Button variant="outline" onClick={onRetry}>
            {t("pokusajPonovo")}
          </Button>
        </div>
      )}
    </div>
  )
}
