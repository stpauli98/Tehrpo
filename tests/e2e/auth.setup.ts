// tests/e2e/auth.setup.ts
//
// Root cause (Next.js 16 + @supabase/ssr): when signInWithPassword() is
// called inside a Server Action and redirect() throws immediately after,
// Next.js catches the NEXT_REDIRECT error in action-handler.js. That path
// never calls appendMutableCookies(), so the Set-Cookie headers for the auth
// session are NOT sent to the browser. The browser navigates to /pregled
// without cookies, the proxy's getUser() returns null, and the setup test
// fails with a redirect loop back to /prijava.
//
// Fix: call the Supabase REST API directly from the Playwright Node.js
// process, encode the session in the exact cookie format @supabase/ssr
// expects (base64url), inject it into the browser context, then verify that
// /pregled is reachable before saving storageState.  This is the standard
// E2E pattern for auth bypass and avoids the broken Server-Action cookie
// propagation path entirely.

import { test as setup, expect } from "@playwright/test"

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://fqtqkehjidkzeasiegnq.supabase.co"
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_I8GNrBXowDijr2IjlcYi8A_MTG6Su18"
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@tehpro.test"
const ADMIN_LOZINKA =
  process.env.E2E_ADMIN_LOZINKA ?? "9YcluZJpmTYPpIwhQfc4Aa1!"

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
