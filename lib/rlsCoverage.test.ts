import { describe, it, expect } from "vitest"
import { rlsCoverageViolations, type TableRow, type PolicyRow } from "./rlsCoverage"

const P = (table: string): PolicyRow => ({ schema: "public", table })
const T = (table: string, rlsEnabled: boolean): TableRow => ({ schema: "public", table, rlsEnabled })

describe("rlsCoverageViolations", () => {
  it("nema prekršaja kad je RLS uključen + ima politiku", () => {
    expect(rlsCoverageViolations([T("klijenti", true)], [P("klijenti")], [])).toEqual([])
  })

  it("prijavljuje RLS isključen", () => {
    expect(rlsCoverageViolations([T("klijenti", false)], [P("klijenti")], [])).toEqual([
      { table: "klijenti", kind: "rls_disabled" },
    ])
  })

  it("prijavljuje RLS-enabled bez politike", () => {
    expect(rlsCoverageViolations([T("nova_tabela", true)], [], [])).toEqual([
      { table: "nova_tabela", kind: "no_policy" },
    ])
  })

  it("allowlist gasi 'no_policy' za namjerno deny-all tabele", () => {
    expect(
      rlsCoverageViolations([T("termin_zakazano_obavijest", true)], [], ["termin_zakazano_obavijest"]),
    ).toEqual([])
  })

  it("ignoriše ne-public sheme", () => {
    const tables: TableRow[] = [{ schema: "storage", table: "objects", rlsEnabled: false }]
    expect(rlsCoverageViolations(tables, [], [])).toEqual([])
  })

  it("rls_disabled ima prioritet nad no_policy (jedan prekršaj po tabeli)", () => {
    expect(rlsCoverageViolations([T("x", false)], [], [])).toEqual([{ table: "x", kind: "rls_disabled" }])
  })

  it("hvata više tabela u jednom prolazu", () => {
    const tables = [T("a", true), T("b", false), T("c", true)]
    const policies = [P("a")]
    expect(rlsCoverageViolations(tables, policies, [])).toEqual([
      { table: "b", kind: "rls_disabled" },
      { table: "c", kind: "no_policy" },
    ])
  })
})
