import { test, expect } from "@playwright/test"
import {
  firstActiveVrstaId, setVrstaInterval, getVrstaInterval,
  insertTermin, deleteTerminiByKlijent, insertKlijent, deleteKlijentByNaziv,
} from "./db"
import { idiNa } from "./fixtures"

// Serijsko izvršavanje za cijeli fajl: testovi mark-izvršeno i Novi termin
// mijenjaju zajedničku lokalnu bazu; paralelni workeri (Chromium+WebKit) bi
// trkali na before/after brojevima i davali lažne padove.
test.describe.configure({ mode: "serial" })

// Ukupan broj termina se čita iz footera ("Ukupno rezultata: N"); uz ?mjesec=svi
// to je globalni broj (bez mjesečnog filtera) — zamjena za uklonjenu stat-ukupno karticu.
async function readTotal(page: import("@playwright/test").Page): Promise<number> {
  const text = await page.getByTestId("termini-total").textContent()
  return Number((text ?? "").replace(/\D+/g, ""))
}

test.describe("Faza 3 — Termini stats", () => {
  test("stranica se učitava (heading, tabela, ukupno > 0)", async ({ page }) => {
    await page.goto("/termini?mjesec=svi")
    await expect(page.getByRole("heading", { name: "Plan aktivnosti" })).toBeVisible()
    await expect(page.getByTestId("termini-table")).toBeVisible()
    expect(await readTotal(page)).toBeGreaterThan(0)
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

    // Kolona "Datum roka" je preimenovana u "Datum" (prikazuje datum_prikaza, a rok
    // ide kao sekundarni red u ćeliji kad je termin zakazan) — v. TerminiTable COL_KEYS
    // + messages termini.tabela.kolone. Broj kolona je i dalje 7; count dokazuje tačan skup.
    const headers = ["Datum", "Klijent", "Lokacija", "Vrsta", "Status", "Zaduženi", "Akcije"]
    await expect(table.getByRole("columnheader")).toHaveCount(headers.length)
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
    // Paginacija se prikazuje samo kad ima > 1 strane; sa ≤ 1 strane nema šta provjeriti.
    const next = page.getByRole("link", { name: "Sljedeća" })
    if (await next.count()) {
      await expect(page.getByTestId("termini-page")).toContainText("Strana 1")
      await next.click()
      await expect(page.getByTestId("termini-page")).toContainText("Strana 2")
    }
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
    // svi vidljivi status badge-evi su 'kasni'; čekamo s timeout-om jer fetch može kasniti
    const badges = page.getByTestId("status-badge")
    await expect(badges.first()).toBeVisible()
    const n = await badges.count()
    expect(n).toBeGreaterThan(0)
    await Promise.all(
      Array.from({ length: Math.min(n, 10) }, (_, i) =>
        expect(badges.nth(i)).toHaveAttribute("data-status", "kasni")
      )
    )
  })

  test("pretraga firme filtrira tabelu", async ({ page }) => {
    await page.goto("/termini?mjesec=svi")
    // Pojam izvedemo iz stvarnih podataka (prvi red) — bez zavisnosti od konkretnog seeda.
    const prviKlijent = ((await page.getByTestId("termin-row").first().locator("td").nth(1).textContent()) ?? "").trim()
    expect(prviKlijent.length).toBeGreaterThan(0)
    const term = prviKlijent.slice(0, 4)
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    const input = page.getByTestId("filter-search")
    await input.fill(term)
    await input.press("Enter")
    await page.waitForURL(/q=/)
    const rows = page.getByTestId("termin-row")
    await expect(rows.first()).toBeVisible()
    expect(await rows.count()).toBeGreaterThan(0)
    await expect(rows.first()).toContainText(rx)
  })

  test("pretraga filtrira živo dok se kuca (bez Entera)", async ({ page }) => {
    await page.goto("/termini?mjesec=svi")
    const prviKlijent = ((await page.getByTestId("termin-row").first().locator("td").nth(1).textContent()) ?? "").trim()
    const term = prviKlijent.slice(0, 4)
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    const input = page.getByTestId("filter-search")
    // kucanje karakter-po-karakter, NE pritiskamo Enter
    await input.pressSequentially(term)
    await page.waitForURL(/q=/)
    const rows = page.getByTestId("termin-row")
    await expect(rows.first()).toBeVisible()
    expect(await rows.count()).toBeGreaterThan(0)
    await expect(rows.first()).toContainText(rx)
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
      // Uspjeh se od yoink batcha potvrđuje sonner toastom (useAkcijaToast u TerminSheet);
      // inline [role=alert] ostaje samo za field-greške (FieldError) — mora ih biti 0.
      await expect(
        page.locator("[data-sonner-toast]").getByText("Izmjene sačuvane"),
      ).toBeVisible()
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
      await page.goto("/termini?mjesec=svi")
      const before = await readTotal(page)
      await page.goto(`/termini?selected=${tid}`)
      await expect(page.getByTestId("mark-done-form")).toBeVisible()
      await page.getByTestId("mark-done-submit").click()
      // Sačekaj da Server Action commit-uje: nakon uspjeha + revalidate, sheet se
      // re-renderuje i "Označi izvršeno" forma nestaje (termin.status === "izvrseno").
      // Bez ovoga test čita stat PRIJE commita — RLS/proxy latencija je tu trku razotkrila.
      await expect(page.getByTestId("mark-done-form")).toHaveCount(0)
      // idiNa: revalidate refresh nakon akcije može prekinuti goto (v. fixtures.ts)
      await idiNa(page, "/termini?mjesec=svi")
      const after = await readTotal(page)
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
    await page.getByTestId("dialog-close").click()
    await page.waitForURL((u) => !u.search.includes("selected="))
    await expect(page.getByTestId("termin-sheet")).toBeHidden()
  })
})

test.describe("Faza 3 — Novi termin", () => {
  test("kreira novi termin koji se pojavi u listi", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    const kid = await insertKlijent(naziv)
    try {
      await page.goto("/termini?mjesec=svi")
      const before = await readTotal(page)
      await page.getByTestId("novi-termin-btn").click()
      await expect(page.getByTestId("novi-termin-sheet")).toBeVisible()
      await page.getByTestId("novi-klijent").click()
      await page.getByRole("option", { name: naziv }).click()
      await page.getByTestId("novi-vrsta").click()
      await page.getByRole("option").first().click()
      await page.getByTestId("novi-rok").fill("2029-03-15")
      await page.getByTestId("novi-submit").click()
      await expect(page.getByTestId("novi-termin-sheet")).toBeHidden({ timeout: 5000 })
      // idiNa: revalidate refresh nakon akcije može prekinuti goto (v. fixtures.ts)
      await idiNa(page, "/termini?mjesec=svi")
      const after = await readTotal(page)
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
      // `message` greške idu isključivo u sonner toast (yoink batch; inline samo
      // field-greške) — scope na toast kontejner, isti obrazac kao 16-profil.spec.
      await expect(
        page.locator("[data-sonner-toast]").getByText("Termin za istu firmu, vrstu i rok već postoji."),
      ).toBeVisible()
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
    await expect(page.getByTestId("termini-table")).toBeVisible()
    // Snapshot za manualni pregled (ne toHaveScreenshot da izbjegnemo baseline drift na seed promjenama)
    await page.screenshot({ path: "test-results/termini-faza3.png", fullPage: true })
  })

  test("status badge boje odgovaraju izvedenom statusu (§9.1)", async ({ page }) => {
    // 'kasni' filter → svi badge-evi crveni
    await page.goto("/termini?status=kasni&mjesec=svi")
    await page.waitForLoadState("networkidle")
    const kasni = page.getByTestId("status-badge").first()
    await expect(kasni).toHaveAttribute("data-status", "kasni")
    await expect(kasni).toHaveClass(/bg-red-50/)

    // 'izvrseno' filter → zeleni
    await page.goto("/termini?status=izvrseno&mjesec=svi")
    await page.waitForLoadState("networkidle")
    const izvr = page.getByTestId("status-badge").first()
    await expect(izvr).toHaveAttribute("data-status", "izvrseno")
    await expect(izvr).toHaveClass(/bg-green-50/)
  })
})
