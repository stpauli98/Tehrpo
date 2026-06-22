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
    // izaberi WAIKIKI (firma, najviše podataka — agregira sve lokacije)
    const opt = page.getByRole("option", { name: /^WAIKIKI$/ })
    await expect(opt).toBeVisible()
    await opt.click()
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
    const opt = page.getByRole("option", { name: /^WAIKIKI$/ })
    await expect(opt).toBeVisible()
    await opt.click()
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

test.describe("Faza 5 — Plan dan sidebar", () => {
  test("klik dana sa terminima → sidebar → Detalji → sheet", async ({ page }) => {
    // jul 2026 ima dosta termina; data-driven: nađi dan ćeliju koja STVARNO ima termine
    await page.goto("/plan?godina=2026&mjesec=7")
    // dan ćelija sa terminima ima status-dot (span sa rounded-full) — biraj prvu takvu
    const cellWithTermini = page.getByTestId("plan-day-cell").filter({ has: page.locator("span.rounded-full") }).first()
    await expect(cellWithTermini).toBeVisible()
    await cellWithTermini.click()
    await page.waitForURL(/dan=/)
    await expect(page.getByTestId("plan-sidebar")).toBeVisible()
    // dan ima termine → sidebar MORA imati bar jedan termin (bez guard-a)
    await expect(page.getByTestId("sidebar-termin").first()).toBeVisible()
    await page.getByTestId("sidebar-detalji").first().click()
    await page.waitForURL(/selected=/)
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
  })
})

test.describe("Faza 5 — Mjesečni plan", () => {
  test("kalendar grid + navigacija", async ({ page }) => {
    await page.goto("/plan")
    await expect(page.getByRole("heading", { name: "Mjesečni plan" })).toBeVisible()
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
    await page.goto("/prikaz")
    await page.getByTestId("prikaz-klijent").click()
    const opt = page.getByRole("option", { name: /^WAIKIKI$/ })
    await expect(opt).toBeVisible()
    await opt.click()
    await page.waitForURL(/klijent=/)
    await page.waitForLoadState("networkidle")
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    await page.screenshot({ path: "test-results/prikaz-faza5.png", fullPage: true })
  })
  test("plan screenshot", async ({ page }) => {
    await page.goto("/plan?godina=2026&mjesec=7")
    await page.waitForLoadState("networkidle")
    await expect(page.getByTestId("plan-grid")).toBeVisible()
    await page.screenshot({ path: "test-results/plan-faza5.png", fullPage: true })
  })
})
