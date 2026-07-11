// tests/e2e/30-aktivnost.spec.ts
// Task 11 verifikacija: admin vidi ekran "Aktivnost" (audit log), operater dobija 404.
import { test, expect } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import { ensureOperater } from "./db"

const OP_EMAIL = "e2e-operater@tehpro.test"
const OP_LOZINKA = "E2eOperater2026!"
const OP_IME = "E2E Operater"

test.beforeAll(async () => {
  await ensureOperater(OP_EMAIL, OP_LOZINKA, OP_IME)
})

test("admin vidi ekran Aktivnost", async ({ page }) => {
  await page.goto("/aktivnost")
  await expect(page.getByRole("heading", { name: "Aktivnost" })).toBeVisible({ timeout: 30_000 })
  // Klijentski-renderovana filter labela (useTranslations("aktivnost") u AktivnostFilteri).
  // Hvata MISSING_MESSAGE regresiju: bez namespace-a u CLIENT_NAMESPACES renderuje se
  // ključ ("filteri.akcija") umjesto prevedene labele.
  await expect(page.getByText("Tip akcije")).toBeVisible({ timeout: 30_000 })
})

test("operater dobija 404 na /aktivnost", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const opPage = await ctx.newPage()
    await injectSessionFor(ctx, OP_EMAIL, OP_LOZINKA)
    // Prvo dokaži da operater sesija radi — inače bi tihi login-bounce na /prijava
    // (koji nema "Aktivnost" heading) dao false-pass na negativnoj asertaciji ispod.
    await opPage.goto("/pregled")
    await expect(opPage.getByRole("heading", { name: "Pregled" })).toBeVisible({ timeout: 30_000 })
    // Tek onda /aktivnost: notFound() zadržava URL /aktivnost (404), dok bi login-bounce
    // promijenio URL na /prijava. Asertuj OBOJE da razlikuješ 404-gate od bounce-a.
    await opPage.goto("/aktivnost")
    await expect(opPage).toHaveURL(/\/aktivnost/, { timeout: 30_000 })
    await expect(opPage.getByRole("heading", { name: "Aktivnost" })).toHaveCount(0)
  } finally {
    await ctx.close()
  }
})
