import { describe, it, expect } from "vitest"
import { provjeriTs, provjeriSql, provjeriIzvore } from "./pravila"
import { PROD_REF } from "@/lib/supabase/refs"

describe("provjeriTs — admin klijent u zahtjevnoj putanji", () => {
  it("prijavlja createAdminSupabaseClient u app/", () => {
    const nalazi = provjeriTs({
      putanja: "app/(dashboard)/klijenti/page.tsx",
      sadrzaj: 'import { createAdminSupabaseClient } from "@/lib/supabase/admin"\n',
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.pravilo).toBe("admin-klijent")
    expect(nalazi[0]!.linija).toBe(1)
  })

  it("prijavlja i u components/", () => {
    expect(
      provjeriTs({
        putanja: "components/domain/Tabela.tsx",
        sadrzaj: '\n\nimport { createAdminSupabaseClient } from "@/lib/supabase/admin"\n',
      }),
    ).toHaveLength(1)
  })

  it("prijavlja tačan broj linije", () => {
    const nalazi = provjeriTs({
      putanja: "app/x.ts",
      sadrzaj: 'const a = 1\nconst b = 2\nimport "@/lib/supabase/admin"\n',
    })
    expect(nalazi[0]!.linija).toBe(3)
  })

  it("NE prijavlja u scripts/ — tamo je admin klijent ispravan", () => {
    expect(
      provjeriTs({
        putanja: "scripts/seed-admin.ts",
        sadrzaj: 'import { createAdminSupabaseClient } from "@/lib/supabase/admin"\n',
      }),
    ).toEqual([])
  })

  it("NE prijavlja app/api/cron — cron rute smiju admin klijent", () => {
    expect(
      provjeriTs({
        putanja: "app/api/cron/reminders/route.ts",
        sadrzaj: 'import { createAdminSupabaseClient } from "@/lib/supabase/admin"\n',
      }),
    ).toEqual([])
  })

  it("NE prijavlja sam lib/supabase/admin.ts", () => {
    expect(
      provjeriTs({ putanja: "lib/supabase/admin.ts", sadrzaj: "createAdminSupabaseClient" }),
    ).toEqual([])
  })
})

describe("provjeriTs — PROD ref u testovima", () => {
  it("prijavlja PROD ref pod tests/", () => {
    const nalazi = provjeriTs({
      putanja: "tests/e2e/db.ts",
      sadrzaj: `const url = "https://${PROD_REF}.supabase.co"\n`,
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.pravilo).toBe("prod-ref-u-testovima")
  })

  it("NE prijavlja PROD ref u lib/supabase/refs.ts — tamo mu je mjesto", () => {
    expect(
      provjeriTs({ putanja: "lib/supabase/refs.ts", sadrzaj: `export const PROD_REF = "${PROD_REF}"` }),
    ).toEqual([])
  })

  it("NE prijavlja čist tests/ fajl", () => {
    expect(provjeriTs({ putanja: "tests/e2e/db.ts", sadrzaj: "const url = process.env.X\n" })).toEqual([])
  })
})

describe("provjeriSql — VIEW bez security_invoker", () => {
  it("prijavlja CREATE VIEW bez security_invoker", () => {
    const nalazi = provjeriSql({
      putanja: "supabase/migrations/20260728120000_x.sql",
      sadrzaj: "CREATE VIEW klijenti_view AS SELECT * FROM klijenti;\n",
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.pravilo).toBe("view-bez-invokera")
    expect(nalazi[0]!.poruka).toContain("klijenti_view")
  })

  it("NE prijavlja kad je security_invoker postavljen", () => {
    expect(
      provjeriSql({
        putanja: "supabase/migrations/20260728120000_x.sql",
        sadrzaj:
          "CREATE VIEW klijenti_view WITH (security_invoker=on) AS SELECT * FROM klijenti;\n",
      }),
    ).toEqual([])
  })

  it("hvata i CREATE OR REPLACE VIEW", () => {
    expect(
      provjeriSql({
        putanja: "supabase/migrations/20260728120000_x.sql",
        sadrzaj: "CREATE OR REPLACE VIEW t_view AS SELECT 1;\n",
      }),
    ).toHaveLength(1)
  })

  it("ne miješa dvije naredbe — druga ima invoker, prva nema", () => {
    const nalazi = provjeriSql({
      putanja: "supabase/migrations/20260728120000_x.sql",
      sadrzaj:
        "CREATE VIEW a_view AS SELECT 1;\nCREATE VIEW b_view WITH (security_invoker=on) AS SELECT 2;\n",
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.poruka).toContain("a_view")
  })
})

describe("provjeriSql — nova tabela bez politike", () => {
  it("prijavlja CREATE TABLE bez ijedne CREATE POLICY", () => {
    const nalazi = provjeriSql({
      putanja: "supabase/migrations/20260728120000_x.sql",
      sadrzaj: "CREATE TABLE public.gradovi (id serial primary key);\n",
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.pravilo).toBe("tabela-bez-politike")
  })

  it("NE prijavlja kad politika postoji u istom fajlu", () => {
    expect(
      provjeriSql({
        putanja: "supabase/migrations/20260728120000_x.sql",
        sadrzaj:
          "CREATE TABLE public.gradovi (id serial primary key);\n" +
          'CREATE POLICY "citanje" ON public.gradovi FOR SELECT USING (true);\n',
      }),
    ).toEqual([])
  })

  it("NE prijavlja CREATE TABLE IF NOT EXISTS kad politika postoji", () => {
    expect(
      provjeriSql({
        putanja: "supabase/migrations/20260728120000_x.sql",
        sadrzaj:
          "CREATE TABLE IF NOT EXISTS public.gradovi (id int);\n" +
          'CREATE POLICY "p" ON gradovi FOR SELECT USING (true);\n',
      }),
    ).toEqual([])
  })
})

describe("provjeriIzvore", () => {
  it("bira provjeru prema ekstenziji i spaja nalaze", () => {
    const nalazi = provjeriIzvore([
      { putanja: "app/x.ts", sadrzaj: 'import "@/lib/supabase/admin"\n' },
      { putanja: "supabase/migrations/20260728120000_x.sql", sadrzaj: "CREATE VIEW v AS SELECT 1;\n" },
      { putanja: "README.md", sadrzaj: "createAdminSupabaseClient" },
    ])
    expect(nalazi.map((n) => n.pravilo).sort()).toEqual(["admin-klijent", "view-bez-invokera"])
  })

  it("nalazi su sortirani po putanji pa po liniji", () => {
    const nalazi = provjeriIzvore([
      { putanja: "app/z.ts", sadrzaj: 'import "@/lib/supabase/admin"\n' },
      { putanja: "app/a.ts", sadrzaj: '\nimport "@/lib/supabase/admin"\n' },
    ])
    expect(nalazi.map((n) => n.putanja)).toEqual(["app/a.ts", "app/z.ts"])
  })

  it("prazan ulaz daje prazan rezultat", () => {
    expect(provjeriIzvore([])).toEqual([])
  })
})
