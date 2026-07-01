import { test, expect } from "@playwright/test"
import { insertKlijent, deleteTerminiByKlijent, deleteKlijentByNaziv } from "./db"

test.describe("Faza Profil — tab", () => {
  test("Profil tab prikazuje prazno stanje za novog klijenta", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await expect(page.getByTestId("dodaj-provjeru-btn")).toBeVisible()
      await expect(page.getByText("Nema provjera u profilu")).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Faza Profil — dodavanje i generisanje termina", () => {
  test("dodaj provjeru → stavka + generisan termin; duplikat odbijen", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option").first().click()
      await page.getByTestId("profil-interval").fill("12")
      await page.getByTestId("profil-zadnji-datum").fill("2026-01-10")
      await page.getByTestId("profil-submit").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeHidden({ timeout: 5000 })
      // stavka u tabeli
      await expect(page.getByTestId("profil-row")).toHaveCount(1)
      // sljedeći rok = 2027-01-10
      await expect(page.getByTestId("profil-row")).toContainText("2027")
      // termin generisan → vidljiv na /termini filtriran po klijentu
      await page.goto(`/termini?klijent_id=${kid}&mjesec=svi`)
      await expect(page.getByTestId("termin-detalji").first()).toBeVisible()
      // duplikat profila odbijen
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option").first().click()
      await page.getByTestId("profil-zadnji-datum").fill("2026-02-01")
      await page.getByTestId("profil-submit").click()
      await expect(page.getByText("Ova provjera već postoji u profilu.")).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("brisanje stavke ne briše generisani termin", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option").first().click()
      await page.getByTestId("profil-interval").fill("6")
      await page.getByTestId("profil-zadnji-datum").fill("2026-03-01")
      await page.getByTestId("profil-submit").click()
      await expect(page.getByTestId("profil-row")).toHaveCount(1)
      // obriši stavku
      await page.getByTestId("obrisi-profil-btn").click()
      await page.getByTestId("obrisi-profil-potvrdi").click()
      await expect(page.getByTestId("profil-row")).toHaveCount(0)
      // termin i dalje postoji
      await page.goto(`/termini?klijent_id=${kid}&mjesec=svi`)
      await expect(page.getByTestId("termin-detalji").first()).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})
