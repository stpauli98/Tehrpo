"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { IKONA_INLINE_KLASA, Tooltip } from "@/components/ui/ikona-tooltip"

/**
 * Preuzimanje dokumenta po S13: pending → `fetch` → `res.ok` provjera → tek onda
 * navigacija na potpisani URL. Greška iz rute (`{ error }`, već lokalizovana) ide
 * toastom — korisnik nikad ne završi na sirovom JSON-u u tabu.
 *
 * Dijeljena komponenta: fallback poruka se čita iz `common.*` (S14).
 */
export function PreuzmiDokumentButton({
  dokumentId,
  label,
  testId,
}: {
  dokumentId: string
  label: string
  testId?: string
}) {
  const tc = useTranslations("common")
  const [pending, setPending] = useState(false)

  async function preuzmi() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/dokumenti/${dokumentId}`)
      if (!res.ok) {
        let poruka = tc("greska")
        try {
          const json: unknown = await res.json()
          if (json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string") {
            poruka = (json as { error: string }).error
          }
        } catch {
          // tijelo nije JSON — ostaje generička poruka
        }
        toast.error(poruka)
        return
      }
      const json: unknown = await res.json()
      const url =
        json && typeof json === "object" && typeof (json as { url?: unknown }).url === "string"
          ? (json as { url: string }).url
          : null
      if (!url) {
        toast.error(tc("greska"))
        return
      }
      // Potpisani URL nosi `download=<naziv>` → preglednik snima fajl pod pravim imenom.
      window.location.assign(url)
    } catch {
      toast.error(tc("greska"))
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={preuzmi}
      disabled={pending}
      aria-busy={pending}
      aria-label={label}
      data-testid={testId}
      className={IKONA_INLINE_KLASA}
    >
      {pending ? (
        <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <Download className="h-[18px] w-[18px] shrink-0" aria-hidden />
      )}
      <Tooltip>{label}</Tooltip>
    </button>
  )
}
