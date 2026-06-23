import { test, expect } from "@playwright/test"

test.describe("Obilasci dorada — status filter", () => {
  test("default je Aktivni (bez izvršenih); Svi vraća izvršene", async ({ page }) => {
    await page.goto("/obilasci?period=godina&godina=2026")
    // default Aktivni → nijedna kartica nema status badge "Izvršen"
    await expect(page.getByTestId("obilasci-status")).toBeVisible()
    const izvrseniDefault = page.getByTestId("obilasci-card").locator('[data-status="izvrseno"]')
    await expect(izvrseniDefault).toHaveCount(0)
    // prebaci na Svi → pojave se izvršeni
    await page.getByTestId("obilasci-status").click()
    await page.getByRole("option", { name: "Svi" }).click()
    await page.waitForURL(/status=svi/)
    await expect(page.getByTestId("obilasci-card").locator('[data-status="izvrseno"]').first()).toBeVisible()
  })
})
