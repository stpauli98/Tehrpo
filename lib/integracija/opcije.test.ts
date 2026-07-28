import { describe, it, expect } from "vitest"
import {
  parsirajOpcije,
  filtrirajSqlImena,
  filtrirajMigracijskePutanje,
  parsirajGitStatusPorcelain,
} from "./opcije"

describe("parsirajOpcije", () => {
  it("bez argumenata: podrazumijevana baza, sve=false, bez upozorenja", () => {
    const r = parsirajOpcije([])
    expect(r).toEqual({
      ok: true,
      opcije: { sve: false, baza: "origin/main" },
      upozorenje: null,
    })
  })

  it("--sve postavlja sve=true, baza ostaje podrazumijevana", () => {
    const r = parsirajOpcije(["--sve"])
    expect(r).toEqual({
      ok: true,
      opcije: { sve: true, baza: "origin/main" },
      upozorenje: null,
    })
  })

  it("--baza <ref> postavlja eksplicitnu baznu granu", () => {
    const r = parsirajOpcije(["--baza", "origin/develop"])
    expect(r).toEqual({
      ok: true,
      opcije: { sve: false, baza: "origin/develop" },
      upozorenje: null,
    })
  })

  it("--baza bez vrijednosti (zadnji argument) → ok:false, ne baca izuzetak", () => {
    const r = parsirajOpcije(["--baza"])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.poruka).toMatch(/--baza zahtijeva vrijednost/)
  })

  it("nepoznata zastavica → ok:false sa imenom zastavice u poruci", () => {
    const r = parsirajOpcije(["--all"])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.poruka).toContain("--all")
  })

  it("varijante nepoznatih/pogrešno otkucanih zastavica se NE gutaju tiho", () => {
    for (const pogresna of ["--sv", "--Sve", "--SVE", "--base"]) {
      const r = parsirajOpcije([pogresna])
      expect(r.ok, `"${pogresna}" treba biti odbijeno`).toBe(false)
    }
  })

  it("--sve --baza <ref>: obje vrijednosti se parsiraju, ALI upozorenje kaže da je baza ignorisana", () => {
    const r = parsirajOpcije(["--sve", "--baza", "origin/main"])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.opcije.sve).toBe(true)
      expect(r.upozorenje).not.toBeNull()
      expect(r.upozorenje).toMatch(/ignorisan/)
    }
  })

  it("redoslijed --baza pa --sve daje isto upozorenje", () => {
    const r = parsirajOpcije(["--baza", "x", "--sve"])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.upozorenje).toMatch(/ignorisan/)
  })

  it("bare '--' separator (npr. `pnpm run x -- --sve`, pnpm ga ne skida uvijek) se tiho preskače, NE tretira kao nepoznata zastavica", () => {
    const r = parsirajOpcije(["--", "--sve"])
    expect(r).toEqual({
      ok: true,
      opcije: { sve: true, baza: "origin/main" },
      upozorenje: null,
    })
  })

  it("'--' ne konzumira sljedeći argument kao svoju vrijednost — --baza iza njega i dalje radi", () => {
    const r = parsirajOpcije(["--", "--baza", "origin/develop"])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.opcije.baza).toBe("origin/develop")
  })
})

describe("filtrirajSqlImena", () => {
  it("zadržava samo .sql imena, sortirano", () => {
    expect(
      filtrirajSqlImena(["20260728120000_b.sql", "README.md", "20260726120000_a.sql", "archive"]),
    ).toEqual(["20260726120000_a.sql", "20260728120000_b.sql"])
  })

  it("prazan ulaz daje prazan rezultat", () => {
    expect(filtrirajSqlImena([])).toEqual([])
  })

  it("ne dira imena koja se SLUČAJNO ne završavaju na .sql (npr. poddirektorij)", () => {
    expect(filtrirajSqlImena(["podfolder", "x.sql.bak"])).toEqual([])
  })
})

describe("filtrirajMigracijskePutanje", () => {
  it("zadržava samo supabase/migrations/*.sql", () => {
    expect(
      filtrirajMigracijskePutanje([
        "supabase/migrations/20260728120000_x.sql",
        "app/x.ts",
        "supabase/migrations/README.md",
        "supabase/seed.sql",
      ]),
    ).toEqual(["supabase/migrations/20260728120000_x.sql"])
  })

  it("prazan ulaz daje prazan rezultat", () => {
    expect(filtrirajMigracijskePutanje([])).toEqual([])
  })
})

describe("parsirajGitStatusPorcelain", () => {
  it("prepoznaje untracked (??)", () => {
    expect(parsirajGitStatusPorcelain("?? supabase/migrations/nova.sql")).toEqual([
      "supabase/migrations/nova.sql",
    ])
  })

  it("prepoznaje staged dodavanje (A )", () => {
    expect(parsirajGitStatusPorcelain("A  supabase/migrations/dodano.sql")).toEqual([
      "supabase/migrations/dodano.sql",
    ])
  })

  it("prepoznaje modified, staged i unstaged ( M / M )", () => {
    expect(
      parsirajGitStatusPorcelain(" M supabase/migrations/izmijenjeno.sql\nM  drugi.sql"),
    ).toEqual(["supabase/migrations/izmijenjeno.sql", "drugi.sql"])
  })

  it("izbacuje obrisane fajlove (status sadrži D)", () => {
    expect(parsirajGitStatusPorcelain(" D supabase/migrations/obrisano.sql")).toEqual([])
  })

  it("rename zapis uzima NOVU putanju", () => {
    expect(parsirajGitStatusPorcelain("R  stara.sql -> supabase/migrations/nova.sql")).toEqual([
      "supabase/migrations/nova.sql",
    ])
  })

  it("prazan izlaz daje prazan rezultat", () => {
    expect(parsirajGitStatusPorcelain("")).toEqual([])
  })

  it("više linija odjednom, izmiješano", () => {
    expect(
      parsirajGitStatusPorcelain(
        [
          "?? supabase/migrations/a.sql",
          " M supabase/migrations/b.sql",
          " D supabase/migrations/c.sql",
          "M  package.json",
        ].join("\n"),
      ),
    ).toEqual(["supabase/migrations/a.sql", "supabase/migrations/b.sql", "package.json"])
  })
})
