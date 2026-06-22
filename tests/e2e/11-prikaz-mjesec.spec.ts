import { test, expect } from "@playwright/test"

// Deterministic: Februar (mjesec=2) ima 94 WAIKIKI termina u 2026.
// Provjereno query-jem: SELECT EXTRACT(MONTH ...) FROM termini_view WHERE klijent_naziv ILIKE '%WAIKIKI%'
const SEEDED_MONTH = 2

test.describe("Faza matrica — po mjesecu", () => {
  test("toggle 'Po mjesecu' prikaže matricu vrste×firme", async ({ page }) => {
    await page.goto(`/prikaz?mode=mjesec&godina=2026&mjesec=${SEEDED_MONTH}`)
    await expect(page.getByTestId("prikaz-mode-toggle")).toBeVisible()
    // "Po mjesecu" button treba biti aktivan (dark bg)
    await expect(page.getByTestId("prikaz-mode-mjesec")).toBeVisible()
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    // header mora sadržati bar jednu firmu iz seeda
    await expect(page.getByTestId("prikaz-matrix")).toContainText(/WAIKIKI/i)
  })

  test("toggle 'Po mjesecu' click iz default stanja mijenja URL", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-mode-mjesec").click()
    await page.waitForURL(/mode=mjesec/)
    await expect(page.getByTestId("prikaz-mode-toggle")).toBeVisible()
    // matrica treba biti vidljiva (tekući mjesec se koristi kao default)
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
  })

  test("povratak 'Po klijentu' radi", async ({ page }) => {
    await page.goto(`/prikaz?mode=mjesec&godina=2026&mjesec=${SEEDED_MONTH}`)
    await page.getByTestId("prikaz-mode-klijent").click()
    await page.waitForURL(/mode=klijent/)
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
  })

  test("bez console grešaka u mjesec modu", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto(`/prikaz?mode=mjesec&godina=2026&mjesec=${SEEDED_MONTH}`)
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
