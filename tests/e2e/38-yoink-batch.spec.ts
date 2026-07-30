import { test, expect } from "@playwright/test"

test.describe("Yoink batch 2026-07-30", () => {
  test("tab se zove Usluge, ne Profil", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)
    await expect(page.getByTestId("tab-profil")).toContainText("Usluge")
    await expect(page.getByTestId("tab-profil")).not.toContainText("Profil")
  })

  test("ugovor se moze staviti na neodredjeno", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.getByTestId("tab-id-karta").click()
    await page.getByTestId("novi-ugovor-btn").click()

    await expect(page.getByTestId("ugovor-sheet")).toBeVisible()
    await page.getByTestId("ugovor-neodredjeno").click()
    // Datum isteka postaje neaktivan
    await expect(page.getByTestId("ugovor-istek")).toBeDisabled()
  })

  test("vazenje nudi custom broj mjeseci", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.getByTestId("tab-id-karta").click()
    await page.getByTestId("novi-ugovor-btn").click()

    await page.getByTestId("ugovor-vazenje").click()
    await page.getByRole("option", { name: /Drugo/ }).click()
    await expect(page.getByTestId("ugovor-vazenje-custom")).toBeVisible()
    await page.getByTestId("ugovor-vazenje-custom").fill("18")
    await expect(page.getByTestId("ugovor-vazenje-custom")).toHaveValue("18")
  })

  test("novi kontakt moze kreirati novu lokaciju", async ({ page }) => {
    const sufiks = String(Date.now()).slice(-6)
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await page.getByTestId("tab-kontakti").click()
    await page.getByTestId("novi-kontakt-btn").click()

    await page.getByTestId("kontakt-ime").fill(`E2E Kontakt ${sufiks}`)
    await page.getByTestId("kontakt-lokacija-izbor").getByRole("radio", { name: /Nova/ }).click()
    await page.getByTestId("kontakt-nova-lokacija-naziv").fill(`E2E Lokacija ${sufiks}`)
    await page.getByTestId("kontakt-nova-lokacija-grad").fill("Banja Luka")
    await page.getByTestId("kontakt-nova-lokacija-adresa").fill("Testna 1")
    await page.getByTestId("kontakt-submit").click()

    // Lokacija se pojavljuje u tabu Lokacije
    await page.getByTestId("tab-lokacije").click()
    await expect(page.getByTestId("lokacije-table")).toContainText(`E2E Lokacija ${sufiks}`)
  })
})
