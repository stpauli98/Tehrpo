import { test, expect } from "@playwright/test"

test.describe("Faza 2 data layer", () => {
  test("Termini stranica prikazuje broj termina > 0 (seed primijenjen)", async ({ page }) => {
    await page.goto("/termini")
    const countEl = page.getByTestId("termini-count")
    await expect(countEl).toBeVisible()

    const text = await countEl.textContent()
    expect(text).toMatch(/Termina u bazi:\s*\d+/)

    // Ekstrahuj broj i potvrdi > 0
    const match = text?.match(/Termina u bazi:\s*(\d+)/)
    const count = match ? Number(match[1]) : 0
    expect(count).toBeGreaterThan(0)
  })

  test("Bez Supabase grešaka u console na /termini load", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", err => errors.push(err.message))
    page.on("console", msg => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    await page.goto("/termini")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
