import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

test.describe("Faza 4 — Klijenti lista", () => {
  test("prikazuje grid klijenata", async ({ page }) => {
    await page.goto("/klijenti")
    await expect(page.getByRole("heading", { name: "Klijenti" })).toBeVisible()
    await expect(page.getByTestId("klijenti-grid")).toBeVisible()
    expect(await page.getByTestId("klijent-card").count()).toBeGreaterThan(0)
    const total = await page.getByTestId("klijenti-total").textContent()
    expect(total).toMatch(/Ukupno klijenata:\s*\d+/)
  })

  test("pretraga 'WAIK' vraća WAIKIKI klijente", async ({ page }) => {
    await page.goto("/klijenti")
    const input = page.getByTestId("klijenti-search")
    await input.fill("WAIK")
    await input.press("Enter")
    await page.waitForURL(/q=WAIK/)
    const cards = page.getByTestId("klijent-card")
    expect(await cards.count()).toBeGreaterThan(0)
    await expect(cards.first()).toContainText(/WAIKIKI/i)
  })

  test("paginacija Sljedeća mijenja stranu", async ({ page }) => {
    await page.goto("/klijenti")
    await expect(page.getByTestId("klijenti-page")).toContainText("Strana 1")
    const next = page.getByRole("link", { name: "Sljedeća" })
    if (await next.count()) {
      await next.click()
      await expect(page.getByTestId("klijenti-page")).toContainText("Strana 2")
    }
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/klijenti")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
