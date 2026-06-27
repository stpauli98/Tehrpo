import { test, expect } from "@playwright/test"

test.describe("Plan aktivnosti — konsolidacija", () => {
  test("default view = lista; switcher mijenja prikaz", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await expect(page.getByTestId("plan-view-switcher")).toBeVisible()
    await expect(page.getByTestId("view-lista")).toHaveAttribute("data-active", "true")
    await expect(page.getByTestId("termini-filters")).toBeVisible()

    await page.getByTestId("view-kalendar").click()
    await page.waitForURL(/view=kalendar/)
    await expect(page.getByTestId("view-kalendar")).toHaveAttribute("data-active", "true")

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
    await expect(nav.getByRole("link", { name: "Prikaz", exact: true })).toHaveCount(0)
  })
})
