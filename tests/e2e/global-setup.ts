import { envVar, demoEnvFilePostoji, DEMO_ENV_FILE } from "./env"
import { prepoznajCilj, DEMO_REF } from "@/lib/supabase/refs"

/**
 * Playwright globalSetup — jedina tačka kroz koju SVE prolazi, uključujući auth.setup.
 *
 * Postoji zbog stvarnog incidenta (2026-07-20): u git worktree-u je nedostajao
 * .env.development.local, pa je `next dev` tiho pao nazad na .env.local i cijeli
 * E2E prolaz je otišao na PRODUKCIJU — upisao test klijenta i promijenio postavke.
 * Nijedan test nije pao; ništa nije upozorilo.
 *
 * Zato ovdje: ako cilj nije DEMO, testovi se NE pokreću.
 */
export default function globalSetup(): void {
  if (!demoEnvFilePostoji()) {
    throw new Error(
      `E2E: ${DEMO_ENV_FILE} ne postoji u radnom direktorijumu.\n` +
        `Bez njega Next dev pada nazad na .env.local, a to je PRODUKCIJA.\n` +
        `Kopiraj ga iz glavnog checkout-a prije pokretanja testova.`,
    )
  }

  const url = envVar("NEXT_PUBLIC_SUPABASE_URL")
  const cilj = prepoznajCilj(url)
  if (cilj !== "demo") {
    const opis = cilj === "prod" ? "PRODUKCIJU" : "nepoznat projekt"
    throw new Error(
      `E2E: NEXT_PUBLIC_SUPABASE_URL pokazuje na ${opis}, a testovi smiju raditi samo protiv DEMO-a (${DEMO_REF}).\n` +
        `E2E mijenja podatke — pokretanje protiv produkcije je zabranjeno.`,
    )
  }

  console.log(`✔ E2E guard: cilj je DEMO (${DEMO_REF})`)
}
