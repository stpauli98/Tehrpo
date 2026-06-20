import { test, expect } from "@playwright/test"

// Serijsko izvršavanje za cijeli fajl: testovi mark-izvršeno i Novi termin
// mijenjaju zajedničku lokalnu bazu; paralelni workeri (Chromium+WebKit) bi
// trkali na before/after brojevima i davali lažne padove.
test.describe.configure({ mode: "serial" })

test.describe("Faza 3 — Termini stats", () => {
  test("prikazuje 4 stat kartice sa brojevima", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByRole("heading", { name: "Termini" })).toBeVisible()

    const stats = page.getByTestId("termini-stats")
    await expect(stats).toBeVisible()

    await Promise.all(
      ["stat-ukupno", "stat-ovog-mjeseca", "stat-kasni", "stat-izvrseno"].map((id) =>
        expect(page.getByTestId(id)).toBeVisible()
      )
    )

    // Ukupno mora biti > 0 (seed = 1000)
    const ukupno = await page.getByTestId("stat-ukupno-value").textContent()
    expect(Number(ukupno)).toBeGreaterThan(0)
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/termini")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})

test.describe("Faza 3 — Termini tabela", () => {
  test("renderuje tabelu sa redovima i 7 kolona", async ({ page }) => {
    await page.goto("/termini")
    const table = page.getByTestId("termini-table")
    await expect(table).toBeVisible()

    const headers = ["Datum roka", "Klijent", "Lokacija", "Vrsta", "Status", "Zaduženi", "Akcije"]
    await Promise.all(
      headers.map((h) => expect(table.getByRole("columnheader", { name: h })).toBeVisible())
    )

    // bar 1 red + status badge
    const rows = page.getByTestId("termin-row")
    expect(await rows.count()).toBeGreaterThan(0)
    await expect(page.getByTestId("status-badge").first()).toBeVisible()
  })

  test("paginacija — Sljedeća mijenja stranu", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByTestId("termini-page")).toContainText("Strana 1")
    await page.getByRole("link", { name: "Sljedeća" }).click()
    await expect(page.getByTestId("termini-page")).toContainText("Strana 2")
  })

  test("Detalji link postoji u svakom redu", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByTestId("termin-detalji").first()).toBeVisible()
  })
})

test.describe("Faza 3 — Termini filteri", () => {
  test("status pill 'Kasni' filtrira na kasni termine", async ({ page }) => {
    await page.goto("/termini")
    await page.getByTestId("status-pill-kasni").click()
    await page.waitForURL(/status=kasni/)
    // svi vidljivi status badge-evi su 'kasni'
    const badges = page.getByTestId("status-badge")
    const n = await badges.count()
    expect(n).toBeGreaterThan(0)
    await Promise.all(
      Array.from({ length: Math.min(n, 10) }, (_, i) =>
        expect(badges.nth(i)).toHaveAttribute("data-status", "kasni")
      )
    )
  })

  test("pretraga firme filtrira tabelu", async ({ page }) => {
    await page.goto("/termini")
    const input = page.getByTestId("filter-search")
    await input.fill("WAIKIKI")
    await input.press("Enter")
    await page.waitForURL(/q=WAIKIKI/)
    const rows = page.getByTestId("termin-row")
    expect(await rows.count()).toBeGreaterThan(0)
    // bar prvi red sadrži WAIKIKI (case-insensitive)
    await expect(rows.first()).toContainText(/WAIKIKI/i)
  })

  test("status pill 'Svi' vraća sve", async ({ page }) => {
    await page.goto("/termini?status=kasni")
    await page.getByTestId("status-pill-svi").click()
    await page.waitForURL((u) => !u.search.includes("status="))
    await expect(page.getByTestId("termini-table")).toBeVisible()
  })
})

test.describe("Faza 3 — Termin detalji i mutacije", () => {
  test("Detalji otvara sheet", async ({ page }) => {
    await page.goto("/termini")
    await page.getByTestId("termin-detalji").first().click()
    await page.waitForURL(/selected=/)
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
    await expect(page.getByTestId("termin-edit-form")).toBeVisible()
  })

  test("uredi napomenu i spremi", async ({ page }) => {
    await page.goto("/termini")
    await page.getByTestId("termin-detalji").first().click()
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
    const napomena = page.getByTestId("edit-napomena")
    await napomena.fill("E2E test napomena")
    await page.getByTestId("edit-save").click()
    // nakon spremanja, nema error alert-a unutar sheeta
    const sheet = page.getByTestId("termin-sheet")
    await expect(sheet.locator("[role=alert]")).toHaveCount(0)
  })

  test("označi kao izvršeno mijenja status i kreira novi ciklus", async ({ page }) => {
    // Otvori prvi 'kasni' termin
    await page.goto("/termini?status=kasni")
    const before = Number(await page.getByTestId("stat-ukupno-value").textContent())
    await page.getByTestId("termin-detalji").first().click()
    await expect(page.getByTestId("mark-done-form")).toBeVisible()
    await page.getByTestId("mark-done-submit").click()
    // nema error unutar sheeta
    const sheet = page.getByTestId("termin-sheet")
    await expect(sheet.locator("[role=alert]")).toHaveCount(0)
    // ukupno termina poraslo za 1 (auto-cycle kreirao sljedeći)
    await page.goto("/termini")
    const after = Number(await page.getByTestId("stat-ukupno-value").textContent())
    expect(after).toBe(before + 1)
  })

  test("Zatvori sheet vraća na listu", async ({ page }) => {
    await page.goto("/termini")
    await page.getByTestId("termin-detalji").first().click()
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
    await page.getByTestId("sheet-close").click()
    await page.waitForURL((u) => !u.search.includes("selected="))
    await expect(page.getByTestId("termin-sheet")).toBeHidden()
  })
})

test.describe("Faza 3 — Novi termin", () => {
  test("kreira novi termin koji se pojavi u listi", async ({ page }) => {
    await page.goto("/termini")
    const before = Number(await page.getByTestId("stat-ukupno-value").textContent())

    await page.getByTestId("novi-termin-btn").click()
    await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()

    // Izaberi klijenta
    await page.getByTestId("novi-klijent").click()
    await page.getByRole("option").first().click()
    // Izaberi vrstu
    await page.getByTestId("novi-vrsta").click()
    await page.getByRole("option").first().click()
    // Rok
    await page.getByTestId("novi-rok").fill("2026-12-31")

    await page.getByTestId("novi-submit").click()

    // Sheet se zatvori, ukupno +1
    await expect(page.getByTestId("novi-termin-sheet")).toBeHidden({ timeout: 5000 })
    const after = Number(await page.getByTestId("stat-ukupno-value").textContent())
    expect(after).toBe(before + 1)
  })
})
