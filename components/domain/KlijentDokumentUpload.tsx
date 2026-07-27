"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { UploadCloud, FileText, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useAkcijaToast } from "@/components/akcija-toast"
import { FieldError } from "./FieldError"
import { uploadKlijentDokumentAction, type ActionResult } from "@/app/(dashboard)/dokumenti/actions"
import { ACCEPT_ATTR, DOKUMENT_TIPOVI, MAX_MB, validirajFajl } from "@/lib/dokumenti"
import { useMozeUrediti } from "@/providers/korisnik-provider"

const initial: ActionResult = { ok: true }

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function KlijentDokumentUpload({ klijentId }: { klijentId: string }) {
  const t = useTranslations("klijenti.dokumentUpload")
  // Poruka o nedozvoljenom tipu je kanonski dokument-modul ključ (S8.5) — ne duplira se u klijenti.*
  const td = useTranslations("dokumenti")
  const tc = useTranslations("common")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
  const [state, action, pending] = useActionState(uploadKlijentDokumentAction, initial)
  useAkcijaToast(state, { uspjeh: t("uspjeh"), greska: tc("greska") })
  const fileRef = useRef<HTMLInputElement>(null)
  const prev = useRef(state)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<{ name: string; size: number } | null>(null)
  const [greska, setGreska] = useState<string | null>(null)

  // Mapa value→label za base-ui SelectValue (prikaz prevoda kad je select zatvoren).
  const tipItems: Record<string, string> = Object.fromEntries(
    DOKUMENT_TIPOVI.map((tip) => [tip, t(`tipovi.${tip}`)]),
  )
  const tipGreske = state.ok === false ? state.errors?.tip : undefined

  useEffect(() => {
    if (state !== prev.current) {
      prev.current = state
      if (state.ok) {
        if (fileRef.current) fileRef.current.value = ""
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reset forme nakon uspješnog uploada
        setFile(null)
        router.refresh()
      }
    }
  }, [state, router])

  // Validira tip i veličinu; vraća true ako je fajl prihvaćen.
  function prihvati(f: File | undefined): boolean {
    if (!f) return false
    const provjera = validirajFajl(f)
    if (!provjera.ok) {
      setGreska(
        provjera.razlog === "tip"
          ? td("nedozvoljenTip")
          : t("fajlPrevelik", { velicina: formatBytes(f.size), max: MAX_MB }),
      )
      if (fileRef.current) fileRef.current.value = ""
      setFile(null)
      return false
    }
    setGreska(null)
    setFile({ name: f.name, size: f.size })
    return true
  }

  function preuzmiFajl(f: File | undefined) {
    if (!f) return
    if (!prihvati(f)) return
    // Ubaci dropnuti fajl u stvarni <input type=file> da se normalno pošalje formom.
    const dt = new DataTransfer()
    dt.items.add(f)
    if (fileRef.current) fileRef.current.files = dt.files
  }

  function ocisti() {
    if (fileRef.current) fileRef.current.value = ""
    setFile(null)
    setGreska(null)
  }

  if (!mozeUrediti) return null

  return (
    <form
      action={action}
      data-testid="klijent-dok-upload"
      className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <input type="hidden" name="klijent_id" value={klijentId} />

      {/* Drag & drop zona */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            fileRef.current?.click()
          }
        }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={(e) => { e.preventDefault(); setDragging(false) }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          preuzmiFajl(e.dataTransfer.files?.[0])
        }}
        data-testid="klijent-dok-dropzone"
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          dragging
            ? "border-brand bg-brand/5"
            : "border-border bg-muted hover:border-brand/60 hover:bg-muted",
        )}
      >
        <UploadCloud className={cn("h-9 w-9", dragging ? "text-brand" : "text-muted-foreground")} aria-hidden />
        {file ? (
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-brand" aria-hidden />
            <span className="font-medium text-foreground">{file.name}</span>
            <span className="text-muted-foreground">({formatBytes(file.size)})</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); ocisti() }}
              aria-label={t("ukloniFajlAriaLabel")}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">
              {t("prevuciDokument")} <span className="text-brand">{t("klikniZaOdabir")}</span>
            </p>
            <p className="text-xs text-muted-foreground">{t("formatiHint")}</p>
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        name="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        data-testid="klijent-dok-file"
        onChange={(e) => prihvati(e.target.files?.[0])}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1 text-sm">
          <span className="block text-muted-foreground">{t("tipDokumentaLabel")}</span>
          <Select name="tip" defaultValue="ugovor" items={tipItems}>
            <SelectTrigger
              className="w-48"
              aria-describedby={tipGreske ? "greska-klijent-dok-tip" : undefined}
              data-testid="klijent-dok-tip"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOKUMENT_TIPOVI.map((tip) => <SelectItem key={tip} value={tip}>{t(`tipovi.${tip}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <FieldError id="greska-klijent-dok-tip" errors={tipGreske} />
        </div>
        <Button type="submit" disabled={pending || !file} data-testid="klijent-dok-submit">
          {pending ? t("submitPending") : t("submit")}
        </Button>
      </div>

      {/* Samo KLIJENTSKA validacija (prije round-tripa) — `state.message` ide toastom (S2). */}
      {greska && <p className="w-full text-sm text-destructive" role="alert">{greska}</p>}
    </form>
  )
}
