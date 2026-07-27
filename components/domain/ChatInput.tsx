"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/ikona-tooltip"
import { cn, FOCUS_RING } from "@/lib/utils"
// Isključivo iz `protokol.ts` (fajl bez importa) — import iz `chat.ts` bi povukao
// Anthropic SDK + lib/env u klijent bundle.
import { MAX_PORUKA_ZNAKOVA } from "@/lib/claude/protokol"

/** Prag od kojeg se brojač znakova pojavljuje (90% limita). */
const PRAG_BROJACA = MAX_PORUKA_ZNAKOVA * 0.9

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
      <div className="flex-1">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit() } }}
          placeholder={t("placeholder")}
          aria-label={t("oznaka")}
          maxLength={MAX_PORUKA_ZNAKOVA}
          rows={2}
          data-testid="chat-input"
          className={cn("w-full resize-none rounded-lg border border-border px-3 py-2 text-sm", FOCUS_RING)}
        />
        {text.length > PRAG_BROJACA && (
          <p className="text-right text-xs text-muted-foreground" aria-hidden>
            {text.length}/{MAX_PORUKA_ZNAKOVA}
          </p>
        )}
      </div>
      <Button type="submit" size="icon" disabled={disabled} data-testid="chat-send" aria-label={t("posalji")} className="group/tt relative self-end">
        <Send className="h-[18px] w-[18px] shrink-0" aria-hidden />
        <Tooltip>{t("posalji")}</Tooltip>
      </Button>
    </form>
  )
}
