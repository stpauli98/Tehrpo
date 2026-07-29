import { test, expect, type Page } from "@playwright/test"
import { kreirajFirmuFiksturu, type FirmaFikstura } from "./fixtures"

/**
 * Veza kontakt ↔ lokacija.
 *
 * Zašto postoji: podsjetnici su išli SVIM kontaktima firme, pa je kontakt lokacije 2
 * dobijao obavještenja za lokaciju 1. Logika odabira primalaca pokrivena je unit
 * testovima (`recipients.test.ts`); ovaj spec štiti da se veza može i UNIJETI —
 * bez toga je popravka u motoru tačna ali nedostupna.
 *
 * Vlastita fikstura: spec mijenja kontakte i lokacije, pa ne smije dirati dijeljene
 * DEMO podatke.
 */

test.describe.configure({ mode: "serial" })

let firma: FirmaFikstura

test.beforeAll(async () => {
  // Fikstura pravi firmu sa dvije lokacije — tačno slučaj iz prijave.
  firma = await kreirajFirmuFiksturu({ oznaka: "KONTLOK", lokacije: ["Lokacija A", "Lokacija B"] })
})

test.afterAll(async () => {
  await firma?.obrisi().catch(() => {})
})

async function otvoriTab(page: Page, tab: "kontakti" | "lokacije") {
  await page.goto(`/klijenti/${firma.klijentId}?tab=${tab}`)
  // Čeka se nedvosmislen znak da je tab učitan: dugme za unos postoji u oba taba
  // i jedinstveno je, za razliku od redova kojih ima 0..N.
  await expect(
    tab === "kontakti"
      ? page.getByTestId("novi-kontakt-btn")
      : page.getByTestId("tab-lokacije-content"),
  ).toBeVisible()
}

test.describe("Kontakt ↔ lokacija", () => {
  test("novi kontakt se podrazumijevano vodi kao kontakt firme", async ({ page }) => {
    await otvoriTab(page, "kontakti")
    await page.getByTestId("novi-kontakt-btn").click()
    await expect(page.getByTestId("kontakt-sheet")).toBeVisible()

    // Polje postoji jer firma IMA lokacije, a podrazumijevano je „sve lokacije".
    await expect(page.getByTestId("kontakt-lokacija")).toContainText("Sve lokacije")

    await page.getByTestId("kontakt-ime").fill("Firmin Kontakt")
    await page.getByTestId("kontakt-email").fill("hq@e2e-firma.test")
    await page.getByTestId("kontakt-submit").click()
    await expect(page.getByTestId("kontakt-sheet")).toBeHidden()

    const red = page.getByTestId("kontakt-red").filter({ hasText: "Firmin Kontakt" })
    await expect(red).toBeVisible()
    await expect(red).toContainText("Sve lokacije")
  })

  test("kontakt se veže za lokaciju i bedž to pokazuje", async ({ page }) => {
    await otvoriTab(page, "kontakti")
    await page.getByTestId("novi-kontakt-btn").click()
    await page.getByTestId("kontakt-ime").fill("Kontakt Lokacije A")
    await page.getByTestId("kontakt-email").fill("a@e2e-firma.test")

    await page.getByTestId("kontakt-lokacija").click()
    await page.getByRole("option", { name: "Lokacija A", exact: true }).click()
    await page.getByTestId("kontakt-submit").click()
    await expect(page.getByTestId("kontakt-sheet")).toBeHidden()

    const red = page.getByTestId("kontakt-red").filter({ hasText: "Kontakt Lokacije A" })
    await expect(red).toContainText("Lokacija A")
    // Ključno: NE smije pisati da prima za sve — inače bi i dalje dobijao tuđe podsjetnike.
    await expect(red).not.toContainText("Sve lokacije")
  })

  test("tab Lokacije prikazuje vezani kontakt uz svoju lokaciju, ne uz drugu", async ({ page }) => {
    await otvoriTab(page, "lokacije")
    const redA = page.getByTestId("lokacija-row").filter({ hasText: "Lokacija A" })
    const redB = page.getByTestId("lokacija-row").filter({ hasText: "Lokacija B" })
    await expect(redA).toContainText("Kontakt Lokacije A")
    await expect(redB).not.toContainText("Kontakt Lokacije A")
  })

  test("nova lokacija sa novim kontaktom ih odmah povezuje", async ({ page }) => {
    await otvoriTab(page, "lokacije")
    await page.getByTestId("nova-lokacija-btn").or(page.getByRole("button", { name: /Nova lokacija/i })).first().click()
    await expect(page.getByTestId("lokacija-form")).toBeVisible()

    await page.getByTestId("lokacija-naziv").fill("Lokacija C")
    await page.getByTestId("lokacija-kontakt-izbor").getByRole("radio", { name: /Novi kontakt/i }).click()
    await page.getByTestId("lokacija-kontakt-ime").fill("Kontakt Lokacije C")
    await page.getByTestId("lokacija-kontakt-email").fill("c@e2e-firma.test")
    await page.getByTestId("lokacija-submit").click()
    await expect(page.getByTestId("lokacija-form")).toBeHidden()

    // Veza je vidljiva iz oba smjera.
    const redC = page.getByTestId("lokacija-row").filter({ hasText: "Lokacija C" })
    await expect(redC).toContainText("Kontakt Lokacije C")

    await otvoriTab(page, "kontakti")
    await expect(
      page.getByTestId("kontakt-red").filter({ hasText: "Kontakt Lokacije C" }),
    ).toContainText("Lokacija C")
  })
})
