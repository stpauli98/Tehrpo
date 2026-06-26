// tests/e2e/auth.setup.ts
import { test as setup, expect } from "@playwright/test"

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@tehpro.test"
const ADMIN_LOZINKA = process.env.E2E_ADMIN_LOZINKA ?? "9YcluZJpmTYPpIwhQfc4Aa1!"

setup("authenticate admin", async ({ page }) => {
  await page.goto("/prijava")
  await page.getByPlaceholder("Email").fill(ADMIN_EMAIL)
  await page.getByPlaceholder("Lozinka").fill(ADMIN_LOZINKA)
  await page.getByRole("button", { name: "Prijavi se" }).click()
  await expect(page).toHaveURL("/pregled")
  await page.context().storageState({ path: "tests/e2e/.auth/admin.json" })
})
