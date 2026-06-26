/**
 * 17-login.spec.ts
 *
 * Regresijski test koji potvrđuje da PRAVI UI login radi — formi /prijava
 * → signInWithPassword → redirect /pregled. Koristi svjež (prazni) kontekst
 * bez storageState, pa zaobilazni fast-path iz auth.setup.ts ne vrijedi.
 *
 * Ovo je namjerno jedan pravi login po runu (rate-limit-svjesno).
 */
import { readFileSync } from "node:fs"
import { test, expect } from "@playwright/test"

function envVar(key: string): string {
  if (process.env[key]) return process.env[key] as string
  let content = ""
  try {
    content = readFileSync(".env.local", "utf8")
  } catch {
    return ""
  }
  const line = content
    .split("\n")
    .find((l) => l.trimStart().startsWith(`${key}=`))
  return line ? line.slice(line.indexOf("=") + 1).trim() : ""
}

const ADMIN_EMAIL = envVar("E2E_ADMIN_EMAIL")
const ADMIN_LOZINKA = envVar("E2E_ADMIN_LOZINKA")

if (!ADMIN_EMAIL) throw new Error("17-login.spec: nedostaje E2E_ADMIN_EMAIL")
if (!ADMIN_LOZINKA) throw new Error("17-login.spec: nedostaje E2E_ADMIN_LOZINKA")

// Prazni storageState — ignoriše admin.json fast-path
test.use({ storageState: { cookies: [], origins: [] } })

test("pravi UI login dovodi na /pregled", async ({ page }) => {
  await page.goto("/prijava")
  await page.getByPlaceholder("Email").fill(ADMIN_EMAIL)
  await page.getByPlaceholder("Lozinka").fill(ADMIN_LOZINKA)
  await page.getByRole("button", { name: "Prijavi se" }).click()
  await expect(page).toHaveURL("/pregled", { timeout: 30_000 })
  const cookies = await page.context().cookies()
  expect(cookies.some((c) => c.name.includes("auth-token"))).toBe(true)
})
