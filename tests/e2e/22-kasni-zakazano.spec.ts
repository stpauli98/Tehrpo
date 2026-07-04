import { test, expect } from "@playwright/test"
import {
  insertKlijent,
  insertTermin,
  zakaziTermin,
  firstVrstaSaIntervalom,
  deleteTerminiByKlijent,
  deleteKlijentByNaziv,
} from "./db"

test.describe("Kasni + zakazano — oznaka zakazivanja uz Kasni badge", () => {
  test("zakazan termin sa prošlim rokom prikazuje Kasni i 'zak.' oznaku u listi", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    const vrsta = await firstVrstaSaIntervalom()
    const juce = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const danas = new Date().toISOString().slice(0, 10)
    try {
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta.id, rok: juce })
      await zakaziTermin(tid, danas)

      await page.goto(`/plan-aktivnosti?view=lista&klijent_id=${kid}&mjesec=svi&status=svi`)
      const badge = page.getByTestId("status-badge")
      await expect(badge).toBeVisible()
      await expect(badge).toHaveAttribute("data-status", "kasni")
      const hint = page.getByTestId("status-zakazan-hint")
      await expect(hint).toBeVisible()
      await expect(hint).toContainText("zak.")
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})
