"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { FileText, Sparkles, Trash2, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  uploadDokumentAction,
  generateZapisnikAction,
  deleteDokumentAction,
  type ActionResult,
} from "@/app/(dashboard)/dokumenti/actions"
import type { Database } from "@/db/types"

type DokumentRow = Database["public"]["Tables"]["dokumenti"]["Row"]
const initial: ActionResult = { ok: true }

export function DokumentiSekcija({
  terminId,
  dokumenti,
  izvrsen,
}: {
  terminId: string
  dokumenti: DokumentRow[]
  izvrsen: boolean
}) {
  const router = useRouter()
  const [uploadState, uploadAction, uploadPending] = useActionState(uploadDokumentAction, initial)
  const [genState, genAction, genPending] = useActionState(generateZapisnikAction, initial)
  const [delState, delAction, delPending] = useActionState(deleteDokumentAction, initial)
  const fileRef = useRef<HTMLInputElement>(null)

  // Refresh liste kad SE PROMIJENI ishod bilo koje akcije i taj (promijenjeni) ishod je uspjeh.
  // NE uslovljavati sa "sve tri ok" — zaglavljena greška iz jedne akcije bi blokirala
  // refresh nakon kasnijeg uspjeha druge akcije.
  const prev = useRef({ u: uploadState, g: genState, d: delState })
  useEffect(() => {
    const uChanged = uploadState !== prev.current.u
    const gChanged = genState !== prev.current.g
    const dChanged = delState !== prev.current.d
    if (!uChanged && !gChanged && !dChanged) return
    const uspjeh =
      (uChanged && uploadState.ok) || (gChanged && genState.ok) || (dChanged && delState.ok)
    prev.current = { u: uploadState, g: genState, d: delState }
    if (uspjeh) {
      if (uChanged && uploadState.ok && fileRef.current) fileRef.current.value = ""
      router.refresh()
    }
  }, [uploadState, genState, delState, router])

  const greska =
    (uploadState.ok === false && uploadState.message) ||
    (genState.ok === false && genState.message) ||
    (delState.ok === false && delState.message) ||
    null

  return (
    <section data-testid="sheet-dokumenti">
      <p className="text-xs uppercase tracking-wide text-slate-400">Dokumenti</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {izvrsen ? (
          <form action={genAction}>
            <input type="hidden" name="termin_id" value={terminId} />
            <Button type="submit" variant="default" disabled={genPending} data-testid="generisi-zapisnik">
              <Sparkles className="w-4 h-4" aria-hidden /> {genPending ? "Generišem…" : "Generiši zapisnik (AI)"}
            </Button>
          </form>
        ) : (
          <p className="text-xs text-slate-400" data-testid="zapisnik-nedostupan">
            Zapisnik (AI) je dostupan tek nakon što je termin izvršen.
          </p>
        )}

        <form action={uploadAction} className="flex min-w-0 items-center gap-2">
          <input type="hidden" name="termin_id" value={terminId} />
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".docx,.pdf,image/png,image/jpeg,image/webp"
            data-testid="dokument-file"
            className="min-w-0 max-w-full text-sm"
          />
          <Button type="submit" variant="outline" disabled={uploadPending} data-testid="dokument-upload-submit">
            {uploadPending ? "Šaljem…" : "Upload"}
          </Button>
        </form>
      </div>

      {greska && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {greska}
        </p>
      )}

      {dokumenti.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Nema dokumenata za ovaj termin.</p>
      ) : (
        <ul className="mt-3 space-y-2" data-testid="dokumenti-lista">
          {dokumenti.map((d) => (
            <li
              key={d.id}
              data-testid="dokument-red"
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="w-4 h-4 shrink-0 text-slate-400" aria-hidden />
                <span className="truncate">{d.naziv}</span>
                {d.generated_by_ai && (
                  <span data-testid="dokument-ai-badge" className="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-xs text-brand">AI</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <a
                  href={`/api/dokumenti/${d.id}`}
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                  data-testid="dokument-download"
                >
                  <Download className="w-4 h-4" aria-hidden /> Preuzmi
                </a>
                <form action={delAction}>
                  <input type="hidden" name="dokument_id" value={d.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    disabled={delPending}
                    data-testid="dokument-delete"
                    aria-label="Obriši dokument"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" aria-hidden />
                  </Button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
