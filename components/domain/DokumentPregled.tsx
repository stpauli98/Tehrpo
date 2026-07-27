"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { DocxPreview } from "@/components/domain/DocxPreview"
import { PreuzmiDokumentButton } from "@/components/domain/PreuzmiDokumentButton"

type Pregled =
  | { vrsta: "html"; naziv: string; html: string }
  | { vrsta: "url"; naziv: string; mime: string; url: string }
  | { vrsta: "nedostupan"; naziv: string }

function jePregled(x: unknown): x is Pregled {
  if (!x || typeof x !== "object") return false
  const v = (x as { vrsta?: unknown }).vrsta
  return v === "html" || v === "url" || v === "nedostupan"
}

/**
 * Sadržaj dokumenta unutar kartice termina — bez preuzimanja i bez dijaloga
 * preko dijaloga (v. obrazac u `DokumentiSekcija`).
 *
 * DOCX stiže kao HTML sa rute i renderuje se istim `DocxPreview` koji koristi
 * `/zapisnici`; PDF i slike stižu kao potpisani inline URL.
 */
export function DokumentPregled({ dokumentId }: { dokumentId: string }) {
  const t = useTranslations("dokumenti")
  const tc = useTranslations("common")
  const [stanje, setStanje] = useState<Pregled | { vrsta: "greska"; poruka: string } | null>(null)

  // Reset na promjenu dokumenta ide preko `key` na pozivnom mjestu (remount), ne
  // preko `setStanje(null)` u efektu — to bi bio sinhroni setState u efektu.
  useEffect(() => {
    let otkazan = false
    ;(async () => {
      try {
        const res = await fetch(`/api/dokumenti/${dokumentId}/pregled`)
        const json: unknown = await res.json().catch(() => null)
        if (otkazan) return
        if (!res.ok) {
          const poruka =
            json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
              ? (json as { error: string }).error
              : tc("greska")
          setStanje({ vrsta: "greska", poruka })
          return
        }
        setStanje(jePregled(json) ? json : { vrsta: "greska", poruka: tc("greska") })
      } catch {
        if (!otkazan) setStanje({ vrsta: "greska", poruka: tc("greska") })
      }
    })()
    return () => {
      otkazan = true
    }
  }, [dokumentId, tc])

  if (stanje === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" data-testid="pregled-ucitavanje">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {t("pregledUcitavanje")}
      </div>
    )
  }

  if (stanje.vrsta === "greska" || stanje.vrsta === "nedostupan") {
    return (
      <div className="space-y-3 rounded-lg border border-border p-4 text-center" data-testid="pregled-poruka">
        <p className="text-sm text-muted-foreground">
          {stanje.vrsta === "greska" ? stanje.poruka : t("pregledNijeDostupan")}
        </p>
        {/* Kad prikaz ne uspije, preuzimanje ostaje izlaz — ne ostavljaj korisnika u ćorsokaku. */}
        <div className="flex justify-center">
          <PreuzmiDokumentButton dokumentId={dokumentId} label={t("preuzmi")} testId="pregled-preuzmi" />
        </div>
      </div>
    )
  }

  if (stanje.vrsta === "html") {
    return <DocxPreview html={stanje.html} />
  }

  if (stanje.mime === "application/pdf") {
    return (
      <div className="space-y-2">
        {/* `iframe`, NE `object`: sa `<object data=…>` Chrome ostavlja praznu bijelu
            površinu iako Storage vraća ispravan `application/pdf` (provjereno uživo).
            `iframe` uredno podiže ugrađeni PDF čitač. */}
        <iframe
          src={stanje.url}
          title={stanje.naziv}
          className="h-[60vh] w-full rounded-lg ring-1 ring-foreground/10"
          data-testid="pregled-pdf"
        />
        {/* `iframe` nema fallback sadržaj — preglednik bez PDF čitača pokaže prazno,
            pa preuzimanje mora ostati vidljivo kao izlaz. */}
        <div className="flex items-center justify-center">
          <PreuzmiDokumentButton dokumentId={dokumentId} label={t("preuzmi")} testId="pregled-preuzmi" />
        </div>
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- potpisani Storage URL istekne za 60s; `next/image` bi ga keširao i optimizovao bez koristi
    <img
      src={stanje.url}
      alt={stanje.naziv}
      className="mx-auto max-h-[60vh] max-w-full rounded-lg object-contain ring-1 ring-foreground/10"
      data-testid="pregled-slika"
    />
  )
}
