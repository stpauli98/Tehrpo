import { test, expect } from "@playwright/test"

test.describe("Faza 1 smoke", () => {
  test("root redirects to /pregled", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL("/pregled")
  })

  test("TopBar prikazuje Tehpro brand", async ({ page }) => {
    await page.goto("/termini")
    await expect(page.getByRole("banner")).toContainText("Tehpro")
    await expect(page.getByRole("banner")).toContainText("Sistem za termine i provjere")
  })

  test("Sidebar prikazuje svih 7 nav stavki", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    const nav = page.getByRole("navigation", { name: "Glavna navigacija" })
    await expect(nav.getByRole("link", { name: "Pregled" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Plan aktivnosti" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Obilasci" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Klijenti" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Asistent" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Zapisnici" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Postavke" })).toBeVisible()
    await expect(nav.getByRole("link")).toHaveCount(7)
  })

  test("Aktivna stavka u Sidebar-u ima aria-current=page", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    const active = page.getByRole("link", { name: "Plan aktivnosti" })
    await expect(active).toHaveAttribute("aria-current", "page")
  })

  test("Plan aktivnosti page render-uje naslov", async ({ page }) => {
    await page.goto("/plan-aktivnosti")
    await expect(page.getByRole("heading", { name: "Plan aktivnosti" })).toBeVisible()
  })

  test("Desktop-only gate VIDLJIV na 1023px", async ({ page }) => {
    await page.setViewportSize({ width: 1023, height: 800 })
    await page.goto("/termini")
    await expect(page.getByText("Tehpro je optimizovan za desktop")).toBeVisible()
    await expect(page.getByText("ekran minimalno 1024px širine")).toBeVisible()
    // Glavna aplikacija sakrivena
    await expect(page.getByRole("navigation", { name: "Glavna navigacija" })).toBeHidden()
  })

  test("Desktop-only gate SAKRIVEN na 1024px", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto("/termini")
    await expect(page.getByText("Tehpro je optimizovan za desktop")).toBeHidden()
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
