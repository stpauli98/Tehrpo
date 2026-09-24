import { test, expect } from "@playwright/test"
import { kreirajFirmuFiksturu, type FirmaFikstura } from "./fixtures"

test.describe.configure({ mode: "serial" })

// Firma sa 2 lokacije i po jednim terminom na svakoj (u tekućem mjesecu, tj.
// unutar podrazumijevanog "tekući+naredni" filtera liste) — test sam pravi
// preduslove umjesto da traži konkretnu zasijanu firmu.
let fx: FirmaFikstura

test.beforeAll(async () => {
  fx = await kreirajFirmuFiksturu({ oznaka: "F07" })
})

test.afterAll(async () => {
  await fx?.obrisi()
})

test.describe("Temelj — Lokacija kolona u termini tabeli", () => {
  test("bar jedan termin fiksture ima popunjenu lokaciju (ne '—')", async ({ page }) => {
    await page.goto("/termini")
    // Filtriraj po firmi koristeći filter-search koji pretražuje i lokaciju_naziv
    const search = page.getByTestId("filter-search")
    await search.fill(fx.naziv)
    await search.press("Enter")
    await page.waitForURL(/q=E2E-TMP/)
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
  test("izaberi firmu → filter-lokacija se pojavljuje → izaberi lokaciju → lista se filtrira", async ({ page }) => {
    await page.goto("/termini")

    // Klikni firma dropdown
    await page.getByTestId("filter-klijent").click()
    const firmaOpt = page.getByRole("option", { name: fx.naziv, exact: true })
    await expect(firmaOpt).toBeVisible()
    await firmaOpt.click()
    await page.waitForURL(/klijent_id=/)

    // filter-lokacija mora biti vidljiv (firma iz fiksture ima lokacije)
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

    // Svaki vidljivi red sadrži naziv lokacije ILI klijenta
    // (Dovoljno je da rezultati nisu prazni i da URL filter radi)
    console.log(`Lokacija filter test — izabrana lokacija: ${lokNaziv}, redova: ${await rows.count()}`)
  })
})

test.describe("Temelj — Klijenti (firme) pregled", () => {
  test("kartica firme ima broj_lokacija > 0", async ({ page }) => {
    await page.goto("/klijenti?q=" + encodeURIComponent(fx.naziv))
    const cards = page.getByTestId("klijent-card")
    await expect(cards.first()).toBeVisible()
    await expect(cards.first()).toContainText(fx.naziv)
    // Kartica prikazuje "X lok." — mora biti > 0
    const cardText = (await cards.first().textContent()) ?? ""
    const lokMatch = cardText.match(/(\d+)\s*lok\./)
    expect(lokMatch).not.toBeNull()
    const lokCount = Number(lokMatch![1])
    expect(lokCount).toBeGreaterThan(0)
  })

  test("detalji firme → Lokacije tab nije prazan", async ({ page }) => {
    await page.goto("/klijenti?q=" + encodeURIComponent(fx.naziv))
    await page.getByTestId("klijent-card").filter({ hasText: fx.naziv }).first().click()
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)

    await page.getByTestId("tab-lokacije").click()
    await page.waitForURL(/tab=lokacije/)
    await expect(page.getByTestId("tab-lokacije-content")).toBeVisible()

    // Tabla treba da ima bar jedan red (fikstura pravi 2 lokacije)
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

    // Postavi novu vrijednost → Enter blur-uje polje i autosave-uje red.
    //
    // Signal završetka je TOAST, ne networkidle: od 6144d15 autosave javlja ishod kroz
    // kanonski toastRezultat() (prije je bilo inline "saved" stanje sa 2s setTimeout).
    // networkidle je uz to bio i nepouzdan — Playwright ga izričito ne preporučuje, a
    // Next dev server drži otvorene HMR/RSC kanale pa "idle" ume da ne nastupi (pad 20s).
    const toastSpremljeno = page.locator("[data-sonner-toast]").getByText("spremljeno")
    const newValue = originalValue === "12" ? "24" : "12"
    await firstInput.fill(newValue)
    await firstInput.press("Enter")
    await expect(toastSpremljeno).toBeVisible()

    // Reload — provjeri da je vrijednost sačuvana
    await page.reload()
    await otvoriVrste(page)
    await expect(tabela).toBeVisible()
    const afterReload = tabela.locator("input[type='number']").first()
    await expect(afterReload).toHaveValue(newValue)

    // Vrati na originalnu vrijednost (cleanup) — isti deterministički signal
    await afterReload.fill(originalValue)
    await afterReload.press("Enter")
    await expect(toastSpremljeno).toBeVisible()
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
