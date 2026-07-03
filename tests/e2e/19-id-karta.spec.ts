import { test, expect } from "@playwright/test"
import { deleteKlijentByNaziv } from "./db"

// PP-1: kompletan tok ID karte — klijent → ugovor → kontakt → dokument.
// Throwaway klijent (bez termina) → afterAll cascade briše lokacije/ugovore/kontakte/dokumente.
const NAZIV = `E2E IDKARTA ${Date.now()}`

test.describe.configure({ mode: "serial" })

test.afterAll(async () => {
  await deleteKlijentByNaziv(NAZIV).catch(() => {})
})

async function otvoriIdKarta(page: import("@playwright/test").Page) {
  await page.goto("/klijenti?q=" + encodeURIComponent(NAZIV))
  await page.getByTestId("klijent-card").filter({ hasText: NAZIV }).first().click()
  await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)
  await page.getByTestId("tab-id-karta").click()
  await expect(page.getByTestId("tab-id-karta-content")).toBeVisible()
}

test.describe("PP-1 — ID karta (klijent/ugovor/kontakt/dokument)", () => {
  test("kreiraj klijenta i otvori ID karta tab", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("novi-klijent-btn").click()
    await page.getByTestId("novi-klijent-naziv").fill(NAZIV)
    // adresa/telefon/email su obavezni (odluka 2026-07-03)
    await page.getByTestId("novi-klijent-adresa").fill("Testna ulica 1, Banja Luka")
    await page.getByTestId("novi-klijent-telefon").fill("+387 51 000 000")
    await page.getByTestId("novi-klijent-email").fill("e2e-klijent@example.com")
    await page.getByTestId("novi-klijent-submit").click()
    await expect(page.getByTestId("novi-klijent-sheet")).toBeHidden({ timeout: 5000 })
    await otvoriIdKarta(page)
  })

  test("dodaj aktivan ugovor i kontakt", async ({ page }) => {
    await otvoriIdKarta(page)

    await page.getByTestId("novi-ugovor-btn").click()
    await page.getByTestId("ugovor-zavodni").fill("UG-E2E-001")
    await page.getByTestId("ugovor-potpis").fill("2026-01-01")
    await page.getByTestId("ugovor-istek").fill("2027-01-01")
    await page.getByTestId("ugovor-obilasci").fill("2")
    await page.getByTestId("ugovor-submit").click()
    await expect(page.getByTestId("ugovor-sheet")).toBeHidden({ timeout: 5000 })
    await expect(page.getByTestId("ugovor-red")).toContainText("UG-E2E-001")
    await expect(page.getByTestId("ugovor-red")).toContainText("aktivan")

    await page.getByTestId("novi-kontakt-btn").click()
    await page.getByTestId("kontakt-ime").fill("Marko Marković")
    await page.getByTestId("kontakt-funkcija").fill("Direktor")
    await page.getByTestId("kontakt-submit").click()
    await expect(page.getByTestId("kontakt-sheet")).toBeHidden({ timeout: 5000 })
    await expect(page.getByTestId("kontakt-red")).toContainText("Marko Marković")
  })

  test("upload dokumenta tipa ugovor na Dokumenti tabu", async ({ page }) => {
    await page.goto("/klijenti?q=" + encodeURIComponent(NAZIV))
    await page.getByTestId("klijent-card").filter({ hasText: NAZIV }).first().click()
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)
    await page.getByTestId("tab-dokumenti").click()
    await expect(page.getByTestId("klijent-dok-upload")).toBeVisible()
    await page.getByTestId("klijent-dok-tip").selectOption("ugovor")
    await page.getByTestId("klijent-dok-file").setInputFiles({
      name: "ugovor-e2e.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e test"),
    })
    await page.getByTestId("klijent-dok-submit").click()
    await expect(page.getByText("ugovor-e2e.pdf")).toBeVisible({ timeout: 10000 })
  })
})
