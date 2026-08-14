// tests/e2e/18-auth-rls.spec.ts
// EPIK A — Task 11 verifikacija: RLS izolacija po dodjeli.
// Zahtijeva primijenjenu RLS migraciju (20260626211000_rls_enable.sql).
import { test, expect } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import {
  ensureOperater,
  assignKlijent,
  clearDodjele,
  insertKlijent,
  deleteKlijentByNaziv,
} from "./db"

const OP_EMAIL = "e2e-operater@demo.test"
const OP_LOZINKA = "E2eOperater2026!"
const OP_IME = "E2E Operater"
const KLIJENT_VIDLJIV = "E2E Vidljiv DOO"
const KLIJENT_SKRIVEN = "E2E Skriven DOO"

// Ovaj fajl NE koristi admin storageState — svaki test kreira svoj kontekst.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe("EPIK A — RLS izolacija po dodjeli", () => {
  let opId = ""
  let vidljivId = ""

  test.beforeAll(async () => {
    opId = await ensureOperater(OP_EMAIL, OP_LOZINKA, OP_IME)
    await deleteKlijentByNaziv(KLIJENT_VIDLJIV).catch(() => {})
    await deleteKlijentByNaziv(KLIJENT_SKRIVEN).catch(() => {})
    vidljivId = await insertKlijent(KLIJENT_VIDLJIV)
    await insertKlijent(KLIJENT_SKRIVEN)
    await clearDodjele(opId)
    await assignKlijent(opId, vidljivId)
  })

  test.afterAll(async () => {
    await clearDodjele(opId)
    await deleteKlijentByNaziv(KLIJENT_VIDLJIV).catch(() => {})
    await deleteKlijentByNaziv(KLIJENT_SKRIVEN).catch(() => {})
  })

  test("neprijavljen korisnik → redirect na /prijava", async ({ page }) => {
    await page.goto("/termini")
    await expect(page).toHaveURL(/\/prijava/, { timeout: 30_000 })
  })

  test("operater vidi SAMO dodijeljenog klijenta", async ({ page, context }) => {
    await injectSessionFor(context, OP_EMAIL, OP_LOZINKA)
    await page.goto("/klijenti")
    await expect(page.getByText(KLIJENT_VIDLJIV)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(KLIJENT_SKRIVEN)).toHaveCount(0)
  })

  test("operater nema tab 'Korisnici' u /postavke", async ({ page, context }) => {
    await injectSessionFor(context, OP_EMAIL, OP_LOZINKA)
    await page.goto("/postavke")
    await expect(page.getByRole("heading", { name: "Postavke" })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("heading", { name: "Korisnici" })).toHaveCount(0)
  })
})
