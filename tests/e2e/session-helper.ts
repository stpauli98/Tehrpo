// tests/e2e/session-helper.ts
// Reusable: log a given user in via Supabase REST and inject the @supabase/ssr
// session cookie into a Playwright context (same fast-path pattern as auth.setup.ts).
// Used by specs that need a NON-admin session (e.g. operater RLS isolation).
import { readFileSync } from "node:fs"
import type { BrowserContext } from "@playwright/test"

function envVar(key: string): string {
  if (process.env[key]) return process.env[key] as string
  let content = ""
  try {
    content = readFileSync(".env.local", "utf8")
  } catch {
    return ""
  }
  const line = content.split("\n").find((l) => l.trimStart().startsWith(`${key}=`))
  return line ? line.slice(line.indexOf("=") + 1).trim() : ""
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
