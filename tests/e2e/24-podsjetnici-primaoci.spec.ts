import { test, expect } from "@playwright/test"
import { insertKlijent, deleteKlijentByNaziv } from "./db"

// Podsjetnici → primaoci se biraju čekiranjem kontakata firme (Task 5 je zamijenio
// chip email UI i jedinstveno tekstualno edit-form polje za primaoce ovim checklistom).
//
// Izolacija: throwaway klijent (isti obrazac kao 04-klijenti/19-id-karta/23-podsjetnici-v2
// "tab firme" test) — kontakt_osobe ima `on delete cascade` na klijent_id (migracija
// 20260627120200_kontakt_osobe.sql), pa brisanje throwaway klijenta u finally ukloni i
// oba kontakta stvorena u testu. To je pouzdanije od ručnog brisanja kontakata "u koraku
// 4", jer se izvrši i ako test padne na pola (finally), umjesto da ostavi trajni ostatak
// na dijeljenoj DEMO firmi.
test.describe("Podsjetnici — izbor primalaca iz kontakata", () => {
  test("kontakt bez mejla je disabled; kontakt sa mejlom se može čekirati, perzistira, odčekirati", async ({
    page,
  }) => {
    const naziv = "E2E-TMP PRIMAOCI " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      // 1) Tab kontakti — kreiraj kontakt SA mejlom i kontakt BEZ mejla.
      await page.goto(`/klijenti/${kid}?tab=kontakti`)
      await expect(page.getByTestId("tab-kontakti-content")).toBeVisible()

      await page.getByTestId("novi-kontakt-btn").click()
      await expect(page.getByTestId("kontakt-sheet")).toBeVisible()
      await page.getByTestId("kontakt-ime").fill("E2E Sa Mejlom")
      await page.getByTestId("kontakt-email").fill("e2e-primalac@example.com")
      await page.getByTestId("kontakt-submit").click()
      // Sačekaj da se sheet ZATVORI prije ponovnog otvaranja (base-ui timing + router.refresh).
      await expect(page.getByTestId("kontakt-sheet")).toBeHidden({ timeout: 5000 })

      await page.getByTestId("novi-kontakt-btn").click()
      await expect(page.getByTestId("kontakt-sheet")).toBeVisible()
      await page.getByTestId("kontakt-ime").fill("E2E Bez Mejla")
      await page.getByTestId("kontakt-submit").click()
      await expect(page.getByTestId("kontakt-sheet")).toBeHidden({ timeout: 5000 })

      await expect(page.getByTestId("kontakt-red").filter({ hasText: "E2E Sa Mejlom" })).toBeVisible()
      await expect(page.getByTestId("kontakt-red").filter({ hasText: "E2E Bez Mejla" })).toBeVisible()

      // 2) Tab podsjetnici — checklist primalaca iz kontakata.
      await page.goto(`/klijenti/${kid}?tab=podsjetnici`)
      await expect(page.getByTestId("klijent-podsjetnici-form")).toBeVisible()
      await expect(page.getByTestId("klijent-primaoci-prazno")).toHaveCount(0)

      const redovi = page.getByTestId(/^klijent-primalac-red-/)
      await expect(redovi).toHaveCount(2)

      // Kontakt bez mejla → checkbox disabled + naznaka "nema email".
      const redBezMejla = redovi.filter({ hasText: "E2E Bez Mejla" })
      const cbBezMejla = redBezMejla.getByRole("checkbox")
      await expect(cbBezMejla).toBeDisabled()
      await expect(redBezMejla.locator('[data-testid^="klijent-primalac-nema-email-"]')).toBeVisible()

      // Kontakt sa mejlom → čekiraj.
      const redSaMejlom = redovi.filter({ hasText: "E2E Sa Mejlom" })
      const cbSaMejlom = redSaMejlom.getByRole("checkbox")
      await expect(cbSaMejlom).toBeEnabled()
      await expect(cbSaMejlom).not.toBeChecked()
      await cbSaMejlom.check()
      await expect(cbSaMejlom).toBeChecked()
      // Sačekaj da useTransition završi (checkbox se disable-uje dok traje server action) prije
      // reload-a — inače reload može pretrčati in-flight upis i test lažno prođe na optimističkom
      // lokalnom stanju umjesto na stvarnom DB round-tripu (isti obrazac kao 23-podsjetnici-v2.spec.ts).
      await expect(cbSaMejlom).toBeEnabled()

      // 3) Reload — potvrdi da je izbor stvarno perzistiran u DB (SSR fetch), ne samo lokalni
      // React state.
      await page.reload()
      const cbSaMejlom2 = page.getByTestId(/^klijent-primalac-red-/).filter({ hasText: "E2E Sa Mejlom" }).getByRole("checkbox")
      await expect(cbSaMejlom2).toBeChecked()

      // 4) Počisti: odčekiraj primaoca (izolacija) — brisanje throwaway klijenta u finally
      // uklanja oba kontakta (cascade), pa nema potrebe za ručnim brisanjem preko UI-ja.
      await cbSaMejlom2.uncheck()
      await expect(cbSaMejlom2).not.toBeChecked()
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})
