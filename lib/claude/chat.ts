import Anthropic from "@anthropic-ai/sdk"
import { env } from "@/lib/env"
import { todayIso } from "@/lib/date"
import { SISTEM_PROMPT, datumNapomena } from "./prompts"
import { CHAT_TOOLS, toolLabel, executeTool } from "./tools"
import { mockChatEvents } from "./mock"
import type { ChatEvent, ChatTurn } from "./protokol"

export function chatDryRun(): boolean {
  return env.CHAT_DRY_RUN === "1" || !env.ANTHROPIC_API_KEY
}

const MAX_KORACI = 5

export async function runChat(
  history: ChatTurn[],
  userText: string,
  onEvent: (e: ChatEvent) => void,
): Promise<{ assistantText: string; toolsUsed: string[] }> {
  if (chatDryRun()) {
    let txt = ""
    const tools: string[] = []
    for (const e of mockChatEvents(userText)) {
      if (e.type === "text") txt += e.text
      if (e.type === "tool") tools.push(e.tool)
      onEvent(e)
    }
    return { assistantText: txt, toolsUsed: tools }
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: userText },
  ]

  let assistantText = ""
  const toolsUsed: string[] = []

  for (let korak = 0; korak < MAX_KORACI; korak++) {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SISTEM_PROMPT + datumNapomena(todayIso()),
      tools: CHAT_TOOLS,
      messages,
    })
    stream.on("text", (delta) => {
      assistantText += delta
      onEvent({ type: "text", text: delta })
    })
    // eslint-disable-next-line no-await-in-loop -- agentic loop: svaki korak zavisi od prethodnog tool_result-a (ne može Promise.all)
    const msg = await stream.finalMessage()

    const toolUses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    )
    if (msg.stop_reason !== "tool_use" || toolUses.length === 0) break

    // Indikatori (batch) + izvrši sve tool-ove paralelno
    for (const tu of toolUses) {
      toolsUsed.push(tu.name)
      onEvent({ type: "tool", tool: tu.name, label: toolLabel(tu.name) })
    }
    // eslint-disable-next-line no-await-in-loop -- tool-ovi za OVAJ korak; sljedeći korak zavisi od ovih rezultata
    const results = await Promise.all(toolUses.map((tu) => executeTool(tu.name, tu.input)))
    results.forEach((r) => { if (r.proposal) onEvent({ type: "proposal", data: r.proposal }) })

    messages.push({ role: "assistant", content: msg.content })
    messages.push({
      role: "user",
      content: toolUses.map((tu, i) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: results[i]?.forModel ?? "",
      })),
    })
  }

  onEvent({ type: "done" })
  return { assistantText, toolsUsed }
}
