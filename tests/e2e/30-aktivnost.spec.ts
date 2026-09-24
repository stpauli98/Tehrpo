// tests/e2e/30-aktivnost.spec.ts
// Task 11 verifikacija: admin vidi ekran "Aktivnost" (audit log), operater dobija 404.
import { test, expect } from "@playwright/test"
import { injectSessionFor } from "./session-helper"
import { ensureOperater } from "./db"

const OP_EMAIL = "e2e-operater@demo.test"
const OP_LOZINKA = "E2eOperater2026!"
const OP_IME = "E2E Operater"

test.beforeAll(async () => {
  await ensureOperater(OP_EMAIL, OP_LOZINKA, OP_IME)
})

test("admin vidi ekran Aktivnost", async ({ page }) => {
  await page.goto("/aktivnost")
  await expect(page.getByRole("heading", { name: "Aktivnost" })).toBeVisible({ timeout: 30_000 })
  // Klijentski-renderovana filter labela (useTranslations("aktivnost") u AktivnostFilteri).
  // Hvata MISSING_MESSAGE regresiju: bez namespace-a u CLIENT_NAMESPACES renderuje se
  // ključ ("filteri.akcija") umjesto prevedene labele.
  await expect(page.getByText("Tip akcije")).toBeVisible({ timeout: 30_000 })
})

test("operater dobija 404 na /aktivnost", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const opPage = await ctx.newPage()
    await injectSessionFor(ctx, OP_EMAIL, OP_LOZINKA)
    // Prvo dokaži da operater sesija radi — inače bi tihi login-bounce na /prijava
    // (koji nema "Aktivnost" heading) dao false-pass na negativnoj asertaciji ispod.
    await opPage.goto("/pregled")
    await expect(opPage.getByRole("heading", { name: "Pregled" })).toBeVisible({ timeout: 30_000 })
    // Tek onda /aktivnost: notFound() zadržava URL /aktivnost (404), dok bi login-bounce
    // promijenio URL na /prijava. Asertuj OBOJE da razlikuješ 404-gate od bounce-a.
    await opPage.goto("/aktivnost")
    await expect(opPage).toHaveURL(/\/aktivnost/, { timeout: 30_000 })
    await expect(opPage.getByRole("heading", { name: "Aktivnost" })).toHaveCount(0)
  } finally {
    await ctx.close()
  }
})

test("prva porcija ima 50 redova i dugme Učitaj još", async ({ page }) => {
  await page.goto("/aktivnost")
  await expect(page.getByRole("heading", { name: "Aktivnost" })).toBeVisible({ timeout: 30_000 })
  const redovi = page.locator("table tbody tr")
  await expect(redovi).toHaveCount(50, { timeout: 30_000 })
  await expect(page.getByTestId("aktivnost-ucitaj-jos")).toBeVisible()
})

test("Učitaj još dodaje porciju bez duplikata", async ({ page }) => {
  await page.goto("/aktivnost")
  const redovi = page.locator("table tbody tr")
  await expect(redovi).toHaveCount(50, { timeout: 30_000 })

  // textContent NIJE pouzdan identitet reda: dva različita audit zapisa (isti
  // korisnik, ista akcija, isti ekran, u istom minutu) mogu se prikazati identično
  // jer kolona „vrijeme" ide samo do minute. Identitet reda je `data-red-id`
  // (test-hook u AktivnostTabela.tsx koji ogoljava PK iza React `key`-a).
  const prvaPorcija = await redovi.evaluateAll((tr) =>
    tr.map((r) => r.getAttribute("data-red-id") ?? ""))

  await page.getByTestId("aktivnost-ucitaj-jos").click()
  await expect(redovi).toHaveCount(100, { timeout: 30_000 })

  const sviId = await redovi.evaluateAll((tr) => tr.map((r) => r.getAttribute("data-red-id") ?? ""))
  // Prvih 50 su nepromijenjeni, drugih 50 su novi — provjera po ID-u (ne po tekstu).
  expect(sviId.slice(0, 50)).toEqual(prvaPorcija)
  expect(new Set(sviId).size).toBe(sviId.length)
})

test("pretraga sužava listu i resetuje je na prvu porciju", async ({ page }) => {
  await page.goto("/aktivnost")
  const redovi = page.locator("table tbody tr")
  await expect(redovi).toHaveCount(50, { timeout: 30_000 })

  // Prvo učitaj drugu porciju, pa pretraži — lista se mora vratiti na jednu porciju.
  await page.getByTestId("aktivnost-ucitaj-jos").click()
  await expect(redovi).toHaveCount(100, { timeout: 30_000 })

  await page.getByTestId("aktivnost-search").fill("klijenti")
  await expect(page).toHaveURL(/q=klijenti/, { timeout: 30_000 })
  await expect(redovi).not.toHaveCount(100, { timeout: 30_000 })
  const broj = await redovi.count()
  expect(broj).toBeGreaterThan(0)
  expect(broj).toBeLessThanOrEqual(50)
})

test("filter po korisniku sužava listu", async ({ page }) => {
  await page.goto("/aktivnost")
  // NE traži tekst „Korisnik" — tako se zove i kolona u tabeli, pa bi getByText
  // pao na strict-mode višestrukom pogotku. Broj combobox-a je jednoznačan:
  // prvi je „Tip akcije", drugi je novi „Korisnik".
  const selecti = page.getByRole("combobox")
  await expect(selecti).toHaveCount(2, { timeout: 30_000 })
  await selecti.nth(1).click()
  // Prva stavka poslije „Svi korisnici" je konkretan korisnik.
  await page.getByRole("option").nth(1).click()
  await expect(page).toHaveURL(/korisnik=/, { timeout: 30_000 })
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 })
})

test("operater ne može pozvati get_aktivnost_strana", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const opPage = await ctx.newPage()
    await injectSessionFor(ctx, OP_EMAIL, OP_LOZINKA)
    // Dokaži prvo da sesija radi — inače bi 404 na API ruti bio false-pass.
    await opPage.goto("/pregled")
    await expect(opPage.getByRole("heading", { name: "Pregled" })).toBeVisible({ timeout: 30_000 })

    // API ruta mora vratiti 404 (admin gate), a ne redove.
    const res = await opPage.request.get("/api/aktivnost")
    expect(res.status()).toBe(404)
    const tijelo = await res.json()
    expect(tijelo.redovi).toBeUndefined()
  } finally {
    await ctx.close()
  }
})
