import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

// Otvara prvi IZVRŠEN termin (AI zapisnik je dostupan samo za izvršene).
async function otvoriPrviTermin(page: import("@playwright/test").Page) {
  await page.goto("/termini?status=izvrseno&mjesec=svi")
  const prviDetalji = page.getByTestId("termin-detalji").first()
  await expect(prviDetalji).toBeVisible()
  await prviDetalji.click()
  await expect(page.getByTestId("termin-sheet")).toBeVisible()
}

test.describe("Faza Dokumenti — termin sheet", () => {
  test("generiši AI zapisnik (dry-run) → pojavi se u listi sa AI oznakom", async ({ page }) => {
    await otvoriPrviTermin(page)
    await page.getByTestId("generisi-zapisnik").click()
    await expect(page.getByTestId("dokumenti-lista")).toBeVisible()
    await expect(page.getByTestId("dokument-ai-badge").first()).toBeVisible()
  })

  test("neizvršen termin: nema 'Generiši zapisnik (AI)', stoji napomena", async ({ page }) => {
    await page.goto("/termini?status=kasni&mjesec=svi")
    await page.getByTestId("termin-detalji").first().click()
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
    await expect(page.getByTestId("generisi-zapisnik")).toHaveCount(0)
    await expect(page.getByTestId("zapisnik-nedostupan")).toBeVisible()
  })

  test("upload PDF → pojavi se u listi", async ({ page }) => {
    await otvoriPrviTermin(page)
    await page.getByTestId("dokument-file").setInputFiles({
      name: "potpisani-zapisnik.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%test\n"),
    })
    await page.getByTestId("dokument-upload-submit").click()
    await expect(
      page.getByTestId("dokument-red").filter({ hasText: "potpisani-zapisnik.pdf" }).first(),
    ).toBeVisible()
  })

  test("download link vodi na fajl (HTTP 200)", async ({ page }) => {
    await otvoriPrviTermin(page)
    const link = page.getByTestId("dokument-download").first()
    await expect(link).toBeVisible()
    const href = await link.getAttribute("href")
    expect(href).toMatch(/^\/api\/dokumenti\//)
    const resp = await page.request.get(href!)
    expect(resp.status()).toBe(200)
  })
})

test.describe("Faza Dokumenti — /zapisnici", () => {
  test("AI zapisnik se vidi na /zapisnici i preview renderuje HTML", async ({ page }) => {
    await page.goto("/zapisnici")
    await expect(page.getByTestId("pregled-tabela")).toBeVisible()
    await page.getByTestId("pregled-preview").first().click()
    await expect(page.getByTestId("docx-preview")).toBeVisible()
    await expect(page.getByTestId("docx-preview")).toContainText("ZAPISNIK")
  })

  test("brisanje zapisnika ga uklanja iz liste", async ({ page }) => {
    await page.goto("/zapisnici")
    const prijeRedova = await page.getByTestId("pregled-red").count()
    expect(prijeRedova).toBeGreaterThan(0)
    await page.getByTestId("pregled-delete").first().click()
    await expect
      .poll(async () => page.getByTestId("pregled-red").count())
      .toBeLessThan(prijeRedova)
  })
})

test.describe("Faza Dokumenti — bez console grešaka", () => {
  test("nema console grešaka na /zapisnici", async ({ page }) => {
    const errors: string[] = []
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/zapisnici")
    await expect(page.getByRole("heading", { name: /Zapisnici/i })).toBeVisible()
    expect(errors).toEqual([])
  })
})
