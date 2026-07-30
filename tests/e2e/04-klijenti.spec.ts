import { test, expect } from "@playwright/test"
import { deleteKlijentByNaziv } from "./db"
import { kreirajFirmuFiksturu, type FirmaFikstura } from "./fixtures"

// Firma sa lokacijama i terminima koju testovi sami naprave i sami obrišu —
// nijedan test se ne oslanja na konkretnu zasijanu firmu iz DEMO skupa.
let fx: FirmaFikstura

test.beforeAll(async () => {
  fx = await kreirajFirmuFiksturu({ oznaka: "F04" })
})

test.afterAll(async () => {
  await fx?.obrisi()
})

async function kreirajKlijent(page: import("@playwright/test").Page, naziv: string) {
  await page.goto("/klijenti")
  await page.getByTestId("novi-klijent-btn").click()
  await page.getByTestId("novi-klijent-naziv").fill(naziv)
  // adresa/telefon/email su obavezni (odluka 2026-07-03)
  await page.getByTestId("novi-klijent-adresa").fill("Testna ulica 1, Banja Luka")
  await page.getByTestId("novi-klijent-telefon").fill("+387 51 000 000")
  await page.getByTestId("novi-klijent-email").fill("e2e-klijent@example.com")
  await page.getByTestId("novi-klijent-submit").click()
  await expect(page.getByTestId("novi-klijent-sheet")).toBeHidden({ timeout: 5000 })
}

async function otvoriKlijent(page: import("@playwright/test").Page, naziv: string) {
  await page.goto("/klijenti?q=" + encodeURIComponent(naziv), { waitUntil: "domcontentloaded" })
  await page.getByTestId("klijent-card").filter({ hasText: naziv }).first().click()
  await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}/)
}

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

  test("pretraga po nazivu vraća traženu firmu", async ({ page }) => {
    await page.goto("/klijenti")
    const input = page.getByTestId("klijenti-search")
    await input.fill(fx.naziv)
    await input.press("Enter")
    await page.waitForURL(/q=E2E-TMP/)
    const cards = page.getByTestId("klijent-card")
    expect(await cards.count()).toBeGreaterThan(0)
    await expect(cards.first()).toContainText(fx.naziv)
  })

  test("paginacija Sljedeća mijenja stranu", async ({ page }) => {
    await page.goto("/klijenti")
    // Paginacija se prikazuje samo kad ima > 1 strane; sa ≤ 1 strane nema šta provjeriti.
    const next = page.getByRole("link", { name: "Sljedeća" })
    if (await next.count()) {
      await expect(page.getByTestId("klijenti-page")).toContainText("Strana 1")
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
  test("otvara detalje i podrazumijevano prikazuje ID kartu", async ({ page }) => {
    await otvoriKlijent(page, fx.naziv)
    await expect(page.getByTestId("klijent-naziv")).toContainText(fx.naziv)
    // Default tab je ID karta (yoink 2026-07-30, stavka 1)
    await expect(page.getByTestId("tab-id-karta-content")).toBeVisible()
    await expect(page.getByTestId("tab-termini-content")).toHaveCount(0)
  })

  test("termini tab se otvara klikom i ima podatke", async ({ page }) => {
    await otvoriKlijent(page, fx.naziv)
    await page.getByTestId("tab-termini").click()
    await expect(page.getByTestId("tab-termini-content")).toBeVisible()
    // fikstura ima termine → tabela ima redove (ne empty state)
    await expect(page.getByTestId("tab-termini-content").getByRole("row").first()).toBeVisible()
    await expect(page.getByTestId("tab-termini-content")).not.toContainText("Nema termina")
  })

  test("prebacivanje Lokacije / Dokumenti tab (§9.1 detail prikazuje lokacije)", async ({ page }) => {
    await otvoriKlijent(page, fx.naziv)
    // Lokacije tab (T5 ga puni; ovdje bar potvrdi da se sadržaj prikazuje — empty ili lista)
    await page.getByTestId("tab-lokacije").click()
    await page.waitForURL(/tab=lokacije/)
    await expect(page.getByTestId("tab-lokacije-content")).toBeVisible()
    // Dokumenti tab — T7 implementiran: prikazuje tabelu ili poruku o praznom stanju
    await page.getByTestId("tab-dokumenti").click()
    await page.waitForURL(/tab=dokumenti/)
    await expect(page.getByTestId("tab-dokumenti-content")).toBeVisible()
  })
})

test.describe("Faza 4 — Lokacije CRUD", () => {
  test("kreira, uređuje i briše lokaciju", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await kreirajKlijent(page, naziv)
      await otvoriKlijent(page, naziv)
      await page.getByTestId("tab-lokacije").click()
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

      // delete — red nestane
      await row.getByRole("button", { name: "Obriši" }).click()
      await page.getByTestId("obrisi-lokaciju-potvrdi").click()
      await expect(page.getByTestId("lokacija-row").filter({ hasText: "Test Lokacija" })).toHaveCount(0)
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Faza 4 — Novi klijent", () => {
  test("kreira klijenta koji se pojavi u listi", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await page.goto("/klijenti")
      const before = Number((await page.getByTestId("klijenti-total").textContent())?.match(/\d+/)?.[0] ?? "0")
      await page.getByTestId("novi-klijent-btn").click()
      await expect(page.getByTestId("novi-klijent-sheet")).toBeVisible()
      await page.getByTestId("novi-klijent-naziv").fill(naziv)
      await page.getByTestId("novi-klijent-adresa").fill("Testna ulica 1, Banja Luka")
      await page.getByTestId("novi-klijent-telefon").fill("+387 51 000 000")
      await page.getByTestId("novi-klijent-email").fill("e2e-klijent@example.com")
      await page.getByTestId("novi-klijent-submit").click()
      await expect(page.getByTestId("novi-klijent-sheet")).toBeHidden({ timeout: 5000 })
      const after = Number((await page.getByTestId("klijenti-total").textContent())?.match(/\d+/)?.[0] ?? "0")
      expect(after).toBe(before + 1)
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Faza 4 — Klijent edit i delete", () => {
  test("uređuje napomenu klijenta", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await kreirajKlijent(page, naziv)
      await otvoriKlijent(page, naziv)
      await page.getByTestId("uredi-klijent-btn").click()
      await expect(page.getByTestId("klijent-edit-sheet")).toBeVisible()
      await page.getByTestId("edit-klijent-napomena").fill("E2E napomena " + Date.now())
      await page.getByTestId("edit-klijent-submit").click()
      await expect(page.getByTestId("klijent-edit-sheet")).toBeHidden({ timeout: 5000 })
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })

  test("delete je onemogućen za klijenta sa terminima", async ({ page }) => {
    await otvoriKlijent(page, fx.naziv)
    await expect(page.getByTestId("obrisi-klijent-disabled")).toBeVisible()
  })

  test("kreiran prazan klijent se može obrisati", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await kreirajKlijent(page, naziv)
      await otvoriKlijent(page, naziv)
      await page.getByTestId("obrisi-klijent-btn").click()
      await page.getByTestId("obrisi-klijent-potvrdi").click()
      await page.waitForURL(/\/klijenti(\?|$)/)
      await expect(page.getByRole("heading", { name: "Klijenti" })).toBeVisible()
    } finally {
      await deleteKlijentByNaziv(naziv) // backstop ako UI delete zakaže
    }
  })
})

test.describe("Faza badge — tip odnosa", () => {
  test("uređivanje postavlja tip odnosa na 'po ugovoru'", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await kreirajKlijent(page, naziv)
      await otvoriKlijent(page, naziv)
      // testid umjesto role name "Uredi": default tab je sad ID karta, čiji info-ikona
      // tooltip ima aria-label koji sadrži riječ "Uredi" pa bi role selector bio dvosmislen.
      await page.getByTestId("uredi-klijent-btn").click()
      await page.getByTestId("klijent-tip-odnosa").click()
      await page.getByRole("option", { name: "Po ugovoru" }).click()
      await page.getByRole("button", { name: /Spremi/ }).click()
      await expect(page.getByTestId("tip-odnosa-badge")).toContainText("po ugovoru")
    } finally {
      await deleteKlijentByNaziv(naziv)
    }
  })
})

test.describe("Faza 4 — Vizuelni smoke", () => {
  test("klijenti ekran screenshot @ 1440x900", async ({ page }) => {
    await page.goto("/klijenti")
    await page.waitForLoadState("networkidle")
    await expect(page.getByTestId("klijenti-grid")).toBeVisible()
    await page.screenshot({ path: "test-results/klijenti-faza4.png", fullPage: true })
  })

  test("Lokacija prikazuje unesenu kontakt osobu", async ({ page }) => {
    const naziv = "E2E-TMP " + Date.now()
    try {
      await kreirajKlijent(page, naziv)
      await otvoriKlijent(page, naziv)
      await page.getByTestId("tab-lokacije").click()
      await page.waitForURL(/tab=lokacije/)
      await page.getByTestId("nova-lokacija-btn").click()
      await page.getByTestId("lokacija-naziv").fill("Centrala")
      await page.getByTestId("lokacija-kontakt_osoba").fill("Ana A.")
      await page.getByTestId("lokacija-submit").click()
      await expect(page.getByTestId("lokacija-sheet")).toBeHidden({ timeout: 5000 })
      // Lokacijski kontakt se prikazuje u Lokacije tabu (tab Kontakti je sad za kontakte FIRME).
      await expect(page.getByTestId("lokacije-table")).toContainText("Ana A.")
    } finally {
      await deleteKlijentByNaziv(naziv) // cascade briše lokaciju "Centrala"
    }
  })
})
