import { describe, it, expect } from "vitest"
import { definerSearchPathViolations, type FunctionRow } from "./definerSearchPath"

const F = (name: string, config: string[] | null, schema = "public"): FunctionRow => ({
  schema,
  name,
  args: "",
  config,
})

describe("definerSearchPathViolations", () => {
  it("nema prekršaja kad je pg_temp naveden", () => {
    expect(definerSearchPathViolations([F("je_admin", ["search_path=public, pg_temp"])], [])).toEqual([])
  })

  it("prijavljuje search_path bez pg_temp — to je bila rupa", () => {
    expect(definerSearchPathViolations([F("je_admin", ["search_path=public"])], [])).toEqual([
      { fn: "je_admin()", kind: "pg_temp_nije_naveden" },
    ])
  })

  it("prijavljuje potpuno odsutan search_path", () => {
    expect(definerSearchPathViolations([F("nova_fn", null)], [])).toEqual([
      { fn: "nova_fn()", kind: "nema_search_path" },
    ])
  })

  it("prijavljuje i kad proconfig ima druge stavke ali ne search_path", () => {
    expect(definerSearchPathViolations([F("nova_fn", ["statement_timeout=5s"])], [])).toEqual([
      { fn: "nova_fn()", kind: "nema_search_path" },
    ])
  })

  it("pg_temp na bilo kojoj poziciji se prihvata — bitno je da je EKSPLICITAN", () => {
    // Implicitni pg_temp ide prvi; čim je naveden, važi navedena pozicija.
    expect(definerSearchPathViolations([F("f", ["search_path=pg_temp, public"])], [])).toEqual([])
  })

  it("ne nasjeda na podstring — pg_temp_3 nije pg_temp", () => {
    expect(definerSearchPathViolations([F("f", ["search_path=public, pg_temp_3"])], [])).toEqual([
      { fn: "f()", kind: "pg_temp_nije_naveden" },
    ])
  })

  it("podnosi navodnike oko imena šeme", () => {
    expect(definerSearchPathViolations([F("f", ['search_path="public", "pg_temp"'])], [])).toEqual([])
  })

  it("allowlist gasi prijavu", () => {
    expect(
      definerSearchPathViolations([F("rls_auto_enable", ["search_path=pg_catalog"])], ["rls_auto_enable"]),
    ).toEqual([])
  })

  it("ignoriše ne-public sheme", () => {
    expect(definerSearchPathViolations([F("f", ["search_path=public"], "storage")], [])).toEqual([])
  })

  it("hvata više funkcija u jednom prolazu", () => {
    const fns = [
      F("ok", ["search_path=public, pg_temp"]),
      F("loša", ["search_path=public"]),
      F("gora", null),
    ]
    expect(definerSearchPathViolations(fns, [])).toEqual([
      { fn: "loša()", kind: "pg_temp_nije_naveden" },
      { fn: "gora()", kind: "nema_search_path" },
    ])
  })
})
