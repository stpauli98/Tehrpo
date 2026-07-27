import { test, expect, type Page } from "@playwright/test"
import { kreirajFirmuFiksturu, type FirmaFikstura } from "./fixtures"
import { izvrsiTermin } from "./db"

/**
 * Pregled dokumenta bez preuzimanja (ikonica oka).
 *
 * Kartica se PREBACUJE na pregled umjesto da otvori dialog preko dialoga —
 * isti razlog zbog kojeg brisanje koristi dvostepenu potvrdu (v. `DokumentiSekcija`).
 *
 * Ugovor koji spec štiti:
 *  1. oko otvara pregled bez odlaska sa stranice i bez drugog dijaloga,
 *  2. DOCX se prikaže kao tekst (mammoth), ne kao ponuda za preuzimanje,
 *  3. PDF ide u `iframe` sa inline URL-om (`object` ostaje prazan u Chrome-u),
 *  4. slika se prikaže kao slika,
 *  5. „nazad" vraća detalje termina, a X i dalje zatvara karticu.
 *
 * Vlastita fikstura: spec otprema fajlove, pa ne smije prljati dijeljeni DEMO
 * termin — svaki upload bi ostajao zauvijek i usporavao tuđe testove.
 */

test.describe.configure({ mode: "serial" })

let firma: FirmaFikstura
let terminId: string

test.beforeAll(async () => {
  firma = await kreirajFirmuFiksturu({ oznaka: "PREGLED", lokacije: ["E2E Lokacija"] })
  const prvi = firma.terminiTekuciIds[0]
  if (!prvi) throw new Error("fikstura nije napravila termin")
  terminId = prvi
  // Zapisnik (AI) je dostupan samo za izvršen termin.
  await izvrsiTermin(terminId, new Date().toISOString().slice(0, 10))
})

test.afterAll(async () => {
  // `dokumenti` idu cascade preko `termin_id`/`klijent_id`, pa nema zaostataka.
  await firma?.obrisi().catch(() => {})
})

async function otvoriKarticu(page: Page) {
  await page.goto(`/plan-aktivnosti?view=lista&mjesec=svi&selected=${terminId}`)
  await expect(page.getByTestId("termin-sheet")).toBeVisible()
}

/** Red AI zapisnika (.docx); generiše ga ako ga još nema. */
async function redZapisnika(page: Page) {
  const zapisnik = page
    .getByTestId("dokument-red")
    .filter({ has: page.getByTestId("dokument-ai-badge") })
  if ((await zapisnik.count()) === 0) {
    await page.getByTestId("generisi-zapisnik").click()
    await expect(zapisnik.first()).toBeVisible()
  }
  return zapisnik.first()
}

async function otpremi(page: Page, naziv: string, mimeType: string, buffer: Buffer) {
  await page.getByTestId("dokument-file").setInputFiles({ name: naziv, mimeType, buffer })
  await page.getByTestId("dokument-upload-submit").click()
  const red = page.getByTestId("dokument-red").filter({ hasText: naziv }).first()
  await expect(red).toBeVisible()
  return red
}

test.describe("Dokumenti — pregled bez preuzimanja", () => {
  test("oko otvara sadržaj .docx zapisnika u kartici", async ({ page }) => {
    await otvoriKarticu(page)
    const zapisnik = await redZapisnika(page)

    const urlPrije = page.url()
    await zapisnik.getByTestId("dokument-pregled").click()

    await expect(page.getByTestId("termin-sheet-pregled")).toBeVisible()
    // Sadržaj zapisnika, ne poruka o preuzimanju.
    await expect(page.getByTestId("docx-preview")).toBeVisible()
    await expect(page.getByTestId("docx-preview")).toContainText("ZAPISNIK")
    // Pregled je unutar kartice — bez navigacije i bez drugog dijaloga.
    expect(page.url()).toBe(urlPrije)
    await expect(page.getByTestId("termin-sheet")).toHaveCount(1)
  })

  test("'nazad' vraća detalje termina, X zatvara karticu", async ({ page }) => {
    await otvoriKarticu(page)
    const zapisnik = await redZapisnika(page)
    await zapisnik.getByTestId("dokument-pregled").click()
    await expect(page.getByTestId("termin-sheet-pregled")).toBeVisible()

    await page.getByTestId("pregled-nazad").click()
    await expect(page.getByTestId("termin-sheet-pregled")).toBeHidden()
    await expect(page.getByTestId("sheet-dokumenti")).toBeVisible()
    await expect(page.getByTestId("termin-edit-form")).toBeVisible()

    await page.getByTestId("dialog-close").click()
    await page.waitForURL((u) => !u.search.includes("selected="))
    await expect(page.getByTestId("termin-sheet")).toBeHidden()
  })

  test("PDF ide u iframe sa inline URL-om i zadržava izlaz na preuzimanje", async ({ page }) => {
    await otvoriKarticu(page)
    const red = await otpremi(page, "pregled.pdf", "application/pdf", Buffer.from("%PDF-1.4\n%test\n"))
    await red.getByTestId("dokument-pregled").click()

    const okvir = page.getByTestId("pregled-pdf")
    await expect(okvir).toBeVisible()
    // `iframe`, ne `object` — `object` ostavlja praznu bijelu površinu u Chrome-u.
    expect(await okvir.evaluate((el) => el.tagName)).toBe("IFRAME")
    // Inline URL (bez `?download=`), inače bi preglednik snimio fajl umjesto da ga prikaže.
    const src = await okvir.getAttribute("src")
    expect(src).toContain("/storage/v1/object/sign/")
    expect(src).not.toContain("download=")
    // `iframe` nema fallback sadržaj → preuzimanje mora ostati ponuđeno.
    await expect(page.getByTestId("pregled-preuzmi")).toBeVisible()
  })

  test("slika se prikaže kao slika, ne kao preuzimanje", async ({ page }) => {
    await otvoriKarticu(page)
    // 1×1 PNG — dovoljan da Storage vrati validan image/png.
    const red = await otpremi(
      page,
      "pregled.png",
      "image/png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    )
    await red.getByTestId("dokument-pregled").click()

    const slika = page.getByTestId("pregled-slika")
    await expect(slika).toBeVisible()
    // Slika se stvarno učitala (naturalWidth > 0), nije samo <img> sa mrtvim src-om.
    await expect
      .poll(async () => slika.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
  })
})
