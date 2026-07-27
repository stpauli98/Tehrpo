import { test, expect } from "@playwright/test"
import { kreirajFirmuFiksturu, type FirmaFikstura } from "./fixtures"

// Determinizam ne dolazi iz zasijanih podataka nego iz fiksture: mjesec je
// namjerno daleko u budućnosti da u njemu postoje ISKLJUČIVO termini ovog testa
// (mjesec-mod renderuje matricu samo ako u rasponu ima bar jedan termin).
const CILJNA_GODINA = 2030
const CILJNI_MJESEC = 2

let fx: FirmaFikstura

test.beforeAll(async () => {
  fx = await kreirajFirmuFiksturu({
    oznaka: "F11",
    ciljniMjesec: { godina: CILJNA_GODINA, mjesec: CILJNI_MJESEC },
  })
})

test.afterAll(async () => {
  await fx?.obrisi()
})

test.describe("Faza matrica — po mjesecu", () => {
  test("toggle 'Po mjesecu' prikaže matricu vrste×firme", async ({ page }) => {
    await page.goto(`/prikaz?mode=mjesec&godina=${CILJNA_GODINA}&mjesec=${CILJNI_MJESEC}`)
    await expect(page.getByTestId("prikaz-mode-toggle")).toBeVisible()
    // "Po mjesecu" button treba biti aktivan (dark bg)
    await expect(page.getByTestId("prikaz-mode-mjesec")).toBeVisible()
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    // header mora sadržati firmu iz fiksture
    await expect(page.getByTestId("prikaz-matrix")).toContainText(fx.naziv)
  })

  test("toggle 'Po mjesecu' click iz default stanja mijenja URL", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-mode-mjesec").click()
    await page.waitForURL(/mode=mjesec/)
    await expect(page.getByTestId("prikaz-mode-toggle")).toBeVisible()
    // U mjesec-modu se renderuje matrica ILI matrix-empty (nikad per-klijent
    // prikaz-empty) — deterministički bez obzira na to ima li tekući mjesec podataka.
    await expect(
      page.getByTestId("prikaz-matrix").or(page.getByTestId("matrix-empty"))
    ).toBeVisible()
  })

  test("povratak 'Po klijentu' radi", async ({ page }) => {
    await page.goto(`/prikaz?mode=mjesec&godina=${CILJNA_GODINA}&mjesec=${CILJNI_MJESEC}`)
    await page.getByTestId("prikaz-mode-klijent").click()
    await page.waitForURL(/mode=klijent/)
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
  })

  test("bez console grešaka u mjesec modu", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto(`/prikaz?mode=mjesec&godina=${CILJNA_GODINA}&mjesec=${CILJNI_MJESEC}`)
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
