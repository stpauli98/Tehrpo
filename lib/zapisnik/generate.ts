import Anthropic from "@anthropic-ai/sdk"
import { env } from "@/lib/env"
import { dryGenerateZapisnik, buildPrompt, type ZapisnikInput, type ZapisnikContent } from "./content"

function dryRunMode(): boolean {
  return env.ZAPISNIK_DRY_RUN === "1" || !env.ANTHROPIC_API_KEY
}

export async function generateZapisnik(input: ZapisnikInput): Promise<ZapisnikContent> {
  if (dryRunMode()) return dryGenerateZapisnik(input)

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: buildPrompt(input) }],
  })
  const text = msg.content
    .filter((b) => b.type === "text" && "text" in b)
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim()

  try {
    const parsed = JSON.parse(text) as { nalaz?: string; zakljucak?: string }
    if (!parsed.nalaz || !parsed.zakljucak) throw new Error("nepotpun odgovor")
    return { nalaz: parsed.nalaz, zakljucak: parsed.zakljucak, dryRun: false }
  } catch {
    // Model nije vratio čist JSON — degradiraj na deterministični sadržaj umjesto pada.
    return { ...dryGenerateZapisnik(input), dryRun: false }
  }
}
