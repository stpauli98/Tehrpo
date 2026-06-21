import { test, expect } from "@playwright/test"

test.describe.configure({ mode: "serial" })

test.describe("Faza 4 — Klijenti lista", () => {
  test("prikazuje grid klijenata", async ({ page }) => {
    await page.goto("/klijenti")
    await expect(page.getByRole("heading", { name: "Klijenti" })).toBeVisible()
    await expect(page.getByTestId("klijenti-grid")).toBeVisible()
    expect(await page.getByTestId("klijent-card").count()).toBeGreaterThan(0)
    const total = await page.getByTestId("klijenti-total").textContent()
    expect(total).toMatch(/Ukupno klijenata:\s*\d+/)
  })

  test("pretraga 'WAIK' vraća WAIKIKI klijente", async ({ page }) => {
    await page.goto("/klijenti")
    const input = page.getByTestId("klijenti-search")
    await input.fill("WAIK")
    await input.press("Enter")
    await page.waitForURL(/q=WAIK/)
    const cards = page.getByTestId("klijent-card")
    expect(await cards.count()).toBeGreaterThan(0)
    await expect(cards.first()).toContainText(/WAIKIKI/i)
  })

  test("paginacija Sljedeća mijenja stranu", async ({ page }) => {
    await page.goto("/klijenti")
    await expect(page.getByTestId("klijenti-page")).toContainText("Strana 1")
    const next = page.getByRole("link", { name: "Sljedeća" })
    if (await next.count()) {
      await next.click()
      await expect(page.getByTestId("klijenti-page")).toContainText("Strana 2")
    }
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/klijenti")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})

test.describe("Faza 4 — Klijent detalji i tabovi", () => {
  test("otvara detalje i prikazuje termini tab sa podacima", async ({ page }) => {
    await page.goto("/klijenti?q=WAIK")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)
    await expect(page.getByTestId("klijent-naziv")).toContainText(/WAIKIKI/i)
    await expect(page.getByTestId("tab-termini-content")).toBeVisible()
    // WAIKIKI ima termine → tabela ima redove (ne empty state)
    await expect(page.getByTestId("tab-termini-content").getByRole("row").first()).toBeVisible()
    await expect(page.getByTestId("tab-termini-content")).not.toContainText("Nema termina")
  })

  test("prebacivanje Lokacije / Dokumenti tab (§9.1 detail prikazuje lokacije)", async ({ page }) => {
    await page.goto("/klijenti?q=WAIK")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\//)
    // Lokacije tab (T5 ga puni; ovdje bar potvrdi da se sadržaj prikazuje — empty ili lista)
    await page.getByRole("tab", { name: "Lokacije" }).click()
    await page.waitForURL(/tab=lokacije/)
    await expect(page.getByTestId("tab-lokacije-content")).toBeVisible()
    // Dokumenti placeholder
    await page.getByRole("tab", { name: "Dokumenti" }).click()
    await page.waitForURL(/tab=dokumenti/)
    await expect(page.getByTestId("tab-dokumenti-content")).toContainText("Fazi 7")
  })
})

test.describe("Faza 4 — Lokacije CRUD", () => {
  test("kreira, uređuje i briše lokaciju", async ({ page }) => {
    await page.goto("/klijenti?q=WAIK")
    await page.getByTestId("klijent-card").first().click()
    await page.waitForURL(/\/klijenti\//)
    await page.getByRole("tab", { name: "Lokacije" }).click()
    await page.waitForURL(/tab=lokacije/)

    // create
    await page.getByTestId("nova-lokacija-btn").click()
    await expect(page.getByTestId("lokacija-sheet")).toBeVisible()
    await page.getByTestId("lokacija-naziv").fill("Test Lokacija")
    await page.getByTestId("lokacija-grad").fill("Banja Luka")
    await page.getByTestId("lokacija-kontakt_osoba").fill("Marko M.")
    await page.getByTestId("lokacija-submit").click()
    await expect(page.getByTestId("lokacija-sheet")).toBeHidden({ timeout: 5000 })
    await expect(page.getByTestId("lokacije-table")).toContainText("Test Lokacija")

    // edit — promijeni grad
    const row = page.getByTestId("lokacija-row").filter({ hasText: "Test Lokacija" })
    await row.getByRole("button", { name: "Uredi" }).click()
    await expect(page.getByTestId("lokacija-sheet")).toBeVisible()
    await page.getByTestId("lokacija-grad").fill("Prijedor")
    await page.getByTestId("lokacija-submit").click()
    await expect(page.getByTestId("lokacija-sheet")).toBeHidden({ timeout: 5000 })
    await expect(page.getByTestId("lokacija-row").filter({ hasText: "Test Lokacija" })).toContainText("Prijedor")

    // delete — pozitivna provjera: red sa "Test Lokacija" nestane
    await row.getByRole("button", { name: "Obriši" }).click()
    await page.getByTestId("obrisi-lokaciju-potvrdi").click()
    await expect(page.getByTestId("lokacija-row").filter({ hasText: "Test Lokacija" })).toHaveCount(0)
  })
})

test.describe("Faza 4 — Novi klijent", () => {
  test("kreira klijenta koji se pojavi u listi", async ({ page }) => {
    const naziv = "E2E Test Klijent " + Date.now()
    await page.goto("/klijenti")
    const before = Number((await page.getByTestId("klijenti-total").textContent())?.match(/\d+/)?.[0] ?? "0")
    await page.getByTestId("novi-klijent-btn").click()
    await expect(page.getByTestId("novi-klijent-sheet")).toBeVisible()
    await page.getByTestId("novi-klijent-naziv").fill(naziv)
    await page.getByTestId("novi-klijent-submit").click()
    await expect(page.getByTestId("novi-klijent-sheet")).toBeHidden({ timeout: 5000 })
    const after = Number((await page.getByTestId("klijenti-total").textContent())?.match(/\d+/)?.[0] ?? "0")
    expect(after).toBe(before + 1)
  })
})
