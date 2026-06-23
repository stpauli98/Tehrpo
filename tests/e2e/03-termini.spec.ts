import { test, expect } from "@playwright/test"
import {
  firstActiveVrstaId, setVrstaInterval, getVrstaInterval,
  insertTermin, deleteTerminiByKlijent, insertKlijent, deleteKlijentByNaziv,
} from "./db"

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

  test("pretraga filtrira živo dok se kuca (bez Entera)", async ({ page }) => {
    await page.goto("/termini")
    const input = page.getByTestId("filter-search")
    // kucanje karakter-po-karakter, NE pritiskamo Enter
    await input.pressSequentially("WAIK")
    await page.waitForURL(/q=WAIK/)
    const rows = page.getByTestId("termin-row")
    expect(await rows.count()).toBeGreaterThan(0)
    await expect(rows.first()).toContainText(/WAIKIKI/i)
  })

  test("klik na KPI 'Kasni rokovi' filtrira listu na kasne", async ({ page }) => {
    await page.goto("/termini")
    await page.getByTestId("stat-kasni").click()
    await page.waitForURL(/status=kasni/)
    await expect(page.getByTestId("stat-kasni")).toHaveAttribute("data-active", "true")
    await expect(page.getByTestId("status-pill-kasni")).toHaveAttribute("data-active", "true")
  })

  test("klik na red (ne na Detalji) otvara TerminSheet", async ({ page }) => {
    await page.goto("/termini")
    await page.getByTestId("termin-row").first().click()
    await expect(page.getByTestId("termin-sheet")).toBeVisible()
  })

  test("Godina dropdown se pojavljuje samo uz odabran mjesec", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByTestId("filter-godina")).toHaveCount(0)
    await page.goto("/termini?mjesec=2")
    await expect(page.getByTestId("filter-godina")).toBeVisible()
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
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      const vrsta = await firstActiveVrstaId()
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta, rok: "2027-05-01" })
      await page.goto(`/termini?selected=${tid}`)
      await expect(page.getByTestId("termin-sheet")).toBeVisible()
      await page.getByTestId("edit-napomena").fill("E2E test napomena")
      await page.getByTestId("edit-save").click()
      await expect(page.getByTestId("termin-sheet").locator("[role=alert]")).toHaveCount(0)
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("označi kao izvršeno mijenja status i kreira novi ciklus", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    const vrsta = await firstActiveVrstaId()
    const origInterval = await getVrstaInterval(vrsta)
    try {
      await setVrstaInterval(vrsta, 12)
      // kasni termin (rok u prošlosti) za throwaway klijent
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta, rok: "2025-01-15" })
      await page.goto("/termini")
      const before = Number(await page.getByTestId("stat-ukupno-value").textContent())
      await page.goto(`/termini?selected=${tid}`)
      await expect(page.getByTestId("mark-done-form")).toBeVisible()
      await page.getByTestId("mark-done-submit").click()
      await expect(page.getByTestId("termin-sheet").locator("[role=alert]")).toHaveCount(0)
      await page.goto("/termini")
      const after = Number(await page.getByTestId("stat-ukupno-value").textContent())
      expect(after).toBe(before + 1)
    } finally {
      await setVrstaInterval(vrsta, origInterval)
      await deleteTerminiByKlijent(kid) // briše izvršeni + auto-cycle dijete
      await deleteKlijentByNaziv(naziv)
    }
  })

  // Postojeći termin iz datog pula (otkaži ⇒ kasni, zakazano ⇒ planirano — različiti
  // pulovi pa nema sudara; svaki test mutira po jedan, pulovi su veliki).

  test("Otkaži termin → status postaje Otkazano", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      const vrsta = await firstActiveVrstaId()
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta, rok: "2027-06-10" })
      await page.goto(`/termini?selected=${tid}`)
      await expect(page.getByTestId("termin-sheet")).toBeVisible()
      await page.getByTestId("otkazi-arm").click()
      await page.getByTestId("otkazi-submit").click()
      await expect(page.getByTestId("termin-sheet")).toContainText("Otkazano")
      await expect(page.getByTestId("otkazi-arm")).toHaveCount(0)
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("uređivanje 'Datum zakazan' prebaci planirano → Zakazano", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      const vrsta = await firstActiveVrstaId()
      const tid = await insertTermin({ klijentId: kid, vrstaId: vrsta, rok: "2027-07-20" })
      await page.goto(`/termini?selected=${tid}`)
      await expect(page.getByTestId("termin-sheet")).toBeVisible()
      await page.getByTestId("edit-datum-zakazan").fill("2030-08-01")
      await page.getByTestId("edit-save").click()
      await expect(page.getByTestId("termin-sheet")).toContainText("Zakazano")
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
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
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto("/termini")
      const before = Number(await page.getByTestId("stat-ukupno-value").textContent())
      await page.getByTestId("novi-termin-btn").click()
      await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()
      await page.getByTestId("novi-klijent").click()
      await page.getByRole("option", { name: naziv }).click()
      await page.getByTestId("novi-vrsta").click()
      await page.getByRole("option").first().click()
      await page.getByTestId("novi-rok").fill("2029-03-15")
      await page.getByTestId("novi-submit").click()
      await expect(page.getByTestId("novi-termin-sheet")).toBeHidden({ timeout: 5000 })
      const after = Number(await page.getByTestId("stat-ukupno-value").textContent())
      expect(after).toBe(before + 1)
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("duplikat (isti klijent+vrsta+rok) je odbijen porukom", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    const rok = "2029-04-20"
    try {
      async function popuni() {
        await page.getByTestId("novi-termin-btn").click()
        await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()
        await page.getByTestId("novi-klijent").click()
        await page.getByRole("option", { name: naziv }).click()
        await page.getByTestId("novi-vrsta").click()
        await page.getByRole("option").first().click()
        await page.getByTestId("novi-rok").fill(rok)
        await page.getByTestId("novi-submit").click()
      }
      await page.goto("/termini")
      await popuni()
      await expect(page.getByTestId("novi-termin-sheet")).toBeHidden({ timeout: 5000 })
      await popuni()
      await expect(page.getByText("Termin za istu firmu, vrstu i rok već postoji.")).toBeVisible()
    } finally {
      await deleteTerminiByKlijent(kid)
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Faza 3 — Vizuelni smoke", () => {
  test("termini ekran screenshot @ 1440x900", async ({ page }) => {
    await page.goto("/termini")
    await page.waitForLoadState("networkidle")
    await expect(page.getByTestId("termini-stats")).toBeVisible()
    await expect(page.getByTestId("termini-table")).toBeVisible()
    // Snapshot za manualni pregled (ne toHaveScreenshot da izbjegnemo baseline drift na seed promjenama)
    await page.screenshot({ path: "test-results/termini-faza3.png", fullPage: true })
  })

  test("status badge boje odgovaraju izvedenom statusu (§9.1)", async ({ page }) => {
    // 'kasni' filter → svi badge-evi crveni
    await page.goto("/termini?status=kasni")
    await page.waitForLoadState("networkidle")
    const kasni = page.getByTestId("status-badge").first()
    await expect(kasni).toHaveAttribute("data-status", "kasni")
    await expect(kasni).toHaveClass(/bg-red-50/)

    // 'izvrseno' filter → zeleni
    await page.goto("/termini?status=izvrseno")
    await page.waitForLoadState("networkidle")
    const izvr = page.getByTestId("status-badge").first()
    await expect(izvr).toHaveAttribute("data-status", "izvrseno")
    await expect(izvr).toHaveClass(/bg-green-50/)
  })
})
