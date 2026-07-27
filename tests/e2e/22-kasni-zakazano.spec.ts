import { test, expect } from "@playwright/test"
import {
  insertKlijent,
  insertTermin,
  zakaziTermin,
  firstVrstaSaIntervalom,
  deleteTerminiByKlijent,
  deleteKlijentByNaziv,
} from "./db"

test.describe("Kasni + zakazano — oznaka zakazivanja uz Kasni badge", () => {
  test("zakazan termin sa prošlim rokom prikazuje Kasni i 'zak.' oznaku u listi", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    const vrsta = await firstVrstaSaIntervalom()
    const juce = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const danas = new Date().toISOString().slice(0, 10)
    try {
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta.id, rok: juce })
      await zakaziTermin(tid, danas)

      await page.goto(`/plan-aktivnosti?view=lista&klijent_id=${kid}&mjesec=svi&status=svi`)
      const badge = page.getByTestId("status-badge")
      await expect(badge).toBeVisible()
      await expect(badge).toHaveAttribute("data-status", "kasni")
      const hint = page.getByTestId("status-zakazan-hint")
      await expect(hint).toBeVisible()
      await expect(hint).toContainText("zak.")
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Validacija datuma izvršenja", () => {
  test("budući datum izvršenja vraća prijateljsku poruku, ne sirovi PG error", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    const vrsta = await firstVrstaSaIntervalom()
    const juce = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const sutra = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    try {
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta.id, rok: juce })

      await page.goto(`/plan-aktivnosti?view=lista&klijent_id=${kid}&mjesec=svi&status=svi&selected=${tid}`)
      await expect(page.getByTestId("termin-sheet")).toBeVisible()

      // Klijentska pre-validacija (S2): polje nosi `max` = danas, pa pregledač sam
      // odbija budući datum i forma se uopšte ne šalje.
      const danas = new Date().toISOString().slice(0, 10)
      await expect(page.getByTestId("mark-datum")).toHaveAttribute("max", danas)

      // Server ostaje izvor istine — zaobiđi native validaciju forme (`noValidate`,
      // atribut kojim React ovdje ne upravlja) da zahtjev stvarno ode na server, pa
      // provjeri da vraća prijateljsku poruku (a ne sirovi PG „check constraint").
      await page
        .getByTestId("mark-done-form")
        .evaluate((f) => { (f as HTMLFormElement).noValidate = true })
      await page.getByTestId("mark-datum").fill(sutra)
      await page.getByTestId("mark-done-submit").click()

      const greska = page.getByTestId("mark-done-form").getByRole("alert")
      await expect(greska).toBeVisible()
      await expect(greska).toContainText("budućnosti")
      await expect(greska).not.toContainText("check constraint")
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Zakazani datum — pozicioniranje i upozorenje", () => {
  test("kalendar prikazuje termin na zakazanom danu, ne na roku", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    const vrsta = await firstVrstaSaIntervalom()
    // rok 13., zakazan 20. istog (budućeg) mjeseca — oba u istom prikazu mjeseca
    const now = new Date()
    const g = now.getUTCFullYear()
    const m = String(now.getUTCMonth() + 1).padStart(2, "0")
    const rok = `${g}-${m}-13`
    const zakazan = `${g}-${m}-20`
    try {
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta.id, rok })
      await zakaziTermin(tid, zakazan)

      await page.goto(`/plan-aktivnosti?view=kalendar&godina=${g}&mjesec=${Number(m)}`)
      // Klik na dan 20 (zakazan) → sidebar sadrži termin; dan 13 (rok) ga NE sadrži.
      await page.goto(`/plan-aktivnosti?view=kalendar&godina=${g}&mjesec=${Number(m)}&dan=${zakazan}`)
      const sidebar = page.getByTestId("plan-sidebar")
      await expect(sidebar).toContainText(naziv)

      await page.goto(`/plan-aktivnosti?view=kalendar&godina=${g}&mjesec=${Number(m)}&dan=${rok}`)
      await expect(page.getByTestId("plan-sidebar")).not.toContainText(naziv)
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("uređivanje datuma zakazanog poslije roka prikazuje upozorenje", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    const vrsta = await firstVrstaSaIntervalom()
    const juce = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const sutra = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    try {
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta.id, rok: juce })

      await page.goto(`/plan-aktivnosti?view=lista&klijent_id=${kid}&mjesec=svi&status=svi&selected=${tid}`)
      await expect(page.getByTestId("termin-sheet")).toBeVisible()

      await page.getByTestId("edit-datum-zakazan").fill(sutra)
      const up = page.getByTestId("zakazano-poslije-roka")
      await expect(up).toBeVisible()
      await expect(up).toContainText("poslije roka")
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})
