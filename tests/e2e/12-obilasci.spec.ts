import { test, expect } from "@playwright/test"

test.describe("Faza obilasci", () => {
  test("učita se sa default mjesecom i grupama po gradu", async ({ page }) => {
    await page.goto("/obilasci")
    await expect(page.getByRole("heading", { name: "Obilasci" })).toBeVisible()
    await expect(page.getByTestId("obilasci-toolbar")).toBeVisible()
  })

  test("period 'Godina' prikaže termine grupisane po gradu", async ({ page }) => {
    await page.goto("/obilasci?period=godina&godina=2026")
    const grupe = page.getByTestId("obilasci-grupa")
    expect(await grupe.count()).toBeGreaterThan(0)
  })

  test("nav 'Obilasci' je aktivan", async ({ page }) => {
    await page.goto("/obilasci")
    await expect(page.getByRole("link", { name: "Obilasci" })).toHaveAttribute("aria-current", "page")
  })

  test("bez console grešaka", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/obilasci?period=godina&godina=2026")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
