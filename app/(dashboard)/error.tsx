"use client"

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"

/**
 * Route error boundary za (dashboard) grupu (Next konvencija `error.tsx`).
 * Prikazuje generičku poruku — sirova server poruka (`error.message`) se NE
 * renderuje u UI; loguje se samo u konzolu radi dijagnostike (digest veže
 * klijentski log za serverski).
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations("common")

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="rounded-xl bg-card p-10 text-center ring-1 ring-foreground/10">
      <p className="text-sm text-destructive">{t("greskaNeocekivana")}</p>
      <Button variant="outline" className="mt-4" onClick={() => reset()}>
        {t("pokusajPonovo")}
      </Button>
    </div>
  )
}
