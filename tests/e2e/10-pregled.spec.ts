import { test, expect } from "@playwright/test"

test.describe("Faza dashboard — Pregled", () => {
  test("/ redirect-uje na /pregled", async ({ page }) => {
    await page.goto("/")
    await page.waitForURL(/\/pregled$/)
    await expect(page.getByRole("heading", { name: "Pregled" })).toBeVisible()
  })

  test("prikazuje 4 KPI kartice, chart i hitno/kasni listu", async ({ page }) => {
    await page.goto("/pregled")
    expect(await page.getByTestId("stat-card").count()).toBe(4)
    await expect(page.getByTestId("dashboard-chart")).toBeVisible()
    await expect(page.getByTestId("hitno-kasni-list")).toBeVisible()
  })

  test("klik 'Kasni rokovi' vodi na filtriran /termini", async ({ page }) => {
    await page.goto("/pregled")
    await page.getByRole("link", { name: /Kasni rokovi/ }).click()
    await page.waitForURL(/\/termini\?status=kasni/)
  })

  test("nav 'Pregled' je aktivan", async ({ page }) => {
    await page.goto("/pregled")
    await expect(page.getByRole("link", { name: "Pregled", exact: true })).toHaveAttribute("aria-current", "page")
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/pregled")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
