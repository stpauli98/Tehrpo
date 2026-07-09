import { test, expect } from "@playwright/test"
import { insertKlijent, deleteKlijentByNaziv } from "./db"

// Podsjetnici → primaoci: combobox bira sačuvani kontakt ILI dodaje ad-hoc „čistu" adresu
// (Task 7 je zamijenio checklist-primalaca ovim combobox UI-jem).
//
// Izolacija: throwaway klijent (isti obrazac kao 04-klijenti/19-id-karta/23-podsjetnici-v2
// "tab firme" test) — kontakt_osobe ima `on delete cascade` na klijent_id (migracija
// 20260627120200_kontakt_osobe.sql), pa brisanje throwaway klijenta u finally ukloni i
// kontakt stvoren u testu. Ad-hoc mejl se čuva na klijent_id koloni pa ga isto briše cascade.
test.describe("Podsjetnici — combobox primalaca (kontakti + ad-hoc)", () => {
  test("izabere kontakt, doda ad-hoc mejl, oba perzistiraju, pa se uklone", async ({ page }) => {
    const naziv = "E2E-TMP PRIMAOCI " + Date.now()
    const kid = await insertKlijent(naziv)
    const adHoc = `adhoc-${Date.now()}@example.com`
    try {
      // 1) Kreiraj jedan kontakt SA mejlom.
      await page.goto(`/klijenti/${kid}?tab=kontakti`)
      await expect(page.getByTestId("tab-kontakti-content")).toBeVisible()
      await page.getByTestId("novi-kontakt-btn").click()
      await expect(page.getByTestId("kontakt-sheet")).toBeVisible()
      await page.getByTestId("kontakt-ime").fill("E2E Sa Mejlom")
      await page.getByTestId("kontakt-email").fill("e2e-primalac@example.com")
      await page.getByTestId("kontakt-submit").click()
      await expect(page.getByTestId("kontakt-sheet")).toBeHidden({ timeout: 5000 })

      // 2) Tab podsjetnici — combobox.
      await page.goto(`/klijenti/${kid}?tab=podsjetnici`)
      await expect(page.getByTestId("klijent-podsjetnici-form")).toBeVisible()
      const input = page.getByTestId("primaoci-combobox-input")

      // 2a) Izaberi postojeći kontakt iz liste.
      await input.click()
      await input.fill("E2E Sa")
      const opcijaKontakt = page.getByTestId(/^opcija-kontakt-/)
      await expect(opcijaKontakt).toHaveCount(1)
      await opcijaKontakt.first().click()
      await expect(page.getByTestId(/^primalac-kontakt-/)).toHaveCount(1)
      await expect(input).toBeEnabled() // sačekaj da transition završi

      // 2b) Dodaj ad-hoc mejl.
      await input.fill(adHoc)
      await expect(page.getByTestId("opcija-adhoc")).toBeVisible()
      await page.getByTestId("opcija-adhoc").click()
      await expect(page.getByTestId("primalac-adhoc").filter({ hasText: adHoc })).toBeVisible()
      await expect(input).toBeEnabled()

      // 3) Reload → oba perzistirala (SSR fetch, ne lokalni state).
      await page.reload()
      await expect(page.getByTestId(/^primalac-kontakt-/)).toHaveCount(1)
      await expect(page.getByTestId("primalac-adhoc").filter({ hasText: adHoc })).toBeVisible()

      // 4) Ukloni oba (izolacija).
      await page.getByTestId(/^ukloni-kontakt-/).first().click()
      await expect(page.getByTestId(/^primalac-kontakt-/)).toHaveCount(0)
      await page.getByTestId(`ukloni-adhoc-${adHoc}`).click()
      await expect(page.getByTestId("primalac-adhoc")).toHaveCount(0)
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})
