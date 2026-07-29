import { describe, it, expect } from "vitest"
import {
  parsirajOpcije,
  filtrirajSqlImena,
  filtrirajMigracijskePutanje,
  parsirajGitDiffNameOnly,
  parsirajGitStatusPorcelainZ,
  spojiPutanje,
  zadrziPostojeceMigracije,
  normalizujPutanju,
  jeTsIzvor,
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

  it("prefiks mora biti na POČETKU putanje — `docs/supabase/migrations/x.sql` nije migracija", () => {
    // Prijašnji test je prolazio i kod mutanta `startsWith` → `includes`, jer nijedan
    // ulaz nije imao prefiks na sredini putanje. Ovaj ulaz razlikuje te dvije
    // implementacije: `includes` bi ga (pogrešno) uvrstio u obuhvat migracija.
    expect(
      filtrirajMigracijskePutanje([
        "docs/supabase/migrations/x.sql",
        "vendor/supabase/migrations/y.sql",
        "supabase/migrations/z.sql",
      ]),
    ).toEqual(["supabase/migrations/z.sql"])
  })
})

describe("zadrziPostojeceMigracije", () => {
  it("izbacuje putanju koje NEMA na disku, zadržava onu koje ima", () => {
    // Scenario `git mv`: `git diff <baza>...HEAD` i dalje vraća STARO ime (HEAD ga ima),
    // a na disku je samo NOVO — bez ovog presjeka ljuska bi čitala stari put i pukla sa
    // ENOENT, prekinuvši cijelu provjeru (i pojevši već prijavljene nalaze).
    expect(
      zadrziPostojeceMigracije(
        ["supabase/migrations/20260728990040_prije.sql", "supabase/migrations/20260728990041_poslije.sql"],
        ["20260728990041_poslije.sql"],
      ),
    ).toEqual(["supabase/migrations/20260728990041_poslije.sql"])
  })

  it("scenario `rm`/`git rm`: nijedno ime nije na disku → prazan obuhvat, ne pad", () => {
    expect(
      zadrziPostojeceMigracije(["supabase/migrations/20260728990040_prije.sql"], [
        "20260620200023_foundation_tables.sql",
      ]),
    ).toEqual([])
  })

  it("sve putanje postoje → lista ostaje netaknuta, u istom redoslijedu", () => {
    // Mutant "uvijek vrati []" pada ovdje; mutant "uvijek vrati ulaz" pada na prva dva
    // testa — nijedna trivijalna implementacija ne prolazi sva tri.
    const putanje = ["supabase/migrations/a.sql", "supabase/migrations/b.sql"]
    expect(zadrziPostojeceMigracije(putanje, ["b.sql", "a.sql", "README.md"])).toEqual(putanje)
  })

  it("poklapanje je po CIJELOJ putanji, ne po sufiksu — istoimeni fajl van migracija ne prolazi", () => {
    expect(
      zadrziPostojeceMigracije(["docs/a.sql", "supabase/migrations/a.sql"], ["a.sql"]),
    ).toEqual(["supabase/migrations/a.sql"])
  })

  it("prazan spisak imena (npr. direktorij ne postoji) → prazan obuhvat", () => {
    expect(zadrziPostojeceMigracije(["supabase/migrations/a.sql"], [])).toEqual([])
  })

  it("dijakritika u imenu se poklapa doslovno (-z izlaz je sirov UTF-8, kao i readdir)", () => {
    expect(
      zadrziPostojeceMigracije(
        ["supabase/migrations/20260728990031_čšćžđ.sql", "supabase/migrations/nepostoji.sql"],
        ["20260728990031_čšćžđ.sql"],
      ),
    ).toEqual(["supabase/migrations/20260728990031_čšćžđ.sql"])
  })
})

describe("parsirajGitDiffNameOnly (git diff --name-only -z)", () => {
  it("parsira više NUL-odvojenih putanja", () => {
    const izlaz = "supabase/migrations/a.sql\0supabase/migrations/b.sql\0"
    expect(parsirajGitDiffNameOnly(izlaz)).toEqual([
      "supabase/migrations/a.sql",
      "supabase/migrations/b.sql",
    ])
  })

  it("prazan izlaz daje prazan rezultat", () => {
    expect(parsirajGitDiffNameOnly("")).toEqual([])
  })

  it("ne-ASCII (dijakritika) ime prolazi netaknuto — -z nikad ne C-escapuje/navodi (core.quotePath se ne primjenjuje)", () => {
    // Stvarni scenario, ručno potvrđen: bez -z, git diff --name-only bi ovo ime vratio
    // kao `"supabase/migrations/20260728990031_\304\215\305\241\304\207\305\276\304\221.sql"`
    // (C-escaped, u navodnicima) — sa -z dolazi kao sirov UTF-8, bez navodnika/escape-a.
    const izlaz = "supabase/migrations/20260728990031_čšćžđ.sql\0"
    expect(parsirajGitDiffNameOnly(izlaz)).toEqual([
      "supabase/migrations/20260728990031_čšćžđ.sql",
    ])
  })

  it("rename daje JEDNO polje (novi put) — --name-only ne emituje par kao --name-status", () => {
    // Ručno potvrđeno: `git diff --name-only -z` na preimenovanju daje SAMO novu putanju
    // kao jedno NUL-terminated polje — za razliku od `git status --porcelain -z`, koji
    // za rename daje DVA polja (v. parsirajGitStatusPorcelainZ ispod).
    const izlaz = "supabase/migrations/novo-ime.sql\0"
    expect(parsirajGitDiffNameOnly(izlaz)).toEqual(["supabase/migrations/novo-ime.sql"])
  })
})

describe("parsirajGitStatusPorcelainZ (git status --porcelain -z)", () => {
  it("prepoznaje untracked (??)", () => {
    expect(parsirajGitStatusPorcelainZ("?? supabase/migrations/nova.sql\0")).toEqual([
      "supabase/migrations/nova.sql",
    ])
  })

  it("prepoznaje staged dodavanje (A )", () => {
    expect(parsirajGitStatusPorcelainZ("A  supabase/migrations/dodano.sql\0")).toEqual([
      "supabase/migrations/dodano.sql",
    ])
  })

  it("prepoznaje modified, staged i unstaged ( M / M )", () => {
    expect(
      parsirajGitStatusPorcelainZ(" M supabase/migrations/izmijenjeno.sql\0M  drugi.sql\0"),
    ).toEqual(["supabase/migrations/izmijenjeno.sql", "drugi.sql"])
  })

  it("izbacuje obrisane fajlove (status sadrži D)", () => {
    expect(parsirajGitStatusPorcelainZ(" D supabase/migrations/obrisano.sql\0")).toEqual([])
  })

  it("prazan izlaz daje prazan rezultat", () => {
    expect(parsirajGitStatusPorcelainZ("")).toEqual([])
  })

  it("ne-ASCII (dijakritika) untracked ime prolazi netaknuto", () => {
    // Ručno potvrđen scenario iz recenzije: netrackovan fajl sa dijakritikom u imenu.
    expect(
      parsirajGitStatusPorcelainZ("?? supabase/migrations/20260729000000_žščćđ.sql\0"),
    ).toEqual(["supabase/migrations/20260729000000_žščćđ.sql"])
  })

  it("RENAME: -z format je DVA polja (XY noviPut, pa originalniPut) — uzima se NOVI put, staro polje se konzumira", () => {
    // Ručno potvrđeno preko stvarnog `git status --porcelain -z` na `git mv`:
    // "R  novi.sql\0stari.sql\0" — DRUGAČIJE od ne--z oblika ("R  stari -> novi").
    const izlaz = "R  supabase/migrations/novi.sql\0supabase/migrations/stari.sql\0"
    expect(parsirajGitStatusPorcelainZ(izlaz)).toEqual(["supabase/migrations/novi.sql"])
  })

  it("RENAME praćen DRUGIM zapisom — originalni put rename-a se ne pojavljuje kao lažan treći zapis", () => {
    const izlaz =
      "R  supabase/migrations/novi.sql\0" +
      "supabase/migrations/stari.sql\0" +
      "?? supabase/migrations/dodatno.sql\0"
    expect(parsirajGitStatusPorcelainZ(izlaz)).toEqual([
      "supabase/migrations/novi.sql",
      "supabase/migrations/dodatno.sql",
    ])
  })

  it("COPY (C) status ima isti dvopoljni oblik kao rename — originalni put se konzumira", () => {
    const izlaz = "C  supabase/migrations/kopija.sql\0supabase/migrations/original.sql\0"
    expect(parsirajGitStatusPorcelainZ(izlaz)).toEqual(["supabase/migrations/kopija.sql"])
  })

  it("više linija odjednom, izmiješano", () => {
    expect(
      parsirajGitStatusPorcelainZ(
        [
          "?? supabase/migrations/a.sql",
          " M supabase/migrations/b.sql",
          " D supabase/migrations/c.sql",
          "M  package.json",
        ].join("\0") + "\0",
      ),
    ).toEqual(["supabase/migrations/a.sql", "supabase/migrations/b.sql", "package.json"])
  })
})

describe("spojiPutanje", () => {
  it("dedupuje isti fajl kad je i commitovan i izmijenjen (u obje liste)", () => {
    expect(
      spojiPutanje(
        ["supabase/migrations/a.sql", "supabase/migrations/b.sql"],
        ["supabase/migrations/b.sql", "supabase/migrations/c.sql"],
      ),
    ).toEqual(["supabase/migrations/a.sql", "supabase/migrations/b.sql", "supabase/migrations/c.sql"])
  })

  it("sortira rezultat bez obzira na ulazni redoslijed", () => {
    expect(spojiPutanje(["z.sql"], ["a.sql"])).toEqual(["a.sql", "z.sql"])
  })

  it("obje prazne liste daju prazan rezultat", () => {
    expect(spojiPutanje([], [])).toEqual([])
  })

  it("jedna prazna, druga sa duplikatima unutar sebe — i dalje dedupovano", () => {
    expect(spojiPutanje([], ["x.sql", "x.sql"])).toEqual(["x.sql"])
  })
})

describe("normalizujPutanju", () => {
  it("pretvara Windows \\ separatore u /", () => {
    expect(normalizujPutanju("app\\klijenti\\page.tsx")).toBe("app/klijenti/page.tsx")
  })

  it("putanja bez \\ ostaje netaknuta", () => {
    expect(normalizujPutanju("app/klijenti/page.tsx")).toBe("app/klijenti/page.tsx")
  })
})

describe("jeTsIzvor", () => {
  it("prepoznaje .ts i .tsx", () => {
    expect(jeTsIzvor("route.ts")).toBe(true)
    expect(jeTsIzvor("page.tsx")).toBe(true)
  })

  it("odbija ostale ekstenzije", () => {
    expect(jeTsIzvor("README.md")).toBe(false)
    expect(jeTsIzvor("styles.css")).toBe(false)
  })

  it("SIDRO NA KRAJU: `.ts`/`.tsx` mora biti KRAJ imena, ne bilo gdje u njemu", () => {
    // Bez `$` u regexu (`/\.tsx?/`) sva tri imena bi ušla u obuhvat i bila pročitana
    // kao TS izvor — `.tsv` je tabelarni podatak, `.ts.snap` vitest snapshot, a
    // `.tsbuildinfo` keš TypeScript kompajlera (može biti megabajtima velik).
    expect(jeTsIzvor("izvoz.tsv")).toBe(false)
    expect(jeTsIzvor("snapshot.ts.snap")).toBe(false)
    expect(jeTsIzvor("tsconfig.tsbuildinfo")).toBe(false)
  })

  it("tačka prije ekstenzije je obavezna — `.ts` ne smije pogoditi ime bez tačke", () => {
    expect(jeTsIzvor("skripts")).toBe(false)
    expect(jeTsIzvor("robots")).toBe(false)
  })
})
