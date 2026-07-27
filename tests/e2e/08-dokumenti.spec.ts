import { stat } from "node:fs/promises"
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

  test("upload sa izabranim tipom 'Fotografija' → red vidljiv", async ({ page }) => {
    await otvoriPrviTermin(page)
    // Base UI Select: testid je na SelectTrigger (button), ne na native <select> —
    // otvori klikom i izaberi opciju preko role=option (obrazac iz 23-podsjetnici-v2).
    const trigger = page.getByTestId("dokument-tip")
    await expect(trigger).toBeVisible()
    await trigger.click()
    await page.getByRole("option", { name: "Fotografija", exact: true }).click()
    await expect(trigger).toContainText("Fotografija")

    await page.getByTestId("dokument-file").setInputFiles({
      name: "fotografija-nalaza.png",
      mimeType: "image/png",
      buffer: Buffer.from("\x89PNG\r\n\x1a\n"),
    })
    await page.getByTestId("dokument-upload-submit").click()
    await expect(
      page.getByTestId("dokument-red").filter({ hasText: "fotografija-nalaza.png" }).first(),
    ).toBeVisible()
  })

  test("preuzimanje pokreće download neprazan fajl", async ({ page }) => {
    await otvoriPrviTermin(page)
    const dugme = page.getByTestId("dokument-download").first()
    await expect(dugme).toBeVisible()
    const [download] = await Promise.all([page.waitForEvent("download"), dugme.click()])
    const putanja = await download.path()
    expect(putanja).toBeTruthy()
    const { size } = await stat(putanja!)
    expect(size).toBeGreaterThan(0)
  })

  test("greška rute → toast, bez navigacije na sirovi JSON", async ({ page }) => {
    await otvoriPrviTermin(page)
    const urlPrije = page.url()
    await page.route("**/api/dokumenti/*", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Dokument ne postoji." }),
      }),
    )
    await page.getByTestId("dokument-download").first().click()
    await expect(page.getByText("Dokument ne postoji.")).toBeVisible()
    expect(page.url()).toBe(urlPrije)
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

  test("odustajanje od brisanja ne uklanja red", async ({ page }) => {
    await page.goto("/zapisnici")
    const prijeRedova = await page.getByTestId("pregled-red").count()
    expect(prijeRedova).toBeGreaterThan(0)
    await page.getByTestId("pregled-delete").first().click()
    const dialog = page.getByTestId("dokument-obrisi-dialog")
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Otkaži", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId("pregled-red")).toHaveCount(prijeRedova)
  })

  test("brisanje zapisnika ga uklanja iz liste (uz potvrdu u dialogu)", async ({ page }) => {
    await page.goto("/zapisnici")
    const prijeRedova = await page.getByTestId("pregled-red").count()
    expect(prijeRedova).toBeGreaterThan(0)
    await page.getByTestId("pregled-delete").first().click()
    const dialog = page.getByTestId("dokument-obrisi-dialog")
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Obriši", exact: true }).click()
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
