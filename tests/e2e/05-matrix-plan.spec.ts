import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

test.describe("Faza 5 — Prikaz chart i toolbar", () => {
  test("opterećenje chart se renderuje sa 12 barova", async ({ page }) => {
    await page.goto("/prikaz")
    await expect(page.getByRole("heading", { name: "Prikaz" })).toBeVisible()
    await expect(page.getByTestId("opterecenje-chart")).toBeVisible()
    expect(await page.getByTestId("chart-bar").count()).toBe(12)
  })

  test("bez izabranog klijenta prikazuje prompt", async ({ page }) => {
    await page.goto("/prikaz")
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
  })

  test("izbor klijenta postavlja ?klijent= i prikazuje matricu (placeholder/grid)", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-klijent").click()
    await page.getByRole("option").first().click()
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
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-klijent").click()
    // izaberi WAIKIKI DELTA (najviše podataka) — ili prvi
    const opt = page.getByRole("option", { name: /WAIKIKI BANJA LUKA - DELTA/ })
    if (await opt.count()) await opt.click(); else await page.getByRole("option").first().click()
    await page.waitForURL(/klijent=/)
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Vrsta pregleda / ispitivanja" })).toBeVisible()
    expect(await page.getByTestId("matrix-row").count()).toBeGreaterThan(0)
    // bar jedna popunjena ćelija sa statusom
    await expect(page.getByTestId("matrix-cell-filled").first()).toBeVisible()
  })
})

test.describe("Faza 5 — Matrix cell click", () => {
  test("klik popunjene ćelije otvara TerminSheet", async ({ page }) => {
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-klijent").click()
    const opt = page.getByRole("option", { name: /WAIKIKI BANJA LUKA - DELTA/ })
    if (await opt.count()) await opt.click(); else await page.getByRole("option").first().click()
    await page.waitForURL(/klijent=/)
    await page.getByTestId("matrix-cell-filled").first().click()
    await page.waitForURL(/selected=/)
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
    // zatvori
    await page.getByTestId("sheet-close").click()
    await page.waitForURL((u) => !u.search.includes("selected="))
    await expect(page.getByTestId("termin-sheet")).toBeHidden()
  })
})
