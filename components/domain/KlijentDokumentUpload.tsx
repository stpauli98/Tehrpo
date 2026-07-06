"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { UploadCloud, FileText, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { uploadKlijentDokumentAction, type ActionResult } from "@/app/(dashboard)/dokumenti/actions"
import { DOKUMENT_TIPOVI } from "@/lib/dokumenti"

const initial: ActionResult = { ok: true }

const MAX_MB = 10
const MAX_BYTES = MAX_MB * 1024 * 1024

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function KlijentDokumentUpload({ klijentId }: { klijentId: string }) {
  const t = useTranslations("klijenti.dokumentUpload")
  const router = useRouter()
  const [state, action, pending] = useActionState(uploadKlijentDokumentAction, initial)
  const fileRef = useRef<HTMLInputElement>(null)
  const prev = useRef(state)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<{ name: string; size: number } | null>(null)
  const [greska, setGreska] = useState<string | null>(null)

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

  // Validira veličinu; vraća true ako je fajl prihvaćen.
  function prihvati(f: File | undefined): boolean {
    if (!f) return false
    if (f.size > MAX_BYTES) {
      setGreska(t("fajlPrevelik", { velicina: formatBytes(f.size), max: MAX_MB }))
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

  return (
    <form
      action={action}
      data-testid="klijent-dok-upload"
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
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
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30",
          dragging
            ? "border-brand bg-brand/5"
            : "border-slate-300 bg-slate-50 hover:border-brand/60 hover:bg-slate-100",
        )}
      >
        <UploadCloud className={cn("h-9 w-9", dragging ? "text-brand" : "text-slate-400")} aria-hidden />
        {file ? (
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-brand" aria-hidden />
            <span className="font-medium text-slate-800">{file.name}</span>
            <span className="text-slate-400">({formatBytes(file.size)})</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); ocisti() }}
              aria-label={t("ukloniFajlAriaLabel")}
              className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-700">
              {t("prevuciDokument")} <span className="text-brand">{t("klikniZaOdabir")}</span>
            </p>
            <p className="text-xs text-slate-400">{t("formatiHint")}</p>
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        name="file"
        accept=".docx,.pdf,image/png,image/jpeg,image/webp"
        className="sr-only"
        data-testid="klijent-dok-file"
        onChange={(e) => prihvati(e.target.files?.[0])}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block text-sm">
          <span className="text-slate-600">{t("tipDokumentaLabel")}</span>
          <select
            name="tip"
            defaultValue="ugovor"
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            data-testid="klijent-dok-tip"
          >
            {DOKUMENT_TIPOVI.map((tip) => <option key={tip} value={tip}>{t(`tipovi.${tip}`)}</option>)}
          </select>
        </label>
        <Button type="submit" disabled={pending || !file} data-testid="klijent-dok-submit">
          {pending ? t("submitPending") : t("submit")}
        </Button>
      </div>

      {(greska || (state.ok === false && state.message)) && (
        <p className="w-full text-sm text-red-600" role="alert">{greska ?? (state.ok === false ? state.message : "")}</p>
      )}
    </form>
  )
}
