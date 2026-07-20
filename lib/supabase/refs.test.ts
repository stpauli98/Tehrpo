import { describe, it, expect } from "vitest"
import { prepoznajCilj, zahtijevajCilj, PROD_REF, DEMO_REF } from "./refs"

const PROD_PG = `postgresql://postgres.${PROD_REF}:tajna@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
const DEMO_PG = `postgresql://postgres.${DEMO_REF}:tajna@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
const PROD_URL = `https://${PROD_REF}.supabase.co`
const DEMO_URL = `https://${DEMO_REF}.supabase.co`

describe("prepoznajCilj", () => {
  it("prepoznaje PROD i iz connection stringa i iz Supabase URL-a", () => {
    expect(prepoznajCilj(PROD_PG)).toBe("prod")
    expect(prepoznajCilj(PROD_URL)).toBe("prod")
  })

  it("prepoznaje DEMO i iz connection stringa i iz Supabase URL-a", () => {
    expect(prepoznajCilj(DEMO_PG)).toBe("demo")
    expect(prepoznajCilj(DEMO_URL)).toBe("demo")
  })

  it("nepoznato za prazno, null, undefined i lokalni stack", () => {
    expect(prepoznajCilj("")).toBe("nepoznato")
    expect(prepoznajCilj(null)).toBe("nepoznato")
    expect(prepoznajCilj(undefined)).toBe("nepoznato")
    expect(prepoznajCilj("postgresql://postgres:postgres@127.0.0.1:54322/postgres")).toBe("nepoznato")
  })

  it("ne miješa dva ref-a", () => {
    expect(prepoznajCilj(PROD_PG)).not.toBe("demo")
    expect(prepoznajCilj(DEMO_PG)).not.toBe("prod")
  })
})

describe("zahtijevajCilj", () => {
  it("prolazi kad se cilj poklapa", () => {
    expect(() => zahtijevajCilj(DEMO_PG, "demo", "test")).not.toThrow()
    expect(() => zahtijevajCilj(PROD_PG, "prod", "test")).not.toThrow()
  })

  it("baca kad se traži DEMO a URL je PROD, i imenuje stvarni cilj", () => {
    expect(() => zahtijevajCilj(PROD_PG, "demo", "E2E")).toThrow(/E2E.*DEMO.*PROD/)
  })

  it("baca kad se traži PROD a URL je DEMO", () => {
    expect(() => zahtijevajCilj(DEMO_PG, "prod", "migracija")).toThrow(/migracija.*PROD.*DEMO/)
  })

  it("baca kad URL ne sadrži nijedan poznati ref — tišina nije prolaz", () => {
    expect(() => zahtijevajCilj("", "demo", "E2E")).toThrow(/nijedan poznati ref/)
    expect(() => zahtijevajCilj(undefined, "prod", "migracija")).toThrow(/nijedan poznati ref/)
    expect(() => zahtijevajCilj("postgresql://localhost:5432/x", "prod", "migracija")).toThrow(/nijedan poznati ref/)
  })
})
