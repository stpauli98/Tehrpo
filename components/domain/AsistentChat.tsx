"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { ChatMessage, type UiPoruka } from "@/components/domain/ChatMessage"
import { ChatInput } from "@/components/domain/ChatInput"
import { SuggestedPills } from "@/components/domain/SuggestedPills"
import type { ChatEvent } from "@/lib/claude/protokol"

export function AsistentChat({
  konverzacijaId,
  pocetnePoruke,
}: {
  konverzacijaId: string
  pocetnePoruke: UiPoruka[]
}) {
  const t = useTranslations("asistent.chat")
  const [poruke, setPoruke] = useState<UiPoruka[]>(pocetnePoruke)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  function scrollDown() {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
  }

  /** Upiše tekst u zadnji (assistant) mjehur — isti obrazac koji koriste greške veze. */
  function dopisiUAssistant(tekst: string) {
    setPoruke((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last && last.role === "assistant") next[next.length - 1] = { ...last, text: last.text + tekst }
      return next
    })
  }

  /** Primijeni jedan NDJSON događaj na zadnji assistant mjehur. */
  function primijeniEvent(ev: ChatEvent) {
    setPoruke((prev) => {
      const lastOrig = prev[prev.length - 1]
      if (!lastOrig || lastOrig.role !== "assistant") return prev
      const last = { ...lastOrig, tools: [...(lastOrig.tools ?? [])] }
      if (ev.type === "text") last.text += ev.text
      else if (ev.type === "tool") last.tools = [...last.tools, ev.label]
      else if (ev.type === "proposal") last.proposal = ev.data
      else if (ev.type === "error") last.text += t("greskaEvent", { poruka: ev.message })
      const next = [...prev]
      next[next.length - 1] = last
      return next
    })
    scrollDown()
  }

  async function send(userText: string) {
    if (busy) return
    setBusy(true)
    setPoruke((prev) => [...prev, { role: "user", text: userText }, { role: "assistant", text: "", tools: [] }])
    scrollDown()

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ konverzacija_id: konverzacijaId, userText }),
      })
      // HTTP greške (400/401/403/429/500) su JSON `{error}` bez završnog newline-a i
      // nemaju `type` polje — bez ove grane ostale bi u bufferu, a mjehur zauvijek na
      // placeholderu (S1: greška se mora vidjeti).
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        dopisiUAssistant(t("greskaHttp", { poruka: body?.error ?? t("nepoznatoGreska") }))
        return
      }
      if (!res.body) throw new Error(t("nemaStream"))
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      // eslint-disable-next-line no-await-in-loop
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        buf += decoder.decode(chunk.value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          let ev: ChatEvent
          try { ev = JSON.parse(line) as ChatEvent } catch { continue } // preskoči nevalidnu/parcijalnu liniju
          primijeniEvent(ev)
        }
      }
      // Flush ostatka: odgovor bez završnog newline-a inače ostane neparsiran.
      if (buf.trim()) {
        try { primijeniEvent(JSON.parse(buf) as ChatEvent) } catch { /* nepotpuna zadnja linija */ }
      }
    } catch (e) {
      dopisiUAssistant(t("greskaVeze", { poruka: e instanceof Error ? e.message : t("nepoznatoGreska") }))
    } finally {
      setBusy(false)
      scrollDown()
    }
  }

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col">
      <div ref={scrollRef} role="log" aria-live="polite" aria-busy={busy} className="flex-1 space-y-3 overflow-y-auto p-2" data-testid="chat-poruke">
        {poruke.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("prazno")}</p>
        )}
        {poruke.map((p, i) => <ChatMessage key={i} poruka={p} />)}
      </div>
      <div className="space-y-2 border-t border-border pt-3">
        {poruke.length === 0 && <SuggestedPills onPick={send} />}
        <ChatInput disabled={busy} onSend={send} />
      </div>
    </div>
  )
}
