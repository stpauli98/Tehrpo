"use client"

import { useRef, useState } from "react"
import { ChatMessage, type UiPoruka, type ProposalData } from "@/components/domain/ChatMessage"
import { ChatInput } from "@/components/domain/ChatInput"
import { SuggestedPills } from "@/components/domain/SuggestedPills"

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; label: string }
  | { type: "proposal"; data: ProposalData }
  | { type: "error"; message: string }
  | { type: "done" }

export function AsistentChat({
  konverzacijaId,
  pocetnePoruke,
}: {
  konverzacijaId: string
  pocetnePoruke: UiPoruka[]
}) {
  const [poruke, setPoruke] = useState<UiPoruka[]>(pocetnePoruke)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  function scrollDown() {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
  }

  async function send(userText: string) {
    if (busy) return
    setBusy(true)
    const history = poruke.map((p) => ({ role: p.role, text: p.text }))
    setPoruke((prev) => [...prev, { role: "user", text: userText }, { role: "assistant", text: "", tools: [] }])
    scrollDown()

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ konverzacija_id: konverzacijaId, userText, history }),
      })
      if (!res.body) throw new Error("Nema stream-a")
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
          let ev: StreamEvent
          try { ev = JSON.parse(line) as StreamEvent } catch { continue } // preskoči nevalidnu/parcijalnu liniju
          setPoruke((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (!last || last.role !== "assistant") return prev
            if (ev.type === "text") last.text += ev.text
            else if (ev.type === "tool") last.tools = [...(last.tools ?? []), ev.tool]
            else if (ev.type === "proposal") last.proposal = ev.data
            else if (ev.type === "error") last.text += `\n[Greška: ${ev.message}]`
            return next
          })
          scrollDown()
        }
      }
    } catch (e) {
      setPoruke((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.role === "assistant") last.text += `\n[Greška veze: ${e instanceof Error ? e.message : "nepoznato"}]`
        return next
      })
    } finally {
      setBusy(false)
      scrollDown()
    }
  }

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-2" data-testid="chat-poruke">
        {poruke.length === 0 && (
          <p className="text-sm text-slate-500">Postavi pitanje o terminima, firmama ili zatraži prijedlog zapisnika.</p>
        )}
        {poruke.map((p, i) => <ChatMessage key={i} poruka={p} />)}
      </div>
      <div className="space-y-2 border-t border-slate-200 pt-3">
        {poruke.length === 0 && <SuggestedPills onPick={send} />}
        <ChatInput disabled={busy} onSend={send} />
      </div>
    </div>
  )
}
