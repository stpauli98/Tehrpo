import { test, expect } from "@playwright/test"
import { firstKlijentId, firstActiveVrstaId, insertTermin, deleteTermin } from "./db"

test.describe("Prikaz — dorada", () => {
  test("legenda je vidljiva kad je matrica (po mjesecu)", async ({ page }) => {
    await page.goto("/prikaz?mode=mjesec&godina=2026&mjesec=2")
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    await expect(page.getByTestId("matrix-legenda")).toBeVisible()
    await expect(page.getByTestId("matrix-legenda")).toContainText("izvršeno")
    await expect(page.getByTestId("matrix-legenda")).toContainText("Kasni")
  })

  test("legenda NIJE vidljiva u praznom stanju (po klijentu bez izbora)", async ({ page }) => {
    await page.goto("/prikaz")
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
    await expect(page.getByTestId("matrix-legenda")).toHaveCount(0)
  })

  test("(+N) ćelija vodi na filtrirane Termine", async ({ page }) => {
    const klijentId = await firstKlijentId()
    const vrstaId = await firstActiveVrstaId()
    // dva termina isti klijent+vrsta+mjesec (2035-05) → ćelija (+1); 2035 inače prazna
    const t1 = await insertTermin({ klijentId, vrstaId, rok: "2035-05-10" })
    const t2 = await insertTermin({ klijentId, vrstaId, rok: "2035-05-20" })
    try {
      await page.goto(`/prikaz?mode=klijent&klijent=${klijentId}&godina=2035`)
      await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
      // Jedina ćelija koja vodi na /termini je naša (+1); single ćelije vode na /prikaz?selected
      const multi = page.locator('a[data-testid="matrix-cell-filled"][href*="/termini"]')
      await expect(multi).toHaveCount(1)
      const href = await multi.getAttribute("href")
      expect(href).toMatch(new RegExp(`vrsta_id=${vrstaId}`))
      expect(href).toMatch(/mjesec=5/)
      expect(href).toMatch(/godina=2035/)
    } finally {
      await deleteTermin(t1)
      await deleteTermin(t2)
    }
  })
})
