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

  it("PostgreSQL udvajanje ('') se tretira kao JEDAN string, ne kao kraj+početak", () => {
    // "it''s" = apostrof unutar stringa bježan udvajanjem — cijeli izraz je JEDAN
    // string literal, a ne "it" (string) + "s" (kod).
    const ulaz = "select 'it''s a test', create_table_marker;"
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).not.toContain("it")
    expect(izlaz).not.toContain("test")
    // Ostatak izraza (van navodnika) mora ostati netaknut.
    expect(izlaz).toContain("create_table_marker;")
  })

  it("ne koristi JS-stil \\' escape — obrnuta kosa crta u stringu ne produžuje literal", () => {
    // U PostgreSQL-u (standard_conforming_strings=on) `\` NIJE escape karakter unutar
    // stringa — `'a\'` je zatvoren string 'a\' praćen sa još jednim otvorenim/zatvorenim
    // navodnikom. Provjeravamo da regex ne "pobjegne" preko granice naredbe.
    const ulaz = String.raw`select 'a\', real_code;`
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).toContain("real_code;")
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

  it("brojevi linija se NE pomjeraju poslije maskiranja", () => {
    const ulaz = [
      "-- prvi komentar",
      "create table a (id int);",
      "select 'neka duga string vrijednost preko cijelog reda';",
      "create table b (id int);",
    ].join("\n")
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz.split("\n")).toHaveLength(ulaz.split("\n").length)
    expect(izlaz.split("\n")[1]).toBe("create table a (id int);")
    expect(izlaz.split("\n")[3]).toBe("create table b (id int);")
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
