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
    // Server akcija radi `revalidatePath`, pa App Router sam pokrene osvježavanje /klijenti.
    // Ako odmah izdamo `page.goto`, ta osvježavajuća navigacija prekine našu i Playwright
    // baci „interrupted by another navigation". Čekamo STANJE (mreža se smirila = refresh je
    // slegao), ne fiksnu pauzu i ne retry.
    await page.waitForLoadState("networkidle")
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
    // SPOJ: PR #83 je dodao sekciju LOKACIJA u kontakt sheet, pa je PR #81 ovdje morao
    // popuniti obavezan naziv nove lokacije — tada je klijent BEZ lokacija dobijao samo
    // granu „Nova lokacija" sa `required` nazivom. Audit grana je to naknadno ispravila
    // (5643856): prisiljavati korisnika da izmisli lokaciju samo da bi unio kontakt firme
    // bio je bug, pa firma bez lokacija sada dobija izričit i PODRAZUMIJEVAN izbor
    // „Sve lokacije — kontakt firme" (lokacija_id = NULL). Zato polje
    // `kontakt-nova-lokacija-naziv` ovdje uopšte nije u DOM-u i #81 verzija linije
    // ne može proći. Namjeru #81 (sekcija postoji i ne smije tiho blokirati submit)
    // čuvamo tako što izbor eksplicitno TVRDIMO umjesto da ga slijepo pretpostavimo —
    // ovo je ujedno regresioni čuvar za 5643856.
    await expect(page.getByTestId("kontakt-lokacija-firma")).toBeChecked()
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
    // „Tip dokumenta" NIJE native <select> nego Base UI Select: testid stoji na
    // SelectTrigger-u (<button role="combobox">), pa `selectOption` ovdje nema šta da radi.
    // Novo ponašanje je ispravno — cijela aplikacija je namjerno prešla na isti Select
    // (isti obrazac vozi i 08-dokumenti.spec.ts / 23-podsjetnici-v2.spec.ts): tastaturna
    // navigacija, aria-activedescendant i prevedene labele koje native <option> ne bi imao.
    // Zato biramo klikom na trigger i role=option, i dodatno tvrdimo da je izbor stvarno
    // primljen (trigger prikazuje „Ugovor") — inače bi tihi promašaj kliknuo pogrešnu opciju
    // a upload bi i dalje prošao sa zadanim tipom.
    const tipTrigger = page.getByTestId("klijent-dok-tip")
    await tipTrigger.click()
    await page.getByRole("option", { name: "Ugovor", exact: true }).click()
    await expect(tipTrigger).toContainText("Ugovor")
    await page.getByTestId("klijent-dok-file").setInputFiles({
      name: "ugovor-e2e.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e test"),
    })
    await page.getByTestId("klijent-dok-submit").click()
    await expect(page.getByText("ugovor-e2e.pdf")).toBeVisible({ timeout: 10000 })
  })
})
