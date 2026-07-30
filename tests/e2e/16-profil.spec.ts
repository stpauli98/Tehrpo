import { test, expect } from "@playwright/test"
import {
  insertKlijent,
  insertLokacija,
  firstVrstaSaIntervalom,
  deleteTerminiByKlijent,
  deleteKlijentByNaziv,
} from "./db"

/** Godina roka: zadnji datum u januaru + interval mjeseci (mirror lib/date addMjeseci). */
function godinaRoka(godina: number, mjesecIdx: number, intervalMjeseci: number): number {
  return godina + Math.floor((mjesecIdx + intervalMjeseci) / 12)
}

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

  test("klijent bez lokacija: dijalog upućuje na unos lokacije", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await expect(page.getByTestId("profil-bez-lokacija")).toBeVisible()
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
    await insertLokacija(kid)
    const vrsta = await firstVrstaSaIntervalom()
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option", { name: vrsta.naziv, exact: true }).click()
      // interval je zaključan i povučen iz vrste
      await expect(page.getByTestId("profil-interval")).toHaveValue(String(vrsta.interval))
      await expect(page.getByTestId("profil-interval")).toBeDisabled()
      await page.getByTestId("profil-lokacija").click()
      await page.getByRole("option", { name: "E2E Lokacija", exact: true }).click()
      await page.getByTestId("profil-zadnji-datum").fill("2026-01-10")
      await page.getByTestId("profil-submit").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeHidden({ timeout: 5000 })
      // stavka u tabeli
      await expect(page.getByTestId("profil-row")).toHaveCount(1)
      // sljedeći rok = 2026-01-10 + interval vrste
      const ocekivanaGodina = godinaRoka(2026, 0, vrsta.interval)
      await expect(page.getByTestId("profil-row")).toContainText(String(ocekivanaGodina))
      // termin generisan → vidljiv na /termini filtriran po klijentu
      await page.goto(`/termini?klijent_id=${kid}&mjesec=svi`)
      await expect(page.getByTestId("termin-detalji").first()).toBeVisible()
      // duplikat profila odbijen (ista vrsta + ista lokacija)
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option", { name: vrsta.naziv, exact: true }).click()
      await page.getByTestId("profil-lokacija").click()
      await page.getByRole("option", { name: "E2E Lokacija", exact: true }).click()
      await page.getByTestId("profil-zadnji-datum").fill("2026-02-01")
      await page.getByTestId("profil-submit").click()
      await expect(page.getByText("Ova provjera već postoji u profilu.")).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("prvi put: prvi rok ide direktno u termin, bez zadnjeg datuma", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    await insertLokacija(kid)
    const vrsta = await firstVrstaSaIntervalom()
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option", { name: vrsta.naziv, exact: true }).click()
      await page.getByTestId("profil-lokacija").click()
      await page.getByRole("option", { name: "E2E Lokacija", exact: true }).click()
      await page.getByTestId("profil-rezim").click()
      await page.getByRole("option", { name: /prvi put/i }).click()
      await page.getByTestId("profil-prvi-rok").fill("2027-05-15")
      await page.getByTestId("profil-submit").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeHidden({ timeout: 5000 })
      // stavka bez zadnjeg datuma, rok = uneseni prvi rok
      await expect(page.getByTestId("profil-row")).toHaveCount(1)
      await expect(page.getByTestId("profil-row")).toContainText("— (prvi put)")
      // negativni lookahead: dokazuje da UI renderuje BEZ završne tačke (standard dd.MM.yyyy)
      await expect(page.getByTestId("profil-row")).toContainText(/15\.05\.2027(?!\.)/)
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("brisanje stavke ne briše generisani termin", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    await insertLokacija(kid)
    const vrsta = await firstVrstaSaIntervalom()
    try {
      await page.goto(`/klijenti/${kid}?tab=profil`)
      await expect(page.getByTestId("tab-profil-content")).toBeVisible()
      await page.waitForLoadState("networkidle")
      await page.getByTestId("dodaj-provjeru-btn").click()
      await expect(page.getByTestId("dodaj-provjeru-sheet")).toBeVisible()
      await page.getByTestId("profil-vrsta").click()
      await page.getByRole("option", { name: vrsta.naziv, exact: true }).click()
      await page.getByTestId("profil-lokacija").click()
      await page.getByRole("option", { name: "E2E Lokacija", exact: true }).click()
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
