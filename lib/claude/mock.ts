import type { ChatEvent } from "./chat"

/** Deterministička mock sekvenca za E2E / rad bez ANTHROPIC_API_KEY.
 *  Ne poziva mrežu; grana se po ključnim riječima u upitu. */
export function mockChatEvents(userText: string): ChatEvent[] {
  const t = userText.toLowerCase()
  const wantsZapisnik = /zapisnik/.test(t)

  if (wantsZapisnik) {
    return [
      { type: "tool", tool: "predloziZapisnik", label: "Pripremam prijedlog zapisnika…" },
      { type: "text", text: "Pripremio sam prijedlog zapisnika. " },
      { type: "text", text: 'Pogledaj nalaz i zaključak ispod pa klikni "Snimi zapisnik" ako želiš sačuvati.' },
      {
        type: "proposal",
        data: {
          terminId: "00000000-0000-0000-0000-000000000000",
          klijent: "Demo klijent",
          vrsta: "Demo provjera",
          datum: "2026-06-22",
          nalaz: "Mock nalaz za potrebe testiranja.",
          zakljucak: "Mock zaključak.",
        },
      },
      { type: "done" },
    ]
  }

  return [
    { type: "tool", tool: "searchTermini", label: "Pretražujem termine…" },
    { type: "text", text: "Evo pregleda na osnovu trenutnih podataka. " },
    { type: "text", text: "Pitaj me dalje za detalje o terminima ili firmama." },
    { type: "done" },
  ]
}
