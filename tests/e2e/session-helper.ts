// tests/e2e/session-helper.ts
// Reusable: log a given user in via Supabase REST and inject the @supabase/ssr
// session cookie into a Playwright context (same fast-path pattern as auth.setup.ts).
// Used by specs that need a NON-admin session (e.g. operater RLS isolation).
import { readFileSync } from "node:fs"
import type { BrowserContext } from "@playwright/test"

function fromFile(file: string, key: string): string {
  let content = ""
  try {
    content = readFileSync(file, "utf8")
  } catch {
    return ""
  }
  const line = content.split("\n").find((l) => l.trimStart().startsWith(`${key}=`))
  return line ? line.slice(line.indexOf("=") + 1).trim() : ""
}

// Ista precedenca kao db.ts/Next dev/auth.setup: process.env > .env.development.local > .env.local.
// KRITIČNO: dev server (app pod testom) radi protiv .env.development.local (DEMO projekt). Ovaj
// helper MORA logovati se protiv ISTOG projekta — inače "Supabase login failed" (nalog kreiran
// na DEMO preko db.ts, ali login pokušan na PROD preko ovog helpera).
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
if (!SUPABASE_URL) throw new Error("session-helper: nedostaje NEXT_PUBLIC_SUPABASE_URL")
if (!SUPABASE_ANON_KEY) throw new Error("session-helper: nedostaje NEXT_PUBLIC_SUPABASE_ANON_KEY")

const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0]
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`

/** Log `email`/`password` in via Supabase REST and inject the auth cookie into `context`. */
export async function injectSessionFor(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    throw new Error(`Supabase login failed za ${email}: ${res.status} ${await res.text()}`)
  }
  const session = (await res.json()) as Record<string, unknown>
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url")
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value,
      domain: "localhost",
      path: "/",
      sameSite: "Lax",
      httpOnly: false,
      expires: Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60,
    },
  ])
}
