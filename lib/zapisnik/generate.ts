import Anthropic from "@anthropic-ai/sdk"
import { createTranslator } from "next-intl"
import { env } from "@/lib/env"
import { getMessages } from "@/i18n/messages"
import { APP_LOCALE, type Locale } from "@/lib/locale"
import {
  dryGenerateZapisnik,
  buildPrompt,
  zapisnikContent,
  zapisnikDryRun,
  type ZapisnikInput,
  type ZapisnikContent,
} from "./content"

/**
 * Model je pozvan, ali iz odgovora se ni nakon oporavka nije dao izvući upotrebljiv zapisnik.
 *
 * Namjerno je GREŠKA, a ne tihi povratak šablona (N11): zapisnik je dokaz o izvršenoj
 * zakonskoj provjeri (ZNR/ZOP). Šablon tvrdi „stanje zadovoljava propisane uslove" za
 * pregled koji niko nije opisao — snimiti to kao AI zapisnik znači proizvesti lažan
 * pravni zapis. Bolje je da se ništa ne snimi i da korisnik pokuša ponovo.
 *
 * Oba puta koja pozivaju generisanje umiju da prime izuzetak:
 *  - app/api/chat/route.ts hvata i šalje `{type:"error", message}` u chat,
 *  - /dokumenti server akcija ga podiže do app/(dashboard)/error.tsx.
 * Dry-run (offline/testovi) NIKAD ne baca — tamo se šablon i očekuje.
 */
export class ZapisnikGeneracijaGreska extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ZapisnikGeneracijaGreska"
  }
}

function greskaPoruka(locale: Locale): string {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: "izvoz.zapisnik" })
  return t("greskaModelOdgovor")
}

/** Kandidati za parsiranje, od najstrožeg ka najblažem oporavku. */
function kandidati(text: string): string[] {
  const out = [text]

  // 1) ```json … ``` (ili gola ``` … ```) markdown ograda oko JSON-a
  const ograda = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (ograda?.[1]) out.push(ograda[1].trim())

  // 2) prvi { … } blok — model je uz JSON dopisao uvod/zaključak u prozi
  const prvi = text.indexOf("{")
  const zadnji = text.lastIndexOf("}")
  if (prvi !== -1 && zadnji > prvi) out.push(text.slice(prvi, zadnji + 1))

  return out
}

function neprazanTekst(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null
}

/** Blagi oporavak modelovog odgovora; `null` = ni jedan kandidat nije dao potpun zapisnik. */
export function parsirajOdgovorModela(text: string): { nalaz: string; zakljucak: string } | null {
  for (const kandidat of kandidati(text)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(kandidat)
    } catch {
      continue
    }
    if (typeof parsed !== "object" || parsed === null) continue
    const nalaz = neprazanTekst((parsed as Record<string, unknown>).nalaz)
    const zakljucak = neprazanTekst((parsed as Record<string, unknown>).zakljucak)
    if (nalaz && zakljucak) return { nalaz, zakljucak }
  }
  return null
}

export async function generateZapisnik(
  input: ZapisnikInput,
  locale: Locale = APP_LOCALE,
): Promise<ZapisnikContent> {
  // Offline / namjerno gašen model: vraća se šablon, ali POŠTENO označen (izvor: "sablon").
  if (zapisnikDryRun()) return dryGenerateZapisnik(input, locale)

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: buildPrompt(input, locale) }],
  })
  const text = msg.content
    .filter((b) => b.type === "text" && "text" in b)
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim()

  const parsed = parsirajOdgovorModela(text)
  if (!parsed) {
    // Odsječen odgovor (stop_reason: "max_tokens"), proza bez JSON-a, nedostaje polje…
    console.error(
      "generateZapisnik: neupotrebljiv odgovor modela",
      JSON.stringify({ stop_reason: (msg as { stop_reason?: unknown }).stop_reason, duzina: text.length }),
    )
    throw new ZapisnikGeneracijaGreska(greskaPoruka(locale))
  }

  return zapisnikContent(parsed.nalaz, parsed.zakljucak, "model")
}
