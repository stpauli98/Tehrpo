"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@/components/ui/button"
import { snimiZapisnik, type ActionResult } from "@/app/(dashboard)/asistent/actions"
import { useMozeUrediti } from "@/providers/korisnik-provider"

export type ProposalData = {
  terminId: string; klijent: string; vrsta: string; datum: string; nalaz: string; zakljucak: string
}
export type UiPoruka = { role: "user" | "assistant"; text: string; proposal?: ProposalData; tools?: string[] }

// Stable sentinel — identity check `state !== initial` tells us form was submitted at least once
const initial: ActionResult = { ok: true }

function ZapisnikProposal({ p }: { p: ProposalData }) {
  const t = useTranslations("asistent.chatMessage.proposal")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
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
    <div className="mt-2 rounded-lg border border-border bg-card p-3" data-testid="zapisnik-proposal">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("naslov", { klijent: p.klijent, vrsta: p.vrsta })}</p>
      <p className="mt-1 text-sm"><span className="font-medium">{t("nalaz")}</span> {p.nalaz}</p>
      <p className="mt-1 text-sm"><span className="font-medium">{t("zakljucak")}</span> {p.zakljucak}</p>
      {mozeUrediti && (
        <form action={action} className="mt-2">
          <input type="hidden" name="termin_id" value={p.terminId} />
          <input type="hidden" name="nalaz" value={p.nalaz} />
          <input type="hidden" name="zakljucak" value={p.zakljucak} />
          <Button type="submit" disabled={pending} data-testid="snimi-zapisnik">
            {pending ? t("snimam") : t("snimi")}
          </Button>
          {state.ok === false && state.message && (
            <span className="ml-2 text-xs text-destructive" role="alert">{state.message}</span>
          )}
          {snimljeno && (
            <span className="ml-2 text-xs text-green-600" data-testid="zapisnik-snimljen">{t("snimljeno")}</span>
          )}
        </form>
      )}
    </div>
  )
}

export function ChatMessage({ poruka }: { poruka: UiPoruka }) {
  const t = useTranslations("asistent.chatMessage")
  const isUser = poruka.role === "user"
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"} data-testid={`msg-${poruka.role}`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${isUser ? "bg-brand text-white" : "bg-brand-light text-foreground"}`}>
        {poruka.tools && poruka.tools.length > 0 && (
          <p className="mb-1 text-xs italic text-muted-foreground" data-testid="tool-indikator">
            {t("alati", { lista: poruka.tools.join(", ") })}
          </p>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap">{poruka.text}</p>
        ) : poruka.text ? (
          <div className="space-y-2 leading-relaxed [&_a]:underline [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-4">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href ?? "#"} target="_blank" rel="noopener noreferrer">{children}</a>
                ),
              }}
            >
              {poruka.text}
            </ReactMarkdown>
          </div>
        ) : (
          <p>…</p>
        )}
        {poruka.proposal && <ZapisnikProposal p={poruka.proposal} />}
      </div>
    </div>
  )
}
