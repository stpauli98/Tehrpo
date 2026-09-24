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

test.describe("Faza 1 smoke", () => {
  const brand = envVar("NEXT_PUBLIC_APP_NAME") || "Tehpro"

  test("root redirects to /pregled", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL("/pregled")
  })

  test("TopBar prikazuje Tehpro brand", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByRole("banner")).toContainText(brand)
    await expect(page.getByRole("banner")).toContainText("Sistem za termine i provjere")
  })

  test("Sidebar prikazuje svih 9 nav stavki", async ({ page }) => {
    // Default storageState je admin → vidljive su i admin-only stavke
    // (Asistent, Zapisnici, Aktivnost) uz Poslati mejlovi iz yoink batcha.
    // exact: true jer je "Aktivnost" substring od "Plan aktivnosti".
    await page.goto("/plan-aktivnosti")
    const nav = page.getByRole("navigation", { name: "Glavna navigacija" })
    await expect(nav.getByRole("link", { name: "Pregled", exact: true })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Plan aktivnosti", exact: true })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Obilasci", exact: true })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Klijenti", exact: true })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Poslati mejlovi", exact: true })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Asistent", exact: true })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Zapisnici", exact: true })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Aktivnost", exact: true })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Postavke", exact: true })).toBeVisible()
    await expect(nav.getByRole("link")).toHaveCount(9)
  })

  test("Aktivna stavka u Sidebar-u ima aria-current=page", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    const nav = page.getByRole("navigation", { name: "Glavna navigacija" })
    const active = nav.getByRole("link", { name: "Plan aktivnosti", exact: true })
    await expect(active).toHaveAttribute("aria-current", "page")
  })

  test("Plan aktivnosti page render-uje naslov", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await expect(page.getByRole("heading", { name: "Plan aktivnosti" })).toBeVisible()
  })

  test("Desktop-only gate VIDLJIV na 1023px", async ({ page }) => {
    await page.setViewportSize({ width: 1023, height: 800 })
    await page.goto("/termini")
    await expect(page.getByText(`${brand} je optimizovan za desktop`)).toBeVisible()
    await expect(page.getByText("ekran minimalno 1024px širine")).toBeVisible()
    // Glavna aplikacija sakrivena
    await expect(page.getByRole("navigation", { name: "Glavna navigacija" })).toBeHidden()
  })

  test("Desktop-only gate SAKRIVEN na 1024px", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto("/termini")
    await expect(page.getByText(`${brand} je optimizovan za desktop`)).toBeHidden()
    // Aplikacija vidljiva
    await expect(page.getByRole("navigation", { name: "Glavna navigacija" })).toBeVisible()
  })

  test("Bez console grešaka na load", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    await page.goto("/termini")
    await page.waitForLoadState("networkidle")
    expect(errors, errors.join("\n")).toHaveLength(0)
  })
})
