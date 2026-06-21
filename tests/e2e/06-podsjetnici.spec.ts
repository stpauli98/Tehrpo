import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

// Pročitaj CRON_SECRET iz .env.local apsolutnom putanjom (nezavisno od cwd).
// Dev server (pnpm dev) već koristi istu vrijednost.
function cronSecret(): string {
  const p = path.resolve(process.cwd(), ".env.local")
  const txt = readFileSync(p, "utf8") // baci jasno ako fajl/var fali → znači .env.local nije setovan
  const line = txt.split("\n").find((l) => l.startsWith("CRON_SECRET="))
  const val = line ? line.slice("CRON_SECRET=".length).trim() : ""
  if (!val) throw new Error("CRON_SECRET nije u .env.local — vidi Task 2 Step 3")
  return val
}

test.describe.configure({ mode: "serial" })

test.describe("Faza 6 — Cron endpoint", () => {
  // Svaki browser projekt (chromium/webkit) pokreće ove testove serijski
  // protiv iste baze. Prva iteracija upisuje audit redove; drugi projekt bi
  // ih zatekao i first.sent.length bi bio 0 → lažan fail.
  // Rješenje: before svakog projekta truncate podsjetnici tablice.
  test.beforeAll(() => {
    execSync(
      `docker exec supabase_db_tehpro-mvp psql -U postgres -d postgres -c "truncate podsjetnici;"`,
    )
  })

  test("bez secret-a → 401", async ({ request }) => {
    const res = await request.post("/api/cron/reminders")
    expect(res.status()).toBe(401)
  })

  test("pogrešan secret → 401", async ({ request }) => {
    const res = await request.post("/api/cron/reminders", {
      headers: { Authorization: "Bearer pogresno", "Content-Type": "application/json" },
      data: { dryRun: true },
    })
    expect(res.status()).toBe(401)
  })

  test("dryRun + ispravan secret → 200; šalje (audit) i idempotentan je", async ({ request }) => {
    const secret = cronSecret()
    const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }

    // Prvi run: REMINDER_TO je postavljen → due termini imaju primaoce → sent > 0, audit upisan.
    const first = await (await request.post("/api/cron/reminders", { headers, data: { dryRun: true } })).json()
    expect(Array.isArray(first.sent)).toBe(true)
    expect(Array.isArray(first.skipped)).toBe(true)
    expect(Array.isArray(first.errors)).toBe(true)
    expect(first.sent.length).toBeGreaterThan(0) // dokazuje da recipient pipeline radi (REMINDER_TO setovan)
    expect(first.errors.length).toBe(0)

    // Drugi run: isti due redovi su sad u podsjetnici → RPC anti-join ih isključuje → 0 novih.
    const second = await (await request.post("/api/cron/reminders", { headers, data: { dryRun: true } })).json()
    expect(second.sent.length).toBe(0)
  })
})

test.describe("Faza 6 — Postavke UI", () => {
  test("uređivanje pragova se perzistira", async ({ page }) => {
    await page.goto("/postavke")
    await expect(page.getByTestId("reminder-form")).toBeVisible()
    const input = page.getByTestId("reminder-dana-prije")
    await input.fill("45, 7")
    await page.getByTestId("reminder-submit").click()
    await expect(page.getByTestId("reminder-dana-prije")).toHaveValue(/45/)
    // vrati default
    await input.fill("30, 14, 7, 1")
    await page.getByTestId("reminder-submit").click()
    await expect(page.getByTestId("reminder-dana-prije")).toHaveValue(/30/)
  })

  test("bez console grešaka na /postavke", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/postavke")
    await expect(page.getByTestId("reminder-form")).toBeVisible()
    expect(errors).toHaveLength(0)
  })
})

test.describe("Faza 6 — Per-klijent primaoci", () => {
  test("uređivanje primalaca klijenta se perzistira", async ({ page }) => {
    await page.goto("/klijenti")
    await page.getByTestId("klijent-card").first().click()
    await expect(page).toHaveURL(/\/klijenti\//)

    await page.getByTestId("uredi-klijent-btn").click()
    await expect(page.getByTestId("klijent-edit-sheet")).toBeVisible()
    await page.getByTestId("edit-klijent-primaoci").fill("qa-primalac@example.com")
    await page.getByTestId("edit-klijent-submit").click()
    // Sačekaj da se sheet ZATVORI prije ponovnog otvaranja (base-ui timing + router.refresh).
    await expect(page.getByTestId("klijent-edit-sheet")).toBeHidden({ timeout: 5000 })

    await page.getByTestId("uredi-klijent-btn").click()
    await expect(page.getByTestId("klijent-edit-sheet")).toBeVisible()
    await expect(page.getByTestId("edit-klijent-primaoci")).toHaveValue(/qa-primalac@example.com/)

    // očisti
    await page.getByTestId("edit-klijent-primaoci").fill("")
    await page.getByTestId("edit-klijent-submit").click()
    await expect(page.getByTestId("klijent-edit-sheet")).toBeHidden({ timeout: 5000 })
  })
})
