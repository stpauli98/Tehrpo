import { test, expect } from "@playwright/test"
import { insertKlijent, deleteKlijentByNaziv } from "./db"

test.describe("Info tooltipovi — tab traka", () => {
  test("hover na ⓘ taba Profil prikazuje objašnjenje; klik na tab i dalje radi", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()

      const ikona = page.getByTestId("info-tab-profil")
      await expect(ikona).toBeVisible()
      await ikona.hover()
      await expect(page.getByText("Definicija ponavljajućih provjera")).toBeVisible()

      // ⓘ ne smije pokvariti prebacivanje tabova ni accessible name taba
      await page.getByRole("tab", { name: "Termini" }).click()
      await expect(page.getByTestId("tab-termini-content")).toBeVisible()
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Info tooltipovi — sekcije ID karte", () => {
  test("hover na ⓘ sekcije Ugovori prikazuje objašnjenje", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=id-karta`)
      await expect(page.getByTestId("tab-id-karta-content")).toBeVisible()

      const ikona = page.getByTestId("info-sekcija-ugovori")
      await expect(ikona).toBeVisible()
      await ikona.hover()
      await expect(page.getByText("Samo jedan ugovor može biti aktivan")).toBeVisible()

      await expect(page.getByTestId("info-sekcija-osnovni")).toBeVisible()
      await expect(page.getByTestId("info-sekcija-kontakti-firma")).toBeVisible()
      await expect(page.getByTestId("info-sekcija-usluge")).toBeVisible()
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})
