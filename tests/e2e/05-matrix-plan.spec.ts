import { test, expect } from "@playwright/test"
import {
  insertKlijent, insertTermin, firstActiveVrstaId,
  deleteTerminiByKlijent, deleteKlijentByNaziv,
} from "./db"
import { jedinstvenNaziv } from "./fixtures"

test.describe.configure({ mode: "serial" })

// Throwaway klijent sa JEDNIM terminom u 2026 → deterministična matrica (jedna
// popunjena single-ćelija), bez zavisnosti od bilo koje zasijane firme.
// Naziv ide kroz `jedinstvenNaziv` da nosi prefiks koji cleanup skripta prepoznaje.
async function seedKlijentSaTerminom(): Promise<{ naziv: string; kid: string }> {
  const naziv = jedinstvenNaziv("MTX")
  const kid = await insertKlijent(naziv)
  const vrsta = await firstActiveVrstaId()
  await insertTermin({ klijentId: kid, vrstaId: vrsta, rok: "2026-05-15" })
  return { naziv, kid }
}

test.describe("Faza 5 — Prikaz chart i toolbar", () => {
  test("opterećenje chart se renderuje sa 12 barova", async ({ page }) => {
    // chart premješten na Pregled (Prikaz/matrica ga više nema)
    await page.goto("/pregled")
    await expect(page.getByRole("heading", { name: "Pregled" })).toBeVisible()
    await expect(page.getByTestId("dashboard-chart")).toBeVisible()
    expect(await page.getByTestId("chart-bar").count()).toBe(12)
  })

  test("bez izabranog klijenta prikazuje prompt", async ({ page }) => {
    await page.goto("/prikaz")
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
  })

  test("izbor klijenta postavlja ?klijent= i prikazuje matricu (placeholder/grid)", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-klijent").click()
    // prvi REALNI klijent (preskoči "— svi klijenti —" reset sentinel)
    await page.getByRole("option").filter({ hasNotText: "svi klijenti" }).first().click()
    await page.waitForURL(/klijent=/)
    await expect(page.getByTestId("prikaz-empty")).toBeHidden()
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/prikaz")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})

test.describe("Faza 5 — Matrix grid", () => {
  test("matrica prikazuje vrste (redove) i 12 mjeseci (kolone)", async ({ page }) => {
    const { naziv, kid } = await seedKlijentSaTerminom()
    try {
      await page.goto("/prikaz?godina=2026")
      await page.getByTestId("prikaz-klijent").click()
      const opt = page.getByRole("option", { name: naziv })
      await expect(opt).toBeVisible()
      await opt.click()
      await page.waitForURL(/klijent=/)
      await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
      await expect(page.getByRole("columnheader", { name: "Vrsta pregleda / ispitivanja" })).toBeVisible()
      expect(await page.getByTestId("matrix-row").count()).toBeGreaterThan(0)
      // bar jedna popunjena ćelija sa statusom
      await expect(page.getByTestId("matrix-cell-filled").first()).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Faza 5 — Matrix cell click", () => {
  test("klik popunjene ćelije otvara TerminSheet", async ({ page }) => {
    // throwaway klijent ima JEDAN termin → single-ćelija (href sadrži selected=)
    const { naziv, kid } = await seedKlijentSaTerminom()
    try {
      await page.goto("/prikaz?godina=2026")
      await page.getByTestId("prikaz-klijent").click()
      const opt = page.getByRole("option", { name: naziv })
      await expect(opt).toBeVisible()
      await opt.click()
      await page.waitForURL(/klijent=/)
      // Klikni prvu single-ćeliju (href sadrži selected=, ne /termini)
      const singleCell = page.locator('a[data-testid="matrix-cell-filled"][href*="selected="]').first()
      await expect(singleCell).toBeVisible()
      await singleCell.click()
      await page.waitForURL(/selected=/)
      await expect(page.getByTestId("termin-sheet")).toBeVisible()
      // zatvori
      await page.getByTestId("dialog-close").click()
      await page.waitForURL((u) => !u.search.includes("selected="))
      await expect(page.getByTestId("termin-sheet")).toBeHidden()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Faza 5 — Plan dan sidebar", () => {
  test("klik dana sa terminima → sidebar → Detalji → sheet", async ({ page }) => {
    // Ubaci termin na poznati dan → deterministički gust dan (bez zavisnosti od seeda).
    const naziv = jedinstvenNaziv("DAN")
    const kid = await insertKlijent(naziv)
    try {
      const vrsta = await firstActiveVrstaId()
      await insertTermin({ klijentId: kid, vrstaId: vrsta, rok: "2026-07-15" })
      await page.goto("/plan?godina=2026&mjesec=7")
      const dayLink = page.locator('[data-testid="plan-day-cell"][data-date="2026-07-15"]')
      await expect(dayLink).toBeVisible()
      await dayLink.click({ position: { x: 10, y: 6 } })
      await page.waitForURL(/dan=2026-07-15/)
      await expect(page.getByTestId("plan-sidebar")).toBeVisible()
      await expect(page.getByTestId("sidebar-termin").first()).toBeVisible()
      await page.getByTestId("sidebar-detalji").first().click()
      await page.waitForURL(/selected=/)
      await expect(page.getByTestId("termin-sheet")).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Faza 5 — Mjesečni plan", () => {
  test("kalendar grid + navigacija", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=kalendar")
    await expect(page.getByRole("heading", { name: "Plan aktivnosti" })).toBeVisible()
    await expect(page.getByTestId("plan-grid")).toBeVisible()
    // 42 dana ćelije
    expect(await page.getByTestId("plan-day-cell").count()).toBe(42)
    const label = await page.getByTestId("plan-nav-label").textContent()
    await page.getByTestId("plan-nav-next").click()
    await page.waitForURL(/mjesec=/)
    await expect(page.getByTestId("plan-nav-label")).not.toHaveText(label ?? "")
  })

  test("Danas dugme vraća na tekući mjesec", async ({ page }) => {
    await page.goto("/plan?godina=2025&mjesec=1")
    await page.getByTestId("plan-nav-today").click()
    await page.waitForURL(/mjesec=/)
    await expect(page.getByTestId("plan-grid")).toBeVisible()
  })

  test("godina dropdown mijenja godinu (§7.2 D)", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    await page.getByTestId("plan-nav-godina").click()
    await page.getByRole("option", { name: "2025" }).click()
    await page.waitForURL(/godina=2025/)
    await expect(page.getByTestId("plan-nav-label")).toContainText("2025")
  })
})

test.describe("Faza 5 — Vizuelni smoke", () => {
  test("prikaz screenshot", async ({ page }) => {
    const { naziv, kid } = await seedKlijentSaTerminom()
    try {
      await page.goto("/prikaz?godina=2026")
      await page.getByTestId("prikaz-klijent").click()
      const opt = page.getByRole("option", { name: naziv })
      await expect(opt).toBeVisible()
      await opt.click()
      await page.waitForURL(/klijent=/)
      await page.waitForLoadState("networkidle")
      await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
      await page.screenshot({ path: "test-results/prikaz-faza5.png", fullPage: true })
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
  test("plan screenshot", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    await page.waitForLoadState("networkidle")
    await expect(page.getByTestId("plan-grid")).toBeVisible()
    await page.screenshot({ path: "test-results/plan-faza5.png", fullPage: true })
  })
})
