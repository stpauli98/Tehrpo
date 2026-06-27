import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  // Auth gate (proxy) + RLS dodaju ~150-250ms po zahtjevu; podigni expect timeout
  // da latencijom-osjetljive provjere (toBeHidden/toContainText) ne flake-uju, naročito webkit.
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
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
    command: "next dev -p 3000 --webpack",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ZAPISNIK_DRY_RUN: "1", CHAT_DRY_RUN: "1" },
  },
})
