/**
 * Jedan izvor istine za protokol chata (S15).
 *
 * **Ovaj fajl NE SMIJE imati nijedan import.** Uvoze ga i klijent komponente
 * (`AsistentChat`, `ChatInput`, `ChatMessage`); import iz `chat.ts` bi u klijent
 * bundle povukao Anthropic SDK + `lib/env` i srušio build. Tipovi se uvoze kao
 * `import type` (erased), a `MAX_PORUKA_ZNAKOVA` je goli literal bez zavisnosti.
 */

/** Prijedlog zapisnika koji alat `predloziZapisnik` emituje, a UI prikazuje u kartici. */
export type ProposalData = {
  terminId: string
  klijent: string
  vrsta: string
  datum: string
  nalaz: string
  zakljucak: string
}

/** Jedan NDJSON događaj koji `/api/chat` streamuje klijentu. */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; label: string }
  | { type: "proposal"; data: ProposalData }
  | { type: "error"; message: string }
  | { type: "done" }

/** Jedan red historije razgovora koji se šalje modelu. */
export type ChatTurn = { role: "user" | "assistant"; text: string }

/**
 * Maksimalna dužina jedne korisničke poruke.
 * Jedan izvor za server (zod schema u `app/api/chat/route.ts`) i klijent
 * (`maxLength` + brojač u `ChatInput`) — inače predugačka poruka padne na
 * nevidljivi 400.
 */
export const MAX_PORUKA_ZNAKOVA = 4000
