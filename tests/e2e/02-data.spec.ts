import { test, expect } from "@playwright/test"

test.describe("Faza 2 data layer", () => {
  test("Termini stranica prikazuje broj termina > 0 (seed primijenjen)", async ({ page }) => {
    await page.goto("/termini?mjesec=svi")
    const totalEl = page.getByTestId("termini-total")
    await expect(totalEl).toBeVisible()

    const text = await totalEl.textContent()
    const count = Number((text ?? "").replace(/\D+/g, ""))
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
