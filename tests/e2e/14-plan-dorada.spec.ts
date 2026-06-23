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
