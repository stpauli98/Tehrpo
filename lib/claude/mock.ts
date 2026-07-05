import type { ChatEvent } from "./chat"
import { APP_LOCALE, type Locale } from "@/lib/locale"

// Korisniku vidljivi mock tekstovi asistenta (dry-run mod: CHAT_DRY_RUN=1 ili bez
// ANTHROPIC_API_KEY — ovo je i stvarno korisničko iskustvo kad ključ nije podešen, ne
// samo test fixture). Lokalno-ključana mapa, isti pristup kao MOCK_SABLONI u
// lib/zapisnik/content.ts: sr ostaje byte-identičan postojećem tekstu.
// `klijent`/`vrsta` u proposal-u ostaju netaknuti (odgovaraju DB sadržaju — naziv firme
// i vrsta provjere se ne prevode, isto kao input.klijent/input.vrstaProvjere u content.ts).
type MockTekstovi = {
  labelZapisnik: string
  labelPretraga: string
  zapisnikTekst1: string
  zapisnikTekst2: string
  pretragaTekst1: string
  pretragaTekst2: string
  mockNalaz: string
  mockZakljucak: string
}

const MOCK_TEKSTOVI: Record<Locale, MockTekstovi> = {
  sr: {
    labelZapisnik: "Pripremam prijedlog zapisnika…",
    labelPretraga: "Pretražujem termine…",
    zapisnikTekst1: "Pripremio sam prijedlog zapisnika. ",
    zapisnikTekst2: 'Pogledaj nalaz i zaključak ispod pa klikni "Snimi zapisnik" ako želiš sačuvati.',
    pretragaTekst1: "Evo pregleda na osnovu trenutnih podataka. ",
    pretragaTekst2: "Pitaj me dalje za detalje o terminima ili firmama.",
    mockNalaz: "Mock nalaz za potrebe testiranja.",
    mockZakljucak: "Mock zaključak.",
  },
  en: {
    labelZapisnik: "Preparing the minutes proposal…",
    labelPretraga: "Searching appointments…",
    zapisnikTekst1: "I've prepared a draft of the minutes. ",
    zapisnikTekst2: 'Check the findings and conclusion below, then click "Save minutes" if you want to save it.',
    pretragaTekst1: "Here's an overview based on the current data. ",
    pretragaTekst2: "Ask me for more details about appointments or companies.",
    mockNalaz: "Mock findings for testing purposes.",
    mockZakljucak: "Mock conclusion.",
  },
  de: {
    labelZapisnik: "Protokollentwurf wird vorbereitet…",
    labelPretraga: "Termine werden durchsucht…",
    zapisnikTekst1: "Ich habe einen Protokollentwurf vorbereitet. ",
    zapisnikTekst2: 'Sieh dir Befund und Schlussfolgerung unten an und klicke auf "Protokoll speichern", wenn du sie speichern möchtest.',
    pretragaTekst1: "Hier ist ein Überblick basierend auf den aktuellen Daten. ",
    pretragaTekst2: "Frag mich nach weiteren Details zu Terminen oder Firmen.",
    mockNalaz: "Mock-Befund zu Testzwecken.",
    mockZakljucak: "Mock-Schlussfolgerung.",
  },
}

/** Deterministička mock sekvenca za E2E / rad bez ANTHROPIC_API_KEY.
 *  Ne poziva mrežu; grana se po ključnim riječima u upitu. */
export function mockChatEvents(userText: string, locale: Locale = APP_LOCALE): ChatEvent[] {
  const t = userText.toLowerCase()
  const wantsZapisnik = /zapisnik/.test(t)
  const m = MOCK_TEKSTOVI[locale]

  if (wantsZapisnik) {
    return [
      { type: "tool", tool: "predloziZapisnik", label: m.labelZapisnik },
      { type: "text", text: m.zapisnikTekst1 },
      { type: "text", text: m.zapisnikTekst2 },
      {
        type: "proposal",
        data: {
          terminId: "00000000-0000-0000-0000-000000000000",
          klijent: "Demo klijent",
          vrsta: "Demo provjera",
          datum: "2026-06-22",
          nalaz: m.mockNalaz,
          zakljucak: m.mockZakljucak,
        },
      },
      { type: "done" },
    ]
  }

  return [
    { type: "tool", tool: "searchTermini", label: m.labelPretraga },
    { type: "text", text: m.pretragaTekst1 },
    { type: "text", text: m.pretragaTekst2 },
    { type: "done" },
  ]
}
