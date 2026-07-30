import { defineConfig, devices } from "@playwright/test"

// Port je podesiv preko env-a: paralelni git worktree-ovi bi inače tiho dijelili
// isti port 3000, a `reuseExistingServer` bi ovaj Playwright prolaz zakačio na tuđi
// (drugi granin) `next dev` i testirao pogrešnu granu bez ikakve greške. Podrazumijevano
// ostaje 3000 (nepromijenjeno ponašanje) ako niko ne postavi E2E_PORT.
const E2E_PORT = process.env.E2E_PORT ?? "3000"

export default defineConfig({
  testDir: "./tests/e2e",
  // Odbija pokretanje ako cilj nije DEMO. Vidi tests/e2e/global-setup.ts —
  // postoji zbog incidenta u kojem je cijeli E2E prolaz otišao na produkciju.
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  // Auth gate (proxy) + RLS dodaju ~150-250ms po zahtjevu; podigni expect timeout
  // da latencijom-osjetljive provjere (toBeHidden/toContainText) ne flake-uju, naročito webkit.
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    // Browser kontekst deterministički u standardnoj zoni aplikacije (APP_TIME_ZONE
    // u lib/date.ts) — testovi ne smiju zavisiti od zone mašine na kojoj se vrte.
    timezoneId: "Europe/Belgrade",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: "tests/e2e/.auth/admin.json" },
      dependencies: ["setup"],
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, storageState: "tests/e2e/.auth/admin.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // --webpack je OBAVEZAN: Turbopack u ovom okruženju puca s
    // "Next.js package not found" (get_next_server_import_map) — uzrok je razmak
    // u putanji projekta ("Ai Forward"). Reprodukovano live (panic log) i pod
    // paralelnim Playwright workerima. Webpack to korektno hendla. Ne vraćaj na
    // Turbopack dok je putanja s razmakom (ili premjesti projekat u putanju bez razmaka).
    command: `next dev -p ${E2E_PORT} --webpack`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ZAPISNIK_DRY_RUN: "1", CHAT_DRY_RUN: "1" },
  },
})
