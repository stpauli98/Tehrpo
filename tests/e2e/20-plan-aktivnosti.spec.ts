import { test, expect } from "@playwright/test"

test.describe("Plan aktivnosti — konsolidacija", () => {
  test("default view = kalendar; switcher mijenja prikaz", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await expect(page.getByTestId("plan-view-switcher")).toBeVisible()
    await expect(page.getByTestId("view-kalendar")).toHaveAttribute("data-active", "true")
    await expect(page.getByTestId("plan-grid")).toBeVisible()

    await page.getByTestId("view-lista").click()
    await page.waitForURL(/view=lista/)
    await expect(page.getByTestId("view-lista")).toHaveAttribute("data-active", "true")
    await expect(page.getByTestId("termini-filters")).toBeVisible()

    await page.getByTestId("view-matrica").click()
    await page.waitForURL(/view=matrica/)
    await expect(page.getByTestId("view-matrica")).toHaveAttribute("data-active", "true")
  })

  test("filter se zadrži pri promjeni view-a", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=lista&status=kasni")
    await page.getByTestId("view-kalendar").click()
    await page.waitForURL(/status=kasni/)
    await expect(page).toHaveURL(/view=kalendar/)
  })

  test("redirect: /termini?status=kasni -> /plan-aktivnosti?...view=lista", async ({ page }) => {
    await page.goto("/termini?status=kasni")
    await page.waitForURL(/\/plan-aktivnosti\?/)
    await expect(page).toHaveURL(/view=lista/)
    await expect(page).toHaveURL(/status=kasni/)
  })

  test("matrica NEMA grafikon; Pregled IMA grafikon", async ({ page }) => {
    await page.goto("/plan-aktivnosti?view=matrica")
    await expect(page.getByTestId("dashboard-chart")).toHaveCount(0)
    await page.goto("/pregled")
    await expect(page.getByTestId("dashboard-chart")).toBeVisible()
  })

  test("Sidebar: postoji 'Plan aktivnosti', nema Termini/Prikaz/Plan", async ({ page }) => {
    await page.goto("/pregled")
    const nav = page.getByRole("navigation", { name: "Glavna navigacija" })
    await expect(nav.getByRole("link", { name: "Plan aktivnosti" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Termini", exact: true })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: "Prikaz", exact: true })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: "Plan", exact: true })).toHaveCount(0)
  })
})

test.describe("Plan aktivnosti — izvoz modal", () => {
  test("otvara modal, default period, Prilagodi otkriva opcije", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await page.getByTestId("izvoz-trigger").click()
    await expect(page.getByTestId("izvoz-modal")).toBeVisible()
    // Prilagodi skriveno na početku
    await expect(page.getByTestId("izvoz-period")).toHaveCount(0)
    await page.getByTestId("izvoz-prilagodi").click()
    await expect(page.getByTestId("izvoz-period")).toBeVisible()
    await expect(page.getByTestId("izvoz-period-om")).toBeChecked()
    // Živi broj se prikaže (bilo koji tekst)
    await expect(page.getByTestId("izvoz-broj")).not.toHaveText("")
  })

  test("Preuzmi pokreće download (Excel)", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await page.getByTestId("izvoz-trigger").click()
    await page.getByTestId("izvoz-format-xlsx").click()
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("izvoz-preuzmi").click(),
    ])
    expect(download.suggestedFilename()).toMatch(/plan-aktivnosti-.*\.xlsx$/)
  })

  test("prilagođeni raspon: nevažeći datumi drže Preuzmi onemogućen", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await page.getByTestId("izvoz-trigger").click()
    await page.getByTestId("izvoz-prilagodi").click()
    await page.getByTestId("izvoz-period-raspon").check()
    await page.getByTestId("izvoz-od").fill("2026-07-31")
    await page.getByTestId("izvoz-do").fill("2026-07-01")
    await expect(page.getByTestId("izvoz-preuzmi")).toBeDisabled()
  })
})
