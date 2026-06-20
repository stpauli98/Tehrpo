import { test, expect } from "@playwright/test"

// Serijsko izvršavanje za cijeli fajl: testovi mark-izvršeno i Novi termin
// mijenjaju zajedničku lokalnu bazu; paralelni workeri (Chromium+WebKit) bi
// trkali na before/after brojevima i davali lažne padove.
test.describe.configure({ mode: "serial" })

test.describe("Faza 3 — Termini stats", () => {
  test("prikazuje 4 stat kartice sa brojevima", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByRole("heading", { name: "Termini" })).toBeVisible()

    const stats = page.getByTestId("termini-stats")
    await expect(stats).toBeVisible()

    await Promise.all(
      ["stat-ukupno", "stat-ovog-mjeseca", "stat-kasni", "stat-izvrseno"].map((id) =>
        expect(page.getByTestId(id)).toBeVisible()
      )
    )

    // Ukupno mora biti > 0 (seed = 1000)
    const ukupno = await page.getByTestId("stat-ukupno-value").textContent()
    expect(Number(ukupno)).toBeGreaterThan(0)
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/termini")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
