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
      // Isti tekst postoji dva puta unutar taba (sr-only opis za AT + vizuelni tooltip),
      // pa vizuelni tooltip ciljamo scope-ovanjem na ⓘ ikonu (sr-only span joj je sibling).
      await expect(ikona.getByText("Definicija ponavljajućih provjera")).toBeVisible()

      // a11y invarijanta: tab je opisan preko aria-describedby → sr-only span sa istim tekstom
      await expect(page.getByTestId("tab-profil")).toHaveAttribute(
        "aria-describedby",
        "info-tab-desc-profil",
      )
      const srOpis = page.locator("#info-tab-desc-profil")
      await expect(srOpis).toHaveClass(/sr-only/)
      await expect(srOpis).toContainText("Definicija ponavljajućih provjera")

      // ⓘ ne smije pokvariti prebacivanje tabova ni accessible name taba
      // (^Termini: name mora POČINJATI vidljivom labelom; substring "Termini" bi se
      // poklopio i sa sr-only opisima drugih tabova koji pominju termine)
      await page.getByRole("tab", { name: /^Termini/ }).click()
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
      // vizuelni tooltip unutar ⓘ dugmeta; isti tekst je i aria-label dugmeta (a11y invarijanta)
      await expect(ikona.getByText("Samo jedan ugovor može biti aktivan")).toBeVisible()
      await expect(ikona).toHaveAttribute("aria-label", /Samo jedan ugovor može biti aktivan/)

      await expect(page.getByTestId("info-sekcija-osnovni")).toBeVisible()
      await expect(page.getByTestId("info-sekcija-kontakti-firma")).toBeVisible()
      await expect(page.getByTestId("info-sekcija-usluge")).toBeVisible()
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Info tooltipovi — Kontakti tab", () => {
  test("hover na ⓘ sekcije Kontakt osobe (firma) prikazuje objašnjenje", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=kontakti`)
      await expect(page.getByTestId("tab-kontakti-content")).toBeVisible()

      const ikona = page.getByTestId("info-sekcija-kontakti-firma")
      await expect(ikona).toBeVisible()
      await ikona.hover()
      // vizuelni tooltip unutar ⓘ dugmeta; isti tekst je i aria-label dugmeta (a11y invarijanta)
      await expect(ikona.getByText("Puni spisak kontakata firme sa pretragom")).toBeVisible()
      await expect(ikona).toHaveAttribute("aria-label", /Puni spisak kontakata firme sa pretragom/)
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})
