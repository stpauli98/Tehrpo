import { test, expect } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import { ensureKorisnik, deleteKorisnikByEmail } from "./db"

const PREGLED_EMAIL = "e2e-pregled@demo.test"
const PREGLED_LOZINKA = "E2ePregled2026!"
const PREGLED_IME = "E2E Pregled"

// Svaki test kreira svoj kontekst (bez admin storageState).
test.use({ storageState: { cookies: [], origins: [] } })

// Ista zamka kao u 09-asistent: `toHaveURL(..., { timeout: 30_000 })` ispod ne znači ništa
// dok je budžet cijelog testa takođe 30 s. Ako se ovaj spec pokrene bez 09 (npr. sam, ili
// prvi u redu), prva navigacija na `/asistent` plaća prvo dev prevođenje rute i test padne
// na isteku, a ne na pogrešnom ponašanju. Diže se samo budžet — tvrdnje ostaju iste.
test.describe.configure({ timeout: 90_000 })

test.describe("Asistent — pregled (read-only) nema pristup", () => {
  test.beforeAll(async () => {
    await ensureKorisnik(PREGLED_EMAIL, PREGLED_LOZINKA, PREGLED_IME, "pregled")
  })
  test.afterAll(async () => {
    await deleteKorisnikByEmail(PREGLED_EMAIL).catch(() => {})
  })

  test("pregled GET /asistent → redirect na /pregled", async ({ page, context }) => {
    await injectSessionFor(context, PREGLED_EMAIL, PREGLED_LOZINKA)
    await page.goto("/asistent")
    await expect(page).toHaveURL(/\/pregled/, { timeout: 30_000 })
  })

  test("pregled POST /api/chat → 403", async ({ context }) => {
    await injectSessionFor(context, PREGLED_EMAIL, PREGLED_LOZINKA)
    const res = await context.request.post("/api/chat", {
      data: { konverzacija_id: "00000000-0000-0000-0000-000000000001", userText: "test" },
    })
    expect(res.status()).toBe(403)
  })
})
