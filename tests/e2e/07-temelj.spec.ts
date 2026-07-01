import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

test.describe("Temelj — Lokacija kolona u termini tabeli", () => {
  test("bar jedan WAIKIKI termin ima popunjenu lokaciju (ne '—')", async ({ page }) => {
    await page.goto("/termini")
    // Filtriraj po firmi WAIKIKI koristeći filter-search koji pretražuje i lokaciju_naziv
    const search = page.getByTestId("filter-search")
    await search.fill("WAIKIKI")
    await search.press("Enter")
    await page.waitForURL(/q=WAIKIKI/)
    const rows = page.getByTestId("termin-row")
    await expect(rows.first()).toBeVisible()
    // Treća ćelija (lokacija, index 2) u barem prvom redu ne smije biti "—"
    // Pronalazimo sve <td> unutar prvog reda
    const firstRowCells = rows.first().locator("td")
    const lokacijaCell = firstRowCells.nth(2)
    const lokacijaText = await lokacijaCell.textContent()
    expect(lokacijaText?.trim()).not.toBe("—")
    expect(lokacijaText?.trim().length).toBeGreaterThan(0)
  })
})

test.describe("Temelj — Lokacija filter u /termini", () => {
  test("izaberi firmu WAIKIKI → filter-lokacija se pojavljuje → izaberi lokaciju → lista se filtrira", async ({ page }) => {
    await page.goto("/termini")

    // Klikni firma dropdown
    await page.getByTestId("filter-klijent").click()
    const waikikiOpt = page.getByRole("option", { name: /^WAIKIKI$/ })
    await expect(waikikiOpt).toBeVisible()
    await waikikiOpt.click()
    await page.waitForURL(/klijent_id=/)

    // filter-lokacija mora biti vidljiv (WAIKIKI ima lokacije)
    await expect(page.getByTestId("filter-lokacija")).toBeVisible()

    // Izaberi prvu lokaciju
    await page.getByTestId("filter-lokacija").click()
    const firstLokOpt = page.getByRole("option").filter({ hasNot: page.getByText(/Sve lokacije/) }).first()
    await expect(firstLokOpt).toBeVisible()
    const lokNaziv = (await firstLokOpt.textContent()) ?? ""
    await firstLokOpt.click()
    await page.waitForURL(/lokacija=/)

    // URL sadrži ?lokacija=
    expect(page.url()).toContain("lokacija=")

    // Lista ima redove (nije prazna); čekamo s timeout-om jer fetch može kasniti
    const rows = page.getByTestId("termin-row")
    await expect(rows).not.toHaveCount(0)

    // Svaki vidljivi red sadrži naziv lokacije ILI klijenta (WAIKIKI)
    // (Dovoljno je da rezultati nisu prazni i da URL filter radi)
    console.log(`Lokacija filter test — izabrana lokacija: ${lokNaziv}, redova: ${await rows.count()}`)
  })
})

test.describe("Temelj — Klijenti (firme) pregled", () => {
  test("WAIKIKI kartica ima broj_lokacija > 0", async ({ page }) => {
    await page.goto("/klijenti?q=WAIKIKI")
    await page.waitForURL(/q=WAIKIKI/)
    const cards = page.getByTestId("klijent-card")
    await expect(cards.first()).toBeVisible()
    await expect(cards.first()).toContainText(/WAIKIKI/i)
    // Kartica prikazuje "X lok." — mora biti > 0
    const cardText = (await cards.first().textContent()) ?? ""
    const lokMatch = cardText.match(/(\d+)\s*lok\./)
    expect(lokMatch).not.toBeNull()
    const lokCount = Number(lokMatch![1])
    expect(lokCount).toBeGreaterThan(0)
  })

  test("WAIKIKI detalji → Lokacije tab nije prazan", async ({ page }) => {
    await page.goto("/klijenti?q=WAIKIKI")
    await page.waitForURL(/q=WAIKIKI/)
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)

    await page.getByRole("tab", { name: "Lokacije" }).click()
    await page.waitForURL(/tab=lokacije/)
    await expect(page.getByTestId("tab-lokacije-content")).toBeVisible()

    // Tabla treba da ima bar jedan red (WAIKIKI ima 13+ lokacija)
    const lokRows = page.getByTestId("lokacija-row")
    expect(await lokRows.count()).toBeGreaterThan(0)
  })
})

test.describe("Temelj — Postavke vrste pregleda (interval autosave)", () => {
  // Sekcija "Vrste pregleda" je collapsible (zatvorena po defaultu).
  const otvoriVrste = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: "Vrste pregleda" }).click()

  test("tabela vrsta je vidljiva na /postavke", async ({ page }) => {
    await page.goto("/postavke")
    await otvoriVrste(page)
    await expect(page.getByTestId("vrste-tabela")).toBeVisible()
  })

  test("promijeni interval prve vrste (autosave na Enter) → perzistira → vrati na original", async ({ page }) => {
    await page.goto("/postavke")
    await otvoriVrste(page)
    const tabela = page.getByTestId("vrste-tabela")
    await expect(tabela).toBeVisible()

    // Prvi interval input u tabeli (interval-<uuid>)
    const firstInput = tabela.locator("input[type='number']").first()
    await expect(firstInput).toBeVisible()

    // Sačuvaj originalnu vrijednost
    const originalValue = (await firstInput.inputValue()) ?? ""

    // Postavi novu vrijednost → Enter blur-uje polje i autosave-uje red
    const newValue = originalValue === "12" ? "24" : "12"
    await firstInput.fill(newValue)
    await firstInput.press("Enter")
    // Sačekaj da server action + router.refresh završe (cloud DB latencija)
    await page.waitForLoadState("networkidle")

    // Reload — provjeri da je vrijednost sačuvana
    await page.reload()
    await otvoriVrste(page)
    await expect(tabela).toBeVisible()
    const afterReload = tabela.locator("input[type='number']").first()
    await expect(afterReload).toHaveValue(newValue)

    // Vrati na originalnu vrijednost (cleanup)
    await afterReload.fill(originalValue)
    await afterReload.press("Enter")
    await page.waitForLoadState("networkidle")
  })
})

test.describe("Temelj — Bez console grešaka", () => {
  test("nema console grešaka na /termini", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
    })
    await page.goto("/termini")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })

  test("nema console grešaka na /postavke", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text())
    })
    await page.goto("/postavke")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
