import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { clearPodsjetnici } from "./db"

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
  // ih zatekao i first.preDue.sent.length bi bio 0 → lažan fail.
  // Rješenje: prije svakog projekta očisti podsjetnici tablicu (cloud DB).
  test.beforeAll(async () => {
    await clearPodsjetnici()
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

    // Odgovor je oblika { preDue, postDue } — ovaj test cilja pre-due krug.
    // Prvi run: REMINDER_TO je postavljen → due termini imaju primaoce → sent > 0, audit upisan.
    const first = await (await request.post("/api/cron/reminders", { headers, data: { dryRun: true } })).json()
    expect(Array.isArray(first.preDue.sent)).toBe(true)
    expect(Array.isArray(first.preDue.skipped)).toBe(true)
    expect(Array.isArray(first.preDue.errors)).toBe(true)
    expect(first.preDue.sent.length).toBeGreaterThan(0) // dokazuje da recipient pipeline radi (REMINDER_TO setovan)
    expect(first.preDue.errors.length).toBe(0)

    // Drugi run: isti due redovi su sad u podsjetnici → RPC anti-join ih isključuje → 0 novih.
    const second = await (await request.post("/api/cron/reminders", { headers, data: { dryRun: true } })).json()
    expect(second.preDue.sent.length).toBe(0)
  })
})

test.describe("Faza 6 — Postavke UI", () => {
  // Sekcije su collapsible (zatvorene po defaultu) → otvori prije interakcije.
  const otvoriPodsjetnike = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: "Email podsjetnici" }).click()

  test("dodavanje/uklanjanje praga se perzistira", async ({ page }) => {
    await page.goto("/postavke")
    await otvoriPodsjetnike(page)
    await expect(page.getByTestId("reminder-form")).toBeVisible()
    // Dodaj custom prag 45 (nije u presetima → ide kroz custom unos)
    await page.getByTestId("reminder-custom-input").fill("45")
    await page.getByTestId("reminder-custom-add").click()
    await expect(page.getByTestId("reminder-chip-45")).toBeVisible()
    await page.getByTestId("reminder-submit").click()
    // Čekaj da se pending dugme vrati na "Spremi" (server action završio).
    await expect(page.getByTestId("reminder-submit")).toHaveText("Spremi")
    // Reload — server se ponovo učitava iz DB → potvrdi perzistenciju.
    await page.reload()
    await otvoriPodsjetnike(page)
    await expect(page.getByTestId("reminder-chip-45")).toBeVisible()
    // Ukloni 45 (cleanup) i potvrdi da nestaje i ostaje uklonjen
    await page.getByTestId("reminder-chip-remove-45").click()
    await expect(page.getByTestId("reminder-chip-45")).toHaveCount(0)
    await page.getByTestId("reminder-submit").click()
    await expect(page.getByTestId("reminder-submit")).toHaveText("Spremi")
    await page.reload()
    await otvoriPodsjetnike(page)
    await expect(page.getByTestId("reminder-chip-45")).toHaveCount(0)
  })

  test("toggle automatskog slanja se perzistira", async ({ page }) => {
    await page.goto("/postavke")
    // Napomena: sekcija je collapsible (zatvorena po defaultu) — otvori je prije
    // interakcije, isto kao ostali testovi u ovom describe bloku.
    await otvoriPodsjetnike(page)
    const toggle = page.getByTestId("podsjetnici-aktivni-toggle")
    await expect(toggle).toBeVisible()
    const prije = await toggle.isChecked()
    await toggle.click()
    await expect(toggle).toBeChecked({ checked: !prije })
    // Server akcija se šalje asinhrono (form.requestSubmit u onChange) — sačekaj da
    // se checkbox vrati iz disabled (pending) stanja prije reload-a, inače reload
    // stigne prije nego se upis završi i pročita staru vrijednost (flaky race).
    await expect(toggle).toBeEnabled()
    await page.reload()
    await otvoriPodsjetnike(page)
    await expect(page.getByTestId("podsjetnici-aktivni-toggle")).toBeChecked({ checked: !prije })
    // vrati na početno stanje da test ne mijenja ponašanje instance
    await page.getByTestId("podsjetnici-aktivni-toggle").click()
    await expect(page.getByTestId("podsjetnici-aktivni-toggle")).toBeChecked({ checked: prije })
    await expect(page.getByTestId("podsjetnici-aktivni-toggle")).toBeEnabled()
  })

  test("bez console grešaka na /postavke", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
    await page.goto("/postavke")
    await otvoriPodsjetnike(page)
    await expect(page.getByTestId("reminder-form")).toBeVisible()
    expect(errors).toHaveLength(0)
  })
})

// "Faza 6 — Per-klijent primaoci" je uklonjen: testirao je jedinstveno tekstualno
// edit-form polje za primaoce, koje je Task 5 zamijenio checklistom primalaca iz
// kontakata firme (klijent-primalac-*). Ta funkcionalnost je sada pokrivena u
// tests/e2e/24-podsjetnici-primaoci.spec.ts.
