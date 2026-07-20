import { existsSync, readFileSync } from "node:fs"

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

/**
 * Ista precedenca kao Next dev i auth.setup: process.env > .env.development.local > .env.local.
 *
 * KRITIČNO: dev server (app pod testom) radi protiv .env.development.local (DEMO projekt).
 * Testovi MORAJU pisati u ISTI projekt — inače test podaci odu u drugi projekt (PROD),
 * app ih ne vidi (sheet se ne otvori, brojači krivi), i zagađuje se PROD baza.
 */
export function envVar(key: string): string {
  return (
    process.env[key] ||
    fromFile(".env.development.local", key) ||
    fromFile(".env.local", key) ||
    ""
  )
}

export const DEMO_ENV_FILE = ".env.development.local"

/** Postoji li DEMO env fajl — bez njega Next dev tiho pada nazad na .env.local (PROD). */
export function demoEnvFilePostoji(): boolean {
  return existsSync(DEMO_ENV_FILE)
}
