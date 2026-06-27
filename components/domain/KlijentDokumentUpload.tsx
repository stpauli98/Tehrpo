"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { uploadKlijentDokumentAction, type ActionResult } from "@/app/(dashboard)/dokumenti/actions"
import { DOKUMENT_TIPOVI } from "@/lib/dokumenti"

const initial: ActionResult = { ok: true }
const TIP_LABEL = {
  strucni_nalaz: "Stručni nalaz", zapisnik: "Zapisnik", ugovor: "Ugovor",
  ponuda: "Ponuda", fotografija: "Fotografija", ostalo: "Ostalo",
} satisfies Record<(typeof DOKUMENT_TIPOVI)[number], string>

export function KlijentDokumentUpload({ klijentId }: { klijentId: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(uploadKlijentDokumentAction, initial)
  const fileRef = useRef<HTMLInputElement>(null)
  const prev = useRef(state)
  useEffect(() => {
    if (state !== prev.current) {
      prev.current = state
      if (state.ok) { if (fileRef.current) fileRef.current.value = ""; router.refresh() }
    }
  }, [state, router])

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3" data-testid="klijent-dok-upload">
      <input type="hidden" name="klijent_id" value={klijentId} />
      <label className="block text-sm">
        <span className="text-slate-600">Tip</span>
        <select name="tip" defaultValue="ugovor" className="block rounded-md border border-slate-300 px-2 py-1 text-sm" data-testid="klijent-dok-tip">
          {DOKUMENT_TIPOVI.map((t) => <option key={t} value={t}>{TIP_LABEL[t]}</option>)}
        </select>
      </label>
      <input
        ref={fileRef}
        type="file"
        name="file"
        required
        accept=".docx,.pdf,image/png,image/jpeg,image/webp"
        className="min-w-0 max-w-full text-sm"
        data-testid="klijent-dok-file"
      />
      <Button type="submit" variant="outline" disabled={pending} data-testid="klijent-dok-submit">
        {pending ? "Šaljem…" : "Upload"}
      </Button>
      {state.ok === false && state.message && (
        <p className="w-full text-sm text-red-600" role="alert">{state.message}</p>
      )}
    </form>
  )
}
