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

describe("provjeriTs — admin-klijent izuzet markerom integracija-dozvoli", () => {
  it("marker sa razlogom neposredno iznad preskače pogodak", () => {
    expect(
      provjeriTs({
        putanja: "app/api/webhooks/resend/route.ts",
        sadrzaj:
          "// integracija-dozvoli: admin-klijent — webhook ruta nije app request-path\n" +
          'import { createAdminSupabaseClient } from "@/lib/supabase/admin"\n',
      }),
    ).toEqual([])
  })

  it("marker BEZ razloga poslije crte ne vrijedi — pogodak se i dalje prijavljuje", () => {
    const nalazi = provjeriTs({
      putanja: "app/x.ts",
      sadrzaj: "// integracija-dozvoli: admin-klijent —\n" + 'import "@/lib/supabase/admin"\n',
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.pravilo).toBe("admin-klijent")
  })

  it("marker dvije linije iznad, sa praznim redom između, i dalje preskače", () => {
    expect(
      provjeriTs({
        putanja: "app/x.ts",
        sadrzaj:
          "// integracija-dozvoli: admin-klijent — razlog\n" +
          "\n" +
          'import "@/lib/supabase/admin"\n',
      }),
    ).toEqual([])
  })

  it("marker iznad jedne linije ne pokriva nepovezan pogodak niže u fajlu", () => {
    const nalazi = provjeriTs({
      putanja: "app/x.ts",
      sadrzaj:
        "// integracija-dozvoli: admin-klijent — razlog1\n" +
        'import { createAdminSupabaseClient } from "@/lib/supabase/admin"\n' +
        "const x = 1\n" +
        "const y = createAdminSupabaseClient()\n",
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.linija).toBe(4)
  })

  it("marker sa običnom ASCII crticom (-) umjesto em/en crte i dalje preskače", () => {
    expect(
      provjeriTs({
        putanja: "app/x.ts",
        sadrzaj: "// integracija-dozvoli: admin-klijent - razlog\n" + 'import "@/lib/supabase/admin"\n',
      }),
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

  it("NE prijavlja kad je invoker postavljen naknadnom ALTER VIEW naredbom u istom fajlu", () => {
    expect(
      provjeriSql({
        putanja: "supabase/migrations/20260630120000_nacin_izvrsenja.sql",
        sadrzaj:
          "create view termini_view as select 1;\n" +
          "alter view termini_view set (security_invoker = on);\n",
      }),
    ).toEqual([])
  })

  it("CREATE VIEW a_view bez ALTER, uz ALTER VIEW b_view ... security_invoker=on — a_view se i dalje prijavljuje", () => {
    const nalazi = provjeriSql({
      putanja: "supabase/migrations/20260728120000_x.sql",
      sadrzaj:
        "create view a_view as select 1;\n" +
        "alter view b_view set (security_invoker = on);\n",
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.poruka).toContain("a_view")
  })

  it("REGRESIJA: ALTER VIEW x_view bez invokera ne smije pokupiti invoker koji pripada ALTER VIEW y_view iza njega", () => {
    const nalazi = provjeriSql({
      putanja: "supabase/migrations/20260728120000_x.sql",
      sadrzaj:
        "create view x_view as select 1;\n" +
        "alter view x_view set (something_else = true);\n" +
        "alter view y_view set (security_invoker = on);\n",
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.poruka).toContain("x_view")
  })

  it("x_view dobija invoker u DRUGOJ ALTER VIEW naredbi, poslije prve bez invokera — nije nalaz", () => {
    expect(
      provjeriSql({
        putanja: "supabase/migrations/20260728120000_x.sql",
        sadrzaj:
          "create view x_view as select 1;\n" +
          "alter view x_view set (something_else = true);\n" +
          "alter view x_view set (security_invoker = on);\n",
      }),
    ).toEqual([])
  })

  it("prefiks kolizija: ALTER VIEW termini ne pokriva CREATE VIEW termini_view", () => {
    const nalazi = provjeriSql({
      putanja: "supabase/migrations/20260728120000_x.sql",
      sadrzaj:
        "create view termini_view as select 1;\n" +
        "alter view termini set (security_invoker = on);\n",
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.poruka).toContain("termini_view")
  })

  it("prefiks kolizija: ALTER VIEW termini_view ne pokriva CREATE VIEW termini", () => {
    const nalazi = provjeriSql({
      putanja: "supabase/migrations/20260728120000_x.sql",
      sadrzaj:
        "create view termini as select 1;\n" +
        "alter view termini_view set (security_invoker = on);\n",
    })
    expect(nalazi).toHaveLength(1)
    expect(nalazi[0]!.poruka).toContain("termini ")
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
