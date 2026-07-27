import { test, expect, type Page } from "@playwright/test"

/**
 * Regresija: kartica termina (TerminSheet) na Plan aktivnosti bila je šira od svog
 * okvira — `input[type=file]` u sekciji Dokumenti ima intrinzičnu širinu ~300px, a
 * grid stavke imaju `min-width:auto`, pa je razvlačila kolonu preko `max-w-*`.
 * Posljedica: korisnik je morao skrolati lijevo/desno (i gore/dolje jer je skrolao
 * cijeli dijalog, zajedno sa naslovom i podnožjem).
 *
 * Pravila koja ovaj spec štiti:
 *  1. kartica NIKAD nema horizontalni skrol,
 *  2. kartica uvijek stane u visinu prozora,
 *  3. skroluje samo srednji dio — naslov i "Zatvori" ostaju vidljivi.
 */

/** Otvara prvi termin iz kalendara i vraća locator kartice. */
async function otvoriKarticu(page: Page) {
  await page.goto("/plan-aktivnosti?view=kalendar&godina=2026&mjesec=7")
  const termin = page.getByTestId("cell-termin").first()
  await expect(termin).toBeVisible()
  await termin.click()
  await page.waitForURL(/selected=/)
  const kartica = page.getByTestId("termin-sheet")
  await expect(kartica).toBeVisible()
  return kartica
}

test.describe("TerminSheet — kartica stane u prozor", () => {
  test("nema horizontalnog skrola ni u kartici ni na stranici", async ({ page }) => {
    const kartica = await otvoriKarticu(page)
    const mjere = await kartica.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }))
    // ≤1px tolerancija zbog subpikselskog zaokruživanja.
    expect(mjere.scrollWidth).toBeLessThanOrEqual(mjere.clientWidth + 1)
    expect(mjere.docScrollWidth).toBeLessThanOrEqual(mjere.viewportWidth + 1)
  })

  test("kartica stane u visinu prozora", async ({ page }) => {
    const kartica = await otvoriKarticu(page)
    const mjere = await kartica.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, viewportHeight: window.innerHeight }
    })
    expect(mjere.top).toBeGreaterThanOrEqual(-1)
    expect(mjere.bottom).toBeLessThanOrEqual(mjere.viewportHeight + 1)
  })

  test("i u niskom prozoru naslov i dugme Zatvori ostaju vidljivi", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 560 })
    const kartica = await otvoriKarticu(page)
    // Naslov (klijent) i X za zatvaranje moraju biti u vidnom polju bez skrolanja
    // dijaloga — X je fiksan u uglu, van skrolabilnog tijela.
    await expect(kartica.getByRole("heading")).toBeInViewport()
    await expect(page.getByTestId("dialog-close")).toBeInViewport()
    // Sam dijalog se ne skroluje — skroluje samo njegov srednji dio.
    const skrolDijaloga = await kartica.evaluate((el) => ({
      scrollTop: el.scrollTop,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(skrolDijaloga.scrollWidth).toBeLessThanOrEqual(skrolDijaloga.clientWidth + 1)
  })
})
