// tests/e2e/auth.setup.ts
//
// Context: real UI login (form /prijava → redirect /pregled) works correctly
// in Next.js 16.2.9 + @supabase/ssr (verified empirically). The original E2E
// redirect loop was caused by a fail-closed proxy signOut path that rejected
// any session where profil.aktivan was null; that bug is now fixed in
// middleware/proxy.ts (`if (profil && profil.aktivan === false)`).
//
// This file uses a REST + cookie-injection approach as a FAST, rate-limit-safe
// storageState fast-path for the non-login specs. It is NOT here because real
// login is broken — it is here so the ~230 downstream specs can share a single
// pre-authenticated state without firing Supabase signIn 230 times.
//
// Encoding note: @supabase/ssr's createServerClient defaults to
// cookieEncoding "base64url". The cookie value format is:
//   "base64-" + base64url( JSON.stringify(session) )
// See node_modules/@supabase/ssr/dist/module/cookies.js: applyServerStorage()

import { readFileSync } from "node:fs"
import { test as setup, expect } from "@playwright/test"

function fromFile(file: string, key: string): string {
  let content = ""
  try {
    content = readFileSync(file, "utf8")
  } catch {
    return ""
  }
  const line = content
    .split("\n")
    .find((l) => l.trimStart().startsWith(`${key}=`))
  return line ? line.slice(line.indexOf("=") + 1).trim() : ""
}

// Ogledaj Next.js dev precedence: process.env > .env.development.local > .env.local.
// Dev server radi protiv baze iz .env.development.local (DEMO), pa auth.setup MORA
// da se prijavi na ISTI projekt — inače cookie (sb-<ref>-auth-token) ne odgovara
// projektu servera i proxy vraća getUser=null → redirect /prijava.
function envVar(key: string): string {
  return (
    process.env[key] ||
    fromFile(".env.development.local", key) ||
    fromFile(".env.local", key) ||
    ""
  )
}

const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL")
const SUPABASE_ANON_KEY = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY")
const ADMIN_EMAIL = envVar("E2E_ADMIN_EMAIL")
const ADMIN_LOZINKA = envVar("E2E_ADMIN_LOZINKA")

if (!SUPABASE_URL) throw new Error("auth.setup: nedostaje NEXT_PUBLIC_SUPABASE_URL")
if (!SUPABASE_ANON_KEY) throw new Error("auth.setup: nedostaje NEXT_PUBLIC_SUPABASE_ANON_KEY")
if (!ADMIN_EMAIL) throw new Error("auth.setup: nedostaje E2E_ADMIN_EMAIL")
if (!ADMIN_LOZINKA) throw new Error("auth.setup: nedostaje E2E_ADMIN_LOZINKA")

// @supabase/supabase-js derives the default storageKey as:
//   `sb-${hostname.split('.')[0]}-auth-token`
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0]
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`

/**
 * Encode a session object into the cookie value that @supabase/ssr produces
 * when cookieEncoding defaults to "base64url" (the default for createServerClient):
 *   "base64-" + base64url( JSON.stringify(session) )
 *
 * See node_modules/@supabase/ssr/dist/module/cookies.js: applyServerStorage()
 * and createServerClient.js line 13: cookieEncoding ?? "base64url".
 */
function encodeSessionCookie(session: Record<string, unknown>): string {
  const json = JSON.stringify(session)
  return "base64-" + Buffer.from(json).toString("base64url")
}

setup("authenticate admin", async ({ page }) => {
  // 1. Get a fresh auth session from Supabase directly — no browser involved.
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_LOZINKA }),
    },
  )

  if (!res.ok) {
    throw new Error(
      `Supabase login failed: ${res.status} ${await res.text()}`,
    )
  }

  const session = (await res.json()) as Record<string, unknown>

  // 2. Inject the auth cookie into the Playwright browser context.
  //    The format must exactly match what @supabase/ssr writes via setAll()
  //    so the proxy's createServerClient can decode it.
  await page.context().addCookies([
    {
      name: COOKIE_NAME,
      value: encodeSessionCookie(session),
      domain: "localhost",
      path: "/",
      sameSite: "Lax",
      httpOnly: false,
      // 400 days — matches @supabase/ssr DEFAULT_COOKIE_OPTIONS.maxAge
      expires: Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60,
    },
  ])

  // 3. Verify the proxy accepts the cookie and lets us into the app.
  //    Allow 30 s for first-hit dev-server compilation of /pregled.
  await page.goto("/pregled")
  await expect(page).toHaveURL("/pregled", { timeout: 30_000 })

  // 4. Persist auth state for all downstream chromium / webkit specs.
  await page.context().storageState({ path: "tests/e2e/.auth/admin.json" })
})
