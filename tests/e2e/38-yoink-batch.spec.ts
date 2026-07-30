import { test, expect } from "@playwright/test"
import { getPostavkeV2, setPostavkeV2 } from "./db"

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

  test("novi klijent ima puna polja i kreira prvu lokaciju", async ({ page }) => {
    const sufiks = String(Date.now()).slice(-6)
    const naziv = `E2E Firma ${sufiks}`
    await page.goto("/klijenti")
    await page.getByTestId("novi-klijent-btn").click()

    await page.getByTestId("novi-klijent-naziv").fill(naziv)
    await page.getByTestId("novi-klijent-adresa").fill("Kralja Petra 1")
    await page.getByTestId("novi-klijent-telefon").fill("051111222")
    await page.getByTestId("novi-klijent-email").fill(`e2e${sufiks}@tehpro.test`)
    // Polja koja su ranije postojala SAMO u edit formi
    await page.getByTestId("novi-klijent-pib").fill("4400000000001")
    await page.getByTestId("novi-klijent-maticni_broj").fill("11111111")
    await page.getByTestId("novi-klijent-sifra_djelatnosti").fill("4321")
    // Prva lokacija
    await page.getByTestId("novi-klijent-lokacija-naziv").fill("Centrala")
    await page.getByTestId("novi-klijent-lokacija-grad").fill("Banja Luka")
    await page.getByTestId("novi-klijent-submit").click()

    await page.getByTestId("klijenti-search").fill(naziv)
    await page.getByText(naziv).first().click()
    // Matični broj je sačuvan
    await page.getByTestId("uredi-klijent-btn").click()
    await expect(page.getByTestId("edit-klijent-maticni_broj")).toHaveValue("11111111")
    await page.keyboard.press("Escape")
    // Prva lokacija postoji
    await page.getByTestId("tab-lokacije").click()
    await expect(page.getByTestId("lokacije-table")).toContainText("Centrala")
  })

  test("checkbox podsjetnika je neaktivan uz objasnjenje kad je slanje ugaseno", async ({ page }) => {
    // Test sam postavlja preduslov umjesto da se oslanja na zatečeno stanje baze —
    // inače bi prolazio i kad funkcija uopšte nije implementirana.
    // Suite ionako ide sa --workers=1 jer specovi dijele globalni postavke id=1.
    // Pročitaj-pa-vrati: bez restore-a bi ovaj spec tiho mijenjao ponašanje
    // svih kasnijih specova (dijeljeni singleton red postavke id=1).
    const prije = await getPostavkeV2()
    await setPostavkeV2({ salji_klijentima: false })
    try {
      await page.goto("/klijenti")
      await page.getByTestId("klijent-card").first().click()
      await page.getByTestId("tab-lokacije").click()
      await page.getByTestId("nova-lokacija-btn").click()
      await page.getByTestId("lokacija-kontakt-izbor").getByRole("radio", { name: /Novi/ }).click()

      await expect(page.getByTestId("lokacija-kontakt-prima")).toBeDisabled()
      await expect(page.getByTestId("lokacija-kontakt-prima-ugaseno")).toContainText("Postavkama")
    } finally {
      await setPostavkeV2({ salji_klijentima: prije.salji_klijentima })
    }
  })
})
