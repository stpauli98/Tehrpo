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
