"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { snimiZapisnik, type ActionResult } from "@/app/(dashboard)/asistent/actions"

export type ProposalData = {
  terminId: string; klijent: string; vrsta: string; datum: string; nalaz: string; zakljucak: string
}
export type UiPoruka = { role: "user" | "assistant"; text: string; proposal?: ProposalData; tools?: string[] }

// Stable sentinel — identity check `state !== initial` tells us form was submitted at least once
const initial: ActionResult = { ok: true }

function ZapisnikProposal({ p }: { p: ProposalData }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(snimiZapisnik, initial)
  const prev = useRef(state)
  useEffect(() => {
    if (state !== prev.current) {
      prev.current = state
      if (state.ok) router.refresh()
    }
  }, [state, router])
  // `state !== initial` → form was submitted at least once; `state.ok` → it succeeded
  const snimljeno = state !== initial && state.ok
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3" data-testid="zapisnik-proposal">
      <p className="text-xs uppercase tracking-wide text-slate-400">Prijedlog zapisnika · {p.klijent} · {p.vrsta}</p>
      <p className="mt-1 text-sm"><span className="font-medium">Nalaz:</span> {p.nalaz}</p>
      <p className="mt-1 text-sm"><span className="font-medium">Zaključak:</span> {p.zakljucak}</p>
      <form action={action} className="mt-2">
        <input type="hidden" name="termin_id" value={p.terminId} />
        <input type="hidden" name="nalaz" value={p.nalaz} />
        <input type="hidden" name="zakljucak" value={p.zakljucak} />
        <Button type="submit" disabled={pending} data-testid="snimi-zapisnik">
          {pending ? "Snimam…" : "Snimi zapisnik"}
        </Button>
        {state.ok === false && state.message && (
          <span className="ml-2 text-xs text-red-600" role="alert">{state.message}</span>
        )}
        {snimljeno && (
          <span className="ml-2 text-xs text-green-600" data-testid="zapisnik-snimljen">Snimljeno ✓</span>
        )}
      </form>
    </div>
  )
}

export function ChatMessage({ poruka }: { poruka: UiPoruka }) {
  const isUser = poruka.role === "user"
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"} data-testid={`msg-${poruka.role}`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${isUser ? "bg-brand text-white" : "bg-brand-light text-slate-800"}`}>
        {poruka.tools && poruka.tools.length > 0 && (
          <p className="mb-1 text-xs italic text-slate-500" data-testid="tool-indikator">
            Alati: {poruka.tools.join(", ")}
          </p>
        )}
        <p className="whitespace-pre-wrap">{poruka.text || (isUser ? "" : "…")}</p>
        {poruka.proposal && <ZapisnikProposal p={poruka.proposal} />}
      </div>
    </div>
  )
}
