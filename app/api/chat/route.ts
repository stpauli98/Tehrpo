import { z } from "zod"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { runChat, type ChatTurn, type ChatEvent } from "@/lib/claude/chat"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const bodySchema = z.object({
  konverzacija_id: z.string().uuid(),
  userText: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }))
    .max(40)
    .default([]),
})

export async function POST(req: Request): Promise<Response> {
  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(await req.json())
  } catch {
    return new Response(JSON.stringify({ error: "Neispravan zahtjev" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }
  const { konverzacija_id, userText, history } = parsed

  const supabase = await createServerSupabaseClient()
  // Persist user poruku odmah (prije streama) — greška mora spriječiti stream
  const { error: userErr } = await supabase
    .from("chat_poruke")
    .insert({ konverzacija_id, uloga: "user", sadrzaj: userText })
  if (userErr) {
    return new Response(JSON.stringify({ error: "Snimanje poruke nije uspjelo" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"))
      try {
        const { assistantText, toolsUsed } = await runChat(history as ChatTurn[], userText, send)
        // Persist assistant poruku (sa korištenim alatima u alat_pozivi)
        await supabase.from("chat_poruke").insert({
          konverzacija_id,
          uloga: "assistant",
          sadrzaj: assistantText || "(bez teksta)",
          alat_pozivi: toolsUsed.length ? toolsUsed : null,
        })
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "Greška asistenta" })
        send({ type: "done" })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  })
}
