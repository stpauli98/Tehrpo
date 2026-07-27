import { test, expect, type Page } from "@playwright/test"

/**
 * Zona za dodavanje fajla: native `Choose File` nije govorio korisniku da može i
 * prevući fajl, pa je zamijenjen vidljivom zonom (klik ILI drag-drop).
 *
 * Ugovor koji ovaj spec štiti:
 *  1. uputstvo je stvarno vidljivo (ne skriveno iza native kontrole),
 *  2. `setInputFiles` i dalje radi — `input[type=file]` je ostao u DOM-u sa istim
 *     `name`/`testId`, pa `08-dokumenti.spec.ts` i FormData rade nepromijenjeno,
 *  3. drop stvarno puni input (a ne samo mijenja izgled),
 *  4. izabrani fajl se vidi i može ukloniti.
 */

async function otvoriIzvrsenTermin(page: Page) {
  await page.goto("/termini?status=izvrseno&mjesec=svi")
  const prvi = page.getByTestId("termin-detalji").first()
  await expect(prvi).toBeVisible()
  await prvi.click()
  await expect(page.getByTestId("termin-sheet")).toBeVisible()
}

/** Ispušta fajl na zonu preko pravog DataTransfer-a (kao pravi drag iz fajl menadžera). */
async function ispustiFajl(page: Page, naziv: string, mime: string, sadrzaj: string) {
  const dt = await page.evaluateHandle(
    ([n, m, s]) => {
      const dt = new DataTransfer()
      dt.items.add(new File([s], n, { type: m }))
      return dt
    },
    [naziv, mime, sadrzaj] as const,
  )
  await page.getByTestId("dokument-file-zona").dispatchEvent("drop", { dataTransfer: dt })
}

test.describe("Dokumenti — zona za dodavanje fajla", () => {
  test("uputstvo za klik i prevlačenje je vidljivo", async ({ page }) => {
    await otvoriIzvrsenTermin(page)
    const zona = page.getByTestId("dokument-file-zona")
    await expect(zona).toBeVisible()
    await expect(zona).toContainText("Prevuci fajl ovdje")
    // Limit i dozvoljeni tipovi su vidljivi prije nego korisnik pogriješi.
    await expect(zona).toContainText("10 MB")
    await expect(zona).toContainText("PDF")
  })

  test("izbor fajla klikom prikaže naziv i može se ukloniti", async ({ page }) => {
    await otvoriIzvrsenTermin(page)
    await page.getByTestId("dokument-file").setInputFiles({
      name: "klikom-izabran.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 klik"),
    })
    const izabrani = page.getByTestId("dokument-file-izabrani")
    await expect(izabrani).toContainText("klikom-izabran.pdf")

    await page.getByTestId("dokument-file-ocisti").click()
    await expect(izabrani).toBeHidden()
    // Uklanjanje mora očistiti i sam input, ne samo prikaz.
    const brojFajlova = await page
      .getByTestId("dokument-file")
      .evaluate((el) => (el as HTMLInputElement).files?.length ?? 0)
    expect(brojFajlova).toBe(0)
  })

  test("drop fajla puni input i upload prolazi", async ({ page }) => {
    await otvoriIzvrsenTermin(page)
    await ispustiFajl(page, "prevucen-nalaz.pdf", "application/pdf", "%PDF-1.4 drop")

    await expect(page.getByTestId("dokument-file-izabrani")).toContainText("prevucen-nalaz.pdf")
    const naziv = await page
      .getByTestId("dokument-file")
      .evaluate((el) => (el as HTMLInputElement).files?.[0]?.name ?? "")
    expect(naziv).toBe("prevucen-nalaz.pdf")

    await page.getByTestId("dokument-upload-submit").click()
    await expect(
      page.getByTestId("dokument-red").filter({ hasText: "prevucen-nalaz.pdf" }).first(),
    ).toBeVisible()
  })

  test("drop nedozvoljenog tipa se odbija i ne ulazi u input", async ({ page }) => {
    await otvoriIzvrsenTermin(page)
    await ispustiFajl(page, "virus.exe", "application/x-msdownload", "MZ")

    await expect(page.getByText("Nedozvoljen tip fajla", { exact: false })).toBeVisible()
    await expect(page.getByTestId("dokument-file-izabrani")).toBeHidden()
    const brojFajlova = await page
      .getByTestId("dokument-file")
      .evaluate((el) => (el as HTMLInputElement).files?.length ?? 0)
    expect(brojFajlova).toBe(0)
  })
})
