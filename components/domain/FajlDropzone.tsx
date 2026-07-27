"use client"

import { useId, useRef, useState, type DragEvent } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Upload, FileText, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ACCEPT_ATTR, MAX_MB, validirajFajl } from "@/lib/dokumenti"

/** "820 KB" / "3.4 MB" — bez zavisnosti od locale-a jer je jedinica ista u sr/en/de. */
function velicina(bytes: number): string {
  const kb = bytes / 1024
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`
}

/**
 * Vidljiva zona za dodavanje fajla — klik ILI prevlačenje.
 *
 * Native `input[type=file]` ostaje u DOM-u (samo vizuelno sakriven) i nosi isti
 * `name`/`data-testid` kao ranije, pa `FormData` i Playwright `setInputFiles`
 * rade nepromijenjeno. Sakriven je preko `sr-only`, NE `display:none` — tako
 * ostaje fokusabilan tastaturom, a `peer-focus-visible` prsten se crta na labeli.
 */
export function FajlDropzone({
  name = "file",
  ariaLabel,
  testId,
  onGreska,
}: {
  name?: string
  ariaLabel: string
  testId?: string
  /** Poruka o odbijenom fajlu; podrazumijevano ide toastom. */
  onGreska?: (razlog: "tip" | "velicina") => void
}) {
  const t = useTranslations("dokumenti")
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const [izabrani, setIzabrani] = useState<File | null>(null)
  const [prevlaci, setPrevlaci] = useState(false)

  function prijaviGresku(razlog: "tip" | "velicina") {
    if (onGreska) return onGreska(razlog)
    toast.error(razlog === "tip" ? t("nedozvoljenTip") : t("fajlPrevelik", { max: MAX_MB }))
  }

  /** Jedini put kroz koji fajl ulazi — i klikom i dropom. */
  function primiFajl(file: File | undefined) {
    if (!inputRef.current) return
    if (!file) {
      setIzabrani(null)
      return
    }
    const provjera = validirajFajl(file)
    if (!provjera.ok) {
      inputRef.current.value = ""
      setIzabrani(null)
      prijaviGresku(provjera.razlog)
      return
    }
    // Drop ne puni `input.files` sam — moramo ga postaviti da fajl uđe u FormData.
    // (Programsko postavljanje `.files` ne okida `change`, pa nema petlje sa onChange.)
    const dt = new DataTransfer()
    dt.items.add(file)
    inputRef.current.files = dt.files
    setIzabrani(file)
  }

  function ocisti() {
    if (inputRef.current) inputRef.current.value = ""
    setIzabrani(null)
  }

  function naDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setPrevlaci(false)
    primiFajl(e.dataTransfer.files?.[0])
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setPrevlaci(true)
      }}
      onDragLeave={(e) => {
        // `dragleave` puca i pri prelasku na dijete — gasi samo kad se zaista izađe iz zone.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setPrevlaci(false)
      }}
      onDrop={naDrop}
      data-testid={testId ? `${testId}-zona` : undefined}
      data-prevlaci={prevlaci ? "" : undefined}
      className="min-w-0"
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name={name}
        accept={ACCEPT_ATTR}
        aria-label={ariaLabel}
        data-testid={testId}
        className="peer sr-only"
        onChange={(e) => primiFajl(e.target.files?.[0])}
      />

      <label
        htmlFor={inputId}
        className={cn(
          "flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input px-4 py-5 text-center transition-colors",
          "hover:border-brand hover:bg-brand-light/40",
          "peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
          prevlaci && "border-brand bg-brand-light/60",
        )}
      >
        <Upload className={cn("h-5 w-5 shrink-0", prevlaci ? "text-brand" : "text-muted-foreground")} aria-hidden />
        <span className="text-sm font-medium">
          {prevlaci ? t("dropzonePusti") : t("dropzoneNaslov")}
        </span>
        <span className="text-xs text-muted-foreground">{t("dropzoneOpis", { max: MAX_MB })}</span>
      </label>

      {izabrani && (
        // Popunjena pozadina razlikuje "izabrano, još nije poslano" od već otpremljenih
        // dokumenata ispod — oni su isto redovi sa ikonom fajla i istim okvirom.
        <div
          className="mt-2 flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/60 px-2 py-1.5 text-sm"
          data-testid={testId ? `${testId}-izabrani` : undefined}
        >
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{izabrani.name}</span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {velicina(izabrani.size)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={ocisti}
            aria-label={t("dropzoneUkloni")}
            data-testid={testId ? `${testId}-ocisti` : undefined}
            className="shrink-0"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  )
}
