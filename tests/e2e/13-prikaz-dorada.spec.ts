import { test, expect } from "@playwright/test"

test.describe("Prikaz — dorada", () => {
  test("legenda je vidljiva kad je matrica (po mjesecu)", async ({ page }) => {
    await page.goto("/prikaz?mode=mjesec&godina=2026&mjesec=2")
    await expect(page.getByTestId("prikaz-matrix")).toBeVisible()
    await expect(page.getByTestId("matrix-legenda")).toBeVisible()
    await expect(page.getByTestId("matrix-legenda")).toContainText("izvršeno")
    await expect(page.getByTestId("matrix-legenda")).toContainText("Kasni")
  })

  test("legenda NIJE vidljiva u praznom stanju (po klijentu bez izbora)", async ({ page }) => {
    await page.goto("/prikaz")
    await expect(page.getByTestId("prikaz-empty")).toBeVisible()
    await expect(page.getByTestId("matrix-legenda")).toHaveCount(0)
  })
})
