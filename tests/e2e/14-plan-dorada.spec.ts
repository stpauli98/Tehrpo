import { test, expect } from "@playwright/test"

test.describe("Plan dorada — legenda i ćelija", () => {
  test("legenda je vidljiva ispod kalendara sa 5 statusa", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    const legenda = page.getByTestId("plan-legenda")
    await expect(legenda).toBeVisible()
    await Promise.all(
      ["Izvršeno", "Planirano", "Zakazano", "Kasni", "Otkazano"].map((label) =>
        expect(legenda.getByText(label, { exact: true })).toBeVisible()
      )
    )
  })

  test("nema sivog count-broja u uglu ćelije (samo broj dana + 'još N')", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    // Stari count-span je bio text-[10px] text-slate-400 sa golim brojem termina.
    // Provjeravamo da ćelija sa terminima NE sadrži drugi broj pored broja dana;
    // umjesto toga preljev se vidi kroz "još N".
    await expect(page.getByText(/^još \d+$/).first()).toBeVisible()
    // negativna: uklonjeni count-span je imao klase text-[10px] text-slate-400 (sivi broj);
    // "još N" koristi text-brand pa se ne poklapa — ovo mora biti 0
    await expect(page.locator('.text-\\[10px\\].text-slate-400')).toHaveCount(0)
  })
})

test.describe("Plan dorada — mjesec dropdown", () => {
  test("izbor mjeseca mijenja ?mjesec= i label", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    await expect(page.getByTestId("plan-nav-label")).toContainText("Jul")
    await page.getByTestId("plan-nav-mjesec").click()
    await page.getByRole("option", { name: "Decembar" }).click()
    await page.waitForURL(/mjesec=12/)
    await expect(page.getByTestId("plan-nav-label")).toContainText("Decembar")
  })
})

test.describe("Plan dorada — klik model ćelije", () => {
  test("klik na pojedinačni termin otvara TerminSheet direktno", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    const termin = page.getByTestId("cell-termin").first()
    await expect(termin).toBeVisible()
    await termin.click()
    await page.waitForURL(/selected=/)
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
  })

  test("klik na pozadinu dana (ne na termin) otvara dnevni sidebar", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    // dan 28 ima puno termina; klik na pozadinski dan-link (broj/prazni dio)
    const dayLink = page.locator('[data-testid="plan-day-cell"][data-date="2026-07-28"]')
    await expect(dayLink).toBeVisible()
    // Klikamo pri vrhu ćelije (oblast broja dana) gdje nema cell-termin linkova
    await dayLink.click({ position: { x: 10, y: 6 } })
    await page.waitForURL(/dan=2026-07-28/)
    await expect(page.getByTestId("plan-sidebar")).toBeVisible()
  })
})
