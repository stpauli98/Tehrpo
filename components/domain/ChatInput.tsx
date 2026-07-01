"use client"

import { useState } from "react"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/ikona-tooltip"

export function ChatInput({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("")
  function submit() {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText("")
  }
  return (
    <form
      className="flex items-end gap-2"
      data-testid="chat-input-form"
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit() } }}
        placeholder="Napiši pitanje…"
        rows={2}
        data-testid="chat-input"
        className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
      />
      <Button type="submit" size="icon" disabled={disabled} data-testid="chat-send" aria-label="Pošalji" className="group/tt relative self-end">
        <Send className="h-4 w-4" aria-hidden />
        <Tooltip>Pošalji</Tooltip>
      </Button>
    </form>
  )
}
