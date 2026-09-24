import { test, expect } from "@playwright/test"
import {
  firstKlijentId, firstActiveVrstaId, insertTermin, deleteTermin,
  insertKlijent, deleteTerminiByKlijent, deleteKlijentByNaziv,
} from "./db"

test.describe("Prikaz — dorada", () => {
  test("legenda je vidljiva kad je matrica (po mjesecu)", async ({ page }) => {
    // Osiguraj podatke u Feb 2026 (matrica u mjesec-modu renderuje se samo kad ima redova).
    const naziv = "E2E-LEG " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      const vrsta = await firstActiveVrstaId()
      await insertTermin({ klijentId: kid, vrstaId: vrsta, rok: "2026-02-15" })
      await page.goto("/prikaz?mode=mjesec&godina=2026&mjesec=2")
      await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
      await expect(page.getByTestId("matrix-legenda")).toBeVisible()
      await expect(page.getByTestId("matrix-legenda")).toContainText("izvršeno")
      await expect(page.getByTestId("matrix-legenda")).toContainText("Kasni")
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("legenda NIJE vidljiva u praznom stanju (po klijentu bez izbora)", async ({ page }) => {
    await page.goto("/prikaz")
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
    await expect(page.getByTestId("matrix-legenda")).toHaveCount(0)
  })

  test("'Po mjesecu' iz default-a postavi ?mjesec na tekući", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-mode-mjesec").click()
    await page.waitForURL(/mode=mjesec/)
    await page.waitForURL(/mjesec=\d+/)
    await expect(page.getByTestId("prikaz-mjesec")).toBeVisible()
  })

  test("klijent reset '— svi —' vraća na prazno stanje", async ({ page }) => {
    const { firstKlijentId } = await import("./db")
    const klijentId = await firstKlijentId()
    await page.goto(`/prikaz?mode=klijent&klijent=${klijentId}&godina=2026`)
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    await page.getByTestId("prikaz-klijent").click()
    await page.getByRole("option", { name: "— svi klijenti —" }).click()
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
  })

  test("(+N) ćelija vodi na filtrirane Termine", async ({ page }) => {
    const klijentId = await firstKlijentId()
    const vrstaId = await firstActiveVrstaId()
    // dva termina isti klijent+vrsta+mjesec (2035-05) → ćelija (+1); 2035 inače prazna
    const t1 = await insertTermin({ klijentId, vrstaId, rok: "2035-05-10" })
    const t2 = await insertTermin({ klijentId, vrstaId, rok: "2035-05-20" })
    try {
      await page.goto(`/prikaz?mode=klijent&klijent=${klijentId}&godina=2035`)
      await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
      // Ćeliju biramo po KOLONI (maj = "5"), ne po tome što je jedina sa /plan-aktivnosti
      // linkom. Razlog: godišnja matrica sada ima i kolonu „Preneseno" — otvorene obaveze
      // čiji je datum_prikaza prije 1. januara prikazane godine. Prije te ispravke su takve
      // obaveze 01.01. jednostavno nestajale iz plana (audit B2), pa je klijent gubio iz vida
      // sve zaostalo — novo ponašanje je ispravno i te ćelije LEGITIMNO stoje u matrici 2035.
      // Stari uslov („tačno jedan link na /plan-aktivnosti") je time postao besmislen: i
      // pojedinačne ćelije vode na /plan-aktivnosti (?selected=<id>), pa ih je brojao takođe.
      const majCelija = page.locator('td[data-testid="matrix-cell"][data-col="5"] a[data-testid="matrix-cell-filled"]')
      await expect(majCelija).toHaveCount(1)
      // Ovo je poenta testa: ćelija sa VIŠE termina (+N) ne vodi na jedan termin nego na
      // filtriranu listu — pa mora i izgledati kao (+1) i imati lista-href.
      await expect(majCelija).toContainText("(+1)")
      const href = await majCelija.getAttribute("href")
      expect(href).toMatch(/view=lista/)
      expect(href).toMatch(new RegExp(`vrsta_id=${vrstaId}`))
      expect(href).toMatch(/mjesec=5/)
      expect(href).toMatch(/godina=2035/)
    } finally {
      await deleteTermin(t1)
      await deleteTermin(t2)
    }
  })
})
