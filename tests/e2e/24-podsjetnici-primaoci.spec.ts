import { test, expect } from "@playwright/test"
import { insertKlijent, deleteKlijentByNaziv, setPostavkeV2 } from "./db"
import { idiNa } from "./fixtures"

// Podsjetnici → primaoci: combobox bira sačuvani kontakt ILI dodaje ad-hoc „čistu" adresu
// (Task 7 je zamijenio checklist-primalaca ovim combobox UI-jem).
//
// Izolacija: throwaway klijent (isti obrazac kao 04-klijenti/19-id-karta/23-podsjetnici-v2
// "tab firme" test) — kontakt_osobe ima `on delete cascade` na klijent_id (migracija
// 20260627120200_kontakt_osobe.sql), pa brisanje throwaway klijenta u finally ukloni i
// kontakt stvoren u testu. Ad-hoc mejl se čuva na klijent_id koloni pa ga isto briše cascade.
test.describe("Podsjetnici — combobox primalaca (kontakti + ad-hoc)", () => {
  test("izabere kontakt, doda ad-hoc mejl, oba perzistiraju, pa se uklone", async ({ page }) => {
    // Test radi mnogo koraka preko cloud DEMO baze (kreiranje kontakta, dva dodavanja
    // primaoca, reload, dva uklanjanja), a retry petlje ispod imaju vlastiti budžet —
    // u default 30s test-timeout-u se to na webkitu nije stizalo (retry je istekao
    // zajedno sa testom). test.slow() trostruči budžet, pa retry ima prostora.
    test.slow()
    const naziv = "E2E-TMP PRIMAOCI " + Date.now()
    const kid = await insertKlijent(naziv)
    const adHoc = `adhoc-${Date.now()}@example.com`
    try {
      // Gate: sekcija „Slanje firmi" (toggle + combobox) se prikazuje samo kad je globalno
      // slanje firmama uključeno u Postavkama. Uključi ga za trajanje testa.
      await setPostavkeV2({ salji_klijentima: true })

      // 1) Kreiraj jedan kontakt SA mejlom.
      await page.goto(`/klijenti/${kid}?tab=kontakti`)
      await expect(page.getByTestId("tab-kontakti-content")).toBeVisible()
      await page.getByTestId("novi-kontakt-btn").click()
      await expect(page.getByTestId("kontakt-sheet")).toBeVisible()
      await page.getByTestId("kontakt-ime").fill("E2E Sa Mejlom")
      await page.getByTestId("kontakt-email").fill("e2e-primalac@example.com")
      await page.getByTestId("kontakt-submit").click()
      await expect(page.getByTestId("kontakt-sheet")).toBeHidden({ timeout: 5000 })

      // 2) Tab podsjetnici — combobox. idiNa: kreiranje kontakta revalidira ovu rutu,
      //    pa refresh navigacija može prekinuti goto (v. helper u fixtures.ts).
      await idiNa(page, `/klijenti/${kid}?tab=podsjetnici`)
      await expect(page.getByTestId("tab-podsjetnici-content")).toBeVisible()
      // Gate nije bio pouzdan: `setPostavkeV2` upisuje `salji_klijentima` DIREKTNO u
      // bazu, a stranica postavku čita kroz cache — webkit je zato zatekao banner
      // "Globalno slanje firmama je isključeno" i forme nije bilo (chromium je samo
      // pogodio timing). Ako je banner tu, prekidač se uključuje kroz UI: ta server
      // akcija revalidira, pa se forma pojavi u mjestu, bez čekanja na cache TTL.
      if (await page.getByTestId("podsjetnici-global-off").count()) {
        await page.getByTestId("ksp-ukljuci-globalno").click()
      }
      await expect(page.getByTestId("klijent-podsjetnici-form")).toBeVisible()
      const input = page.getByTestId("primaoci-combobox-input")
      const cipKontakt = page.getByTestId(/^primalac-kontakt-/)
      const cipAdHoc = page.getByTestId("primalac-adhoc").filter({ hasText: adHoc })

      // 2a) Izaberi postojeći kontakt iz liste.
      //
      // Namjerno BEZ retry-a: klik na opciju mora raditi iz prvog puta u OBA browsera.
      // Na webkitu nije radio jer je PrimaociCombobox zatvarao listu na blur prije nego
      // onClick stigne (Safari ne fokusira <button>, pa je relatedTarget bio null) —
      // popravljeno u komponenti sa onMouseDown + preventDefault. Ovaj test je čuvar te
      // popravke: retry bi ga učinio zelenim i sa vraćenim bugom.
      await input.click()
      await input.fill("E2E Sa")
      const opcijaKontakt = page.getByTestId(/^opcija-kontakt-/)
      await expect(opcijaKontakt).toHaveCount(1)
      await opcijaKontakt.first().click()
      await expect(cipKontakt).toHaveCount(1)
      await expect(input).toBeEnabled() // sačekaj da transition završi

      // 2b) Dodaj ad-hoc mejl — isti put kroz listu, ista invarijanta.
      await input.fill(adHoc)
      await expect(page.getByTestId("opcija-adhoc")).toBeVisible()
      await page.getByTestId("opcija-adhoc").click()
      await expect(cipAdHoc).toBeVisible()
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
      // Izolacija: vrati globalno slanje na false (DEMO default; global true = živi Resend).
      await setPostavkeV2({ salji_klijentima: false })
      await deleteKlijentByNaziv(naziv)
    }
  })
})
