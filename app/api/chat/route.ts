import { z } from "zod"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { runChat } from "@/lib/claude/chat"
import { MAX_PORUKA_ZNAKOVA, type ChatTurn, type ChatEvent } from "@/lib/claude/protokol"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { rateLimitWindows, prekoracenLimit } from "@/lib/claude/rate-limit"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "asistent.api" })

const bodySchema = z.object({
  konverzacija_id: z.string().uuid(),
  userText: z.string().min(1).max(MAX_PORUKA_ZNAKOVA),
})

export async function POST(req: Request): Promise<Response> {
  const korisnik = await getTrenutniKorisnik()
  if (!korisnik) {
    return new Response(JSON.stringify({ error: t("neovlasten") }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }
  if (korisnik.uloga === "pregled") {
    return new Response(JSON.stringify({ error: t("zabranjeno") }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  }

  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(await req.json())
  } catch {
    return new Response(JSON.stringify({ error: t("neispravanZahtjev") }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }
  const { konverzacija_id, userText } = parsed

  const supabase = await createServerSupabaseClient()

  // Rate-limit: sliding-window nad vlastitim user porukama (prije upisa nove).
  const { minuteAgo, dayAgo } = rateLimitWindows(Date.now())
  const [minRes, dayRes] = await Promise.all([
    supabase.from("chat_poruke").select("id", { count: "exact", head: true })
      .eq("korisnik_id", korisnik.id).eq("uloga", "user").gte("created_at", minuteAgo),
    supabase.from("chat_poruke").select("id", { count: "exact", head: true })
      .eq("korisnik_id", korisnik.id).eq("uloga", "user").gte("created_at", dayAgo),
  ])
  if (minRes.error || dayRes.error) {
    console.error("Rate-limit count nije uspio:", minRes.error?.message ?? dayRes.error?.message)
    return new Response(JSON.stringify({ error: t("greskaAsistenta") }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
  if (prekoracenLimit(minRes.count ?? 0, dayRes.count ?? 0)) {
    return new Response(JSON.stringify({ error: t("previseZahtjeva") }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    })
  }

  // Historija se rekonstruiše sa servera (ne vjeruje se klijentu): posljednjih 40
  // poruka ovog razgovora u vlasništvu korisnika, obrnuto u ascending za model.
  const { data: priorRows, error: histErr } = await supabase
    .from("chat_poruke")
    .select("uloga, sadrzaj")
    .eq("konverzacija_id", konverzacija_id)
    .eq("korisnik_id", korisnik.id)
    .order("created_at", { ascending: false })
    .limit(40)
  if (histErr) console.error("Učitavanje historije nije uspjelo:", histErr.message)
  const history: ChatTurn[] = (priorRows ?? [])
    .reverse()
    .map((r) => ({ role: r.uloga === "assistant" ? "assistant" : "user", text: r.sadrzaj }))

  // Persist user poruku odmah (prije streama) — greška mora spriječiti stream
  const { error: userErr } = await supabase
    .from("chat_poruke")
    .insert({ konverzacija_id, uloga: "user", sadrzaj: userText })
  if (userErr) {
    return new Response(JSON.stringify({ error: t("snimanjeNijeUspjelo") }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"))
      try {
        const { assistantText, toolsUsed } = await runChat(history, userText, send)
        // Persist assistant poruku (sa korištenim alatima u alat_pozivi)
        const { error: asstErr } = await supabase.from("chat_poruke").insert({
          konverzacija_id,
          uloga: "assistant",
          sadrzaj: assistantText || t("bezTeksta"),
          alat_pozivi: toolsUsed.length ? toolsUsed : null,
        })
        if (asstErr) {
          // Tihi pad bi značio da odgovor nestane iz istorije bez ikakve naznake (S1) —
          // korisnik u mjehuru mora vidjeti da poruka nije sačuvana.
          console.error("Snimanje assistant poruke nije uspjelo:", asstErr.message)
          send({ type: "error", message: t("snimanjeNijeUspjelo") })
        }
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : t("greskaAsistenta") })
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
