"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import { cn, FOCUS_RING } from "@/lib/utils"

export function ChatInput({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const t = useTranslations("asistent.chatInput")
  const [text, setText] = useState("")
  function submit() {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
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
        placeholder={t("placeholder")}
        rows={2}
        data-testid="chat-input"
        className={cn("flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm", FOCUS_RING)}
      />
      <Button type="submit" size="icon" disabled={disabled} data-testid="chat-send" aria-label={t("posalji")} className="group/tt relative self-end">
        <Send className="h-4 w-4" aria-hidden />
        <Tooltip>{t("posalji")}</Tooltip>
      </Button>
    </form>
  )
}
