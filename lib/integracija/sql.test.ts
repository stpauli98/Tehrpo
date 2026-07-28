import { describe, it, expect } from "vitest"
import { maskiraj, sanitizujSql, filtrirajNamjernePolicyless } from "./sql"
import type { Nalaz } from "./pravila"

describe("maskiraj", () => {
  it("zamjenjuje sve karaktere razmakom, čuvajući dužinu", () => {
    expect(maskiraj("abc")).toBe("   ")
  })

  it("čuva nove redove nepromijenjene", () => {
    expect(maskiraj("ab\ncd")).toBe("  \n  ")
  })
})

describe("sanitizujSql", () => {
  it("maskira linijski komentar do kraja reda", () => {
    const ulaz = "select 1; -- napomena\nselect 2;"
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).not.toContain("napomena")
    expect(izlaz).toBe("select 1;            \nselect 2;")
  })

  it("maskira apostrof UNUTAR -- komentara (ne curi u sljedeći string-pass)", () => {
    // Apostrof unutar komentara ne smije "otvoriti" string koji bi progutao stvarni
    // DDL na idućem redu — komentar se maskira PRIJE nego što regex za stringove
    // uopšte vidi taj apostrof.
    const ulaz = "-- korisnik je rekao 'nema šanse' da uradi ovo\ncreate table x (id int);"
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).not.toContain("korisnik")
    expect(izlaz).not.toContain("nema šanse")
    expect(izlaz).toContain("create table x (id int);")
  })

  it("maskira sadržaj jednostrukih navodnika", () => {
    const ulaz = "select 'tajna vrijednost';"
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).not.toContain("tajna vrijednost")
  })

  it("PostgreSQL udvajanje ('') se tretira kao JEDAN string, ne kao kraj+početak (dokumentaciona provjera)", () => {
    // "it''s" = apostrof unutar stringa bježan udvajanjem — cijeli izraz je JEDAN
    // string literal, a ne "it" (string) + "s" (kod).
    //
    // POŠTENA NAPOMENA (v. diskriminatorski describe blok ispod): ovaj test NE
    // razlikuje sanitizujSql od naivne verzije (/'[^']*'/, bez '' svijesti) — za bilo
    // koji dobro formiran SQL, udvojeni navodnik su UVIJEK dva SUSJEDNA karaktera bez
    // ičega između, pa naivna verzija "zatvori pa odmah ponovo otvori" fragmentiše
    // isti raspon na dva poklapanja koja se nadovezuju BEZ praznine — ukupan maskiran
    // raspon (jedino što je javno vidljivo kroz sanitizujSql) je matematički
    // IDENTIČAN bez obzira da li se '' prepoznaje kao escape ili ne. Ovaj test
    // dokumentuje očekivano ponašanje; test koji STVARNO dokazuje da je novi regex
    // bolji od naivnog je "DISKRIMINATOR: \\ prije zatvarajućeg navodnika" ispod.
    const ulaz = "select 'it''s a test', create_table_marker;"
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).not.toContain("it")
    expect(izlaz).not.toContain("test")
    // Ostatak izraza (van navodnika) mora ostati netaknut.
    expect(izlaz).toContain("create_table_marker;")
  })

  it("uklanja poznati lažni pogodak: 'CREATE TABLE AS' unutar string literala", () => {
    const ulaz = `where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')`
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).not.toMatch(/CREATE\s+TABLE\s+AS/i)
  })

  it("uklanja poznati lažni pogodak: 'create table if not exists' unutar komentara", () => {
    const ulaz =
      "-- Idempotentno (create table if not exists / drop policy if exists / on conflict do nothing)\ncreate table if not exists gradovi (naziv text primary key);"
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).not.toMatch(/create\s+table\s+if\s+not\s+exists\s+\/ /i)
    expect(izlaz).toContain("create table if not exists gradovi (naziv text primary key);")
  })

  it("ne dira sadržaj dollar-quoted ($$...$$) tijela funkcija van navodnika", () => {
    const ulaz = [
      "create or replace function f() returns void language plpgsql as $function$",
      "begin",
      "  create policy p on t for select using (true);",
      "end;",
      "$function$;",
    ].join("\n")
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).toContain("create policy p on t for select using (true);")
  })

  it("brojevi linija se NE pomjeraju poslije maskiranja — VIŠELINIJSKI string literal", () => {
    // Namjerno višelinijski literal (ne jednolinijski) — string regex koristi [^']
    // koje HVATA \n, pa cijeli literal (3 fizičke linije) postaje JEDNO poklapanje
    // koje sadrži DVA ugniježđena \n karaktera. Ako maskiraj ikad počne brisati \n
    // (umjesto da ih čuva), ovih 5 linija bi se sažalo u 3 — regresija koju bi
    // jednolinijski test SAKRIO (v. diskriminator "slomljenMaskiraj" ispod, koji
    // upravo tu regresiju pravi eksplicitno i pokazuje 5 → 3).
    const ulaz = [
      "create table a (id int);",
      "select 'prvi red",
      "drugi red",
      "treci red';",
      "create table b (id int);",
    ].join("\n")
    const redoviUlaz = ulaz.split("\n")
    const redoviIzlaz = sanitizujSql(ulaz).split("\n")

    expect(redoviIzlaz).toHaveLength(redoviUlaz.length)
    expect(redoviIzlaz[0]).toBe("create table a (id int);")
    expect(redoviIzlaz[4]).toBe("create table b (id int);")
    // Redovi 1-3 (unutar literala) su maskirani — sadržaj nestaje, ALI dužina svakog
    // reda (pa time i raspored linija) je netaknuta.
    for (const i of [1, 2, 3]) {
      expect(redoviIzlaz[i]!.length).toBe(redoviUlaz[i]!.length)
    }
    expect(redoviIzlaz[1]).not.toContain("prvi")
    expect(redoviIzlaz[2]).not.toContain("drugi")
    expect(redoviIzlaz[3]).not.toContain("treci")
  })

  describe("diskriminacija implementacija — dokazuje da testovi GORE stvarno padaju na slomljenim verzijama", () => {
    // Reference implementacije koje NAMJERNO reprodukuju dva poznata kvara, da bismo
    // dokazali da testovi iznad zaista razlikuju sanitizujSql od njih (a ne prolaze
    // slučajno i kod ispravne i kod pokvarene verzije — v. recenzija: "ako test
    // prolazi i sa naivnom verzijom, ne služi ničemu").
    function slomljenMaskiraj(poklapanje: string): string {
      // NE čuva \n — sve postaje razmak, uključujući nove redove unutar poklapanja.
      return " ".repeat(poklapanje.length)
    }
    function slomljenaSanitizacija(sadrzaj: string): string {
      return sadrzaj
        .replace(/--[^\n]*/g, slomljenMaskiraj)
        .replace(/'(?:[^']|'')*'/g, slomljenMaskiraj)
    }
    // Stara verzija iz prve runde: JS-stil `\'` escape umjesto PostgreSQL `''` udvajanja.
    function staraVerzija(sadrzaj: string): string {
      return sadrzaj.replace(/--[^\n]*/g, maskiraj).replace(/'(?:[^'\\]|\\.)*'/g, maskiraj)
    }
    // Potpuno naivna verzija: kraj-na-prvi-navodnik, bez ikakve escape svijesti.
    function naivnaVerzija(sadrzaj: string): string {
      return sadrzaj.replace(/--[^\n]*/g, maskiraj).replace(/'[^']*'/g, maskiraj)
    }

    it("slomljenMaskiraj (briše \\n) DAJE regresiju 5 → 3 linije — potvrđuje da test iznad nešto stvarno provjerava", () => {
      const ulaz = [
        "create table a (id int);",
        "select 'prvi red",
        "drugi red",
        "treci red';",
        "create table b (id int);",
      ].join("\n")
      expect(sanitizujSql(ulaz).split("\n")).toHaveLength(5)
      expect(slomljenaSanitizacija(ulaz).split("\n")).toHaveLength(3)
    })

    it("DISKRIMINATOR: \\ neposredno prije zatvarajućeg navodnika — stara (JS-escape) verzija proguta stvaran DDL, nova i naivna ne", () => {
      // Windows-stil putanja u string literalu (\ neposredno prije zatvarajućeg
      // navodnika), pa DRUGI, nepovezan string kasnije u istom fajlu. PostgreSQL ne
      // bježi navodnik obrnutom kosom crtom, pa se prvi string zatvara na PRVOM
      // stvarnom apostrofu (odmah poslije "put\"). Stara (JS-escape) verzija misli da
      // je "\'" escapovan navodnik, pa nastavlja da čita "unutar stringa" sve do
      // SLJEDEĆEG apostrofa u CIJELOM fajlu — gutajući stvaran DDL
      // ("create table pravi_hit") u međuvremenu.
      const ulaz = String.raw`select 'c:\put\', create table pravi_hit (id int);` + "\nselect 'ok';"

      expect(sanitizujSql(ulaz)).toContain("create table pravi_hit (id int);")
      expect(naivnaVerzija(ulaz)).toContain("create table pravi_hit (id int);")
      expect(staraVerzija(ulaz)).not.toContain("create table pravi_hit (id int);")
    })
  })

  it("stvaran DDL izvan komentara/stringova nije izgubljen", () => {
    const ulaz = [
      "-- napomena",
      "create table klijenti (id uuid primary key);",
      "create policy klijenti_sel on klijenti for select using (true);",
    ].join("\n")
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).toContain("create table klijenti (id uuid primary key);")
    expect(izlaz).toContain("create policy klijenti_sel on klijenti for select using (true);")
  })
})

function nalaz(pravilo: string, poruka: string): Nalaz {
  return { putanja: "x.sql", linija: 1, pravilo, poruka }
}

describe("filtrirajNamjernePolicyless", () => {
  const allowlist = ["termin_zakazano_obavijest", "post_due_obavijesti"]

  it("izbacuje 'tabela-bez-politike' nalaz za tabelu iz allowlist-e", () => {
    const nalazi = [
      nalaz("tabela-bez-politike", "tabela termin_zakazano_obavijest nema RLS politiku — ..."),
    ]
    expect(filtrirajNamjernePolicyless(nalazi, allowlist)).toEqual([])
  })

  it("ne izbacuje 'tabela-bez-politike' nalaz za tabelu VAN allowlist-e", () => {
    const nalazi = [nalaz("tabela-bez-politike", "tabela klijenti nema RLS politiku — ...")]
    expect(filtrirajNamjernePolicyless(nalazi, allowlist)).toEqual(nalazi)
  })

  it("ne izbacuje tabelu sličnog imena koja nije tačno u allowlist-i", () => {
    const nalazi = [
      nalaz(
        "tabela-bez-politike",
        "tabela termin_zakazano_obavijest_v2 nema RLS politiku — ...",
      ),
    ]
    expect(filtrirajNamjernePolicyless(nalazi, allowlist)).toEqual(nalazi)
  })

  it("ne dira nalaze drugih pravila", () => {
    const nalazi = [nalaz("view-bez-invokera", "VIEW x bez security_invoker=on")]
    expect(filtrirajNamjernePolicyless(nalazi, allowlist)).toEqual(nalazi)
  })

  it("prazna lista nalaza daje prazan rezultat", () => {
    expect(filtrirajNamjernePolicyless([], allowlist)).toEqual([])
  })
})
