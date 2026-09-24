import { describe, it, expect } from "vitest"
import {
  maskiraj,
  sanitizujSql,
  filtrirajNamjernePolicyless,
  filtrirajOznaceneIzuzetke,
} from "./sql"
import { provjeriSql, type Nalaz } from "./pravila"

/** Otvarač/zatvarač SQL blok komentara, sastavljeni u vrijeme izvršavanja — doslovno
 *  napisani u TS izvoru bi zatvorili okolne JSDoc komentare u ovom fajlu. */
const OTV = "/" + "*"
const ZATV = "*" + "/"

describe("maskiraj", () => {
  it("zamjenjuje SVAKI ne-\\n karakter razmakom, ali ČUVA \\n i ukupnu dužinu", () => {
    // Namjerno JEDAN ulaz sa i običnim tekstom i novim redom (ne dva odvojena testa) —
    // tako mutant koji zamijeni razred za "bilo koji karakter UKLJUČUJUĆI \n"
    // ([^\n] → [\s\S]) i mutant koji promijeni zamjenski karakter (" " → "") oba padaju
    // na OVOJ istoj provjeri, umjesto da svaki od dva prethodna testa hvata samo po
    // jednu polovinu. (Mutacija [^\n] → `.` NIJE među njima: u JS-u bez `s` zastavice
    // `.` ionako ne hvata \n, pa je ponašanje identično — raniji komentar je to
    // pogrešno tvrdio.)
    const ulaz = "ab\ncd"
    const izlaz = maskiraj(ulaz)
    expect(izlaz).toBe("  \n  ")
    expect(izlaz).toHaveLength(ulaz.length)
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

  it("NETERMINISAN string literal se maskira do kraja fajla", () => {
    // Odgođeni nalaz iz Task-a 4. PostgreSQL bi ovakav fajl odbio kao grešku, pa je
    // maskiranje do kraja siguran smjer — ali mora biti POTVRĐENO, jer je isti mehanizam
    // (neterminisana konstrukcija guta ostatak fajla) izvor C1 kvara sa $$-om.
    const ulaz = "select 'zaboravljen zatvarač\ncreate table lazna (id int);"
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).not.toContain("create table lazna")
    // Broj linija ostaje isti i kad se maskira sve do kraja.
    expect(izlaz.split("\n")).toHaveLength(2)
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

  describe("blok komentari", () => {
    it("LAŽNO NEGATIVNO: zakomentarisana CREATE POLICY ne smije proći kao stvarna politika", () => {
      const ulaz = [
        `${OTV} privremeno isključeno:`,
        "   create policy p on t for select using (true);",
        ZATV,
        "create table t (id int primary key);",
      ].join("\n")
      const izlaz = sanitizujSql(ulaz)
      expect(izlaz).not.toContain("create policy p on t")
      expect(izlaz).toContain("create table t (id int primary key);")
      // Stvarna posljedica kroz pravilo, ne samo kroz tekst: tabela je bez politike.
      const nalazi = provjeriSql({ putanja: "supabase/migrations/x.sql", sadrzaj: izlaz })
      expect(nalazi).toHaveLength(1)
      expect(nalazi[0]!.pravilo).toBe("tabela-bez-politike")
    })

    it("LAŽNO POZITIVNO: zakomentarisana CREATE TABLE ne smije dati nalaz tabela-bez-politike", () => {
      const ulaz = `${OTV} create table stara (id uuid); ${ZATV}\nselect 1;`
      const izlaz = sanitizujSql(ulaz)
      expect(izlaz).not.toContain("create table stara")
      expect(provjeriSql({ putanja: "supabase/migrations/x.sql", sadrzaj: izlaz })).toEqual([])
    })

    it("LAŽNO POZITIVNO: zakomentarisana CREATE VIEW ne smije dati nalaz view-bez-invokera", () => {
      const ulaz = `${OTV} create view stari_v as select 1; ${ZATV}\nselect 1;`
      const izlaz = sanitizujSql(ulaz)
      expect(izlaz).not.toContain("create view stari_v")
      expect(provjeriSql({ putanja: "supabase/migrations/x.sql", sadrzaj: izlaz })).toEqual([])
    })

    it("višelinijski blok komentar ČUVA broj linija (nalazi ispod njega zadržavaju tačnu liniju)", () => {
      const ulaz = [
        `${OTV} prvi red komentara`,
        "   drugi red",
        `   treci red ${ZATV}`,
        "create table prava (id int primary key);",
      ].join("\n")
      const redoviIzlaz = sanitizujSql(ulaz).split("\n")
      expect(redoviIzlaz).toHaveLength(4)
      expect(redoviIzlaz[3]).toBe("create table prava (id int primary key);")
      // Nalaz mora pokazati na 4. liniju, ne na 2. (što bi bilo da se blok sažme).
      const nalazi = provjeriSql({
        putanja: "supabase/migrations/x.sql",
        sadrzaj: sanitizujSql(ulaz),
      })
      expect(nalazi).toHaveLength(1)
      expect(nalazi[0]!.linija).toBe(4)
    })

    it("blok komentari se UGNJEŽĐUJU (PostgreSQL, za razliku od C) — prvi zatvarač ne završava vanjski", () => {
      // Bez brojača dubine (naivno "do prvog zatvarača") komentar bi se završio poslije
      // `unutrasnji`, pa bi `create table lazna` postala vidljiva — lažno pozitivan
      // nalaz na kodu koji baza nikad neće izvršiti.
      const ulaz =
        `${OTV} vanjski ${OTV} unutrasnji ${ZATV} create table lazna (id int); ${ZATV}\n` +
        "create table prava (id int primary key);"
      const izlaz = sanitizujSql(ulaz)
      expect(izlaz).not.toContain("create table lazna")
      expect(izlaz).toContain("create table prava (id int primary key);")
    })

    it("NETERMINISAN blok komentar se maskira do kraja fajla", () => {
      const ulaz = `${OTV} zaboravljen zatvarač\ncreate table lazna (id int);`
      expect(sanitizujSql(ulaz)).not.toContain("create table lazna")
    })

    it("UKRŠTANJE: `--` UNUTAR bloka nema značenje — zatvarač bloka iza `--` i dalje zatvara", () => {
      // Ovo je slučaj koji lanac `.replace()` (prvo `--`, pa blok) ne može: maskiranje
      // linijskog komentara bi progutalo zatvarač bloka, blok bi ostao "otvoren", pa
      // `create table lazna` iznad njega ne bi bila maskirana — a `create table prava`
      // ispod jeste (ili obrnuto, zavisno od redoslijeda) — u oba slučaja pogrešno.
      const ulaz = [
        `${OTV} napomena`,
        `   create table lazna (id int); -- rep ${ZATV}`,
        "create table prava (id int primary key);",
      ].join("\n")
      const izlaz = sanitizujSql(ulaz)
      expect(izlaz).not.toContain("create table lazna")
      expect(izlaz).toContain("create table prava (id int primary key);")
    })

    it("UKRŠTANJE: apostrof UNUTAR bloka ne otvara string koji bi progutao DDL ispod", () => {
      const ulaz = [
        `${OTV} klijent nije rekao 'da' na ovo ${ZATV}`,
        "create table prava (id int primary key);",
        "select 'ok';",
      ].join("\n")
      const izlaz = sanitizujSql(ulaz)
      expect(izlaz).not.toContain("klijent")
      expect(izlaz).toContain("create table prava (id int primary key);")
    })

    it("UKRŠTANJE: otvarač bloka UNUTAR stringa ne otvara komentar", () => {
      const ulaz = [
        `select 'literal sa ${OTV} unutra';`,
        "create table prava (id int primary key);",
        `select 'drugi ${ZATV} literal';`,
      ].join("\n")
      const izlaz = sanitizujSql(ulaz)
      expect(izlaz).not.toContain("literal sa")
      expect(izlaz).toContain("create table prava (id int primary key);")
    })

    it("UKRŠTANJE: otvarač bloka UNUTAR `--` komentara ne otvara komentar preko sljedećih redova", () => {
      const ulaz = [
        `-- ovo je samo napomena ${OTV}`,
        "create table prava (id int primary key);",
        `-- kraj ${ZATV}`,
      ].join("\n")
      const izlaz = sanitizujSql(ulaz)
      expect(izlaz).not.toContain("napomena")
      expect(izlaz).toContain("create table prava (id int primary key);")
    })
  })

  describe("dollar-quoting ($$...$$, $tag$...$tag$)", () => {
    const MIGRACIJA = "supabase/migrations/20260728120000_x.sql"

    it("C1: apostrof u $$...$$ NE guta ostatak fajla — DDL ispod ostaje vidljiv", () => {
      // Dokazni fajl iz recenzije. Bez svijesti o dollar-quotingu, apostrof u
      // `Petrova'` otvara "string literal" koji nikad ne nalazi zatvarač, pa se SVE
      // ispod njega maskira i fajl prolazi kao čist.
      const ulaz = [
        "comment on table klijenti is $$Petrova' tabela$$;",
        "create table nova_tabela (id int);",
      ].join("\n")
      const izlaz = sanitizujSql(ulaz)
      expect(izlaz).toContain("create table nova_tabela (id int);")
      const nalazi = provjeriSql({ putanja: MIGRACIJA, sadrzaj: izlaz })
      expect(nalazi).toHaveLength(1)
      expect(nalazi[0]!.pravilo).toBe("tabela-bez-politike")
      expect(nalazi[0]!.tabela).toBe("nova_tabela")
    })

    it("C1: fajl SA apostrofom i fajl BEZ njega daju IDENTIČAN skup nalaza", () => {
      // Par iz dokaza: dva fajla se razlikuju u JEDNOM karakteru, a prije popravke su
      // davali 0 naspram 3 nalaza. Poređenje je jače od dvije zasebne tvrdnje — mutant
      // koji ukloni dollar-granu pada baš ovdje.
      const saApostrofom = [
        "comment on table klijenti is $$Petrova' tabela$$;",
        "create table nova_tabela (id int);",
        "create view novi_view as select 1;",
      ].join("\n")
      const bezApostrofa = saApostrofom.replace("Petrova'", "Petrova")
      const nalaziSa = provjeriSql({ putanja: MIGRACIJA, sadrzaj: sanitizujSql(saApostrofom) })
      const nalaziBez = provjeriSql({ putanja: MIGRACIJA, sadrzaj: sanitizujSql(bezApostrofa) })
      expect(nalaziSa).toEqual(nalaziBez)
      expect(nalaziSa).toHaveLength(2)
    })

    it("C1: $x$don't$x$ u plpgsql tijelu ne guta CREATE VIEW ispod", () => {
      const ulaz = [
        "create or replace function f() returns text language plpgsql as $f$",
        "begin",
        "  return $x$don't$x$;",
        "end",
        "$f$;",
        "create view pregled as select 1;",
      ].join("\n")
      const nalazi = provjeriSql({ putanja: MIGRACIJA, sadrzaj: sanitizujSql(ulaz) })
      expect(nalazi).toHaveLength(1)
      expect(nalazi[0]!.pravilo).toBe("view-bez-invokera")
      expect(nalazi[0]!.poruka).toContain("pregled")
    })

    it("zatvarač mora biti ISTI tag — ugniježđeni $b$ ne zatvara vanjski $a$", () => {
      const ulaz = [
        "do $a$ begin",
        "  execute $b$ create table unutrasnja (id int); $b$;",
        "end $a$;",
        "create table vanjska (id int);",
      ].join("\n")
      const izlaz = sanitizujSql(ulaz)
      // Cijelo $a$...$a$ tijelo je maskirano, uključujući ugniježđeni $b$ blok.
      expect(izlaz).not.toContain("create table unutrasnja")
      // A naredba POSLIJE tijela je netaknuta — dokaz da se tijelo zatvorilo na $a$,
      // ne da je progutalo ostatak fajla.
      expect(izlaz).toContain("create table vanjska (id int);")
    })

    it("NETERMINISAN $$ se maskira do kraja fajla", () => {
      const ulaz = "do $$ begin\ncreate table lazna (id int);"
      expect(sanitizujSql(ulaz)).not.toContain("create table lazna")
    })

    it("VIŠELINIJSKO tijelo ČUVA broj linija — nalaz ispod zadržava tačnu liniju", () => {
      const ulaz = [
        "create function f() returns void language plpgsql as $$",
        "begin",
        "  perform 1;",
        "end",
        "$$;",
        "create table prava (id int primary key);",
      ].join("\n")
      const redoviIzlaz = sanitizujSql(ulaz).split("\n")
      expect(redoviIzlaz).toHaveLength(6)
      const nalazi = provjeriSql({ putanja: MIGRACIJA, sadrzaj: sanitizujSql(ulaz) })
      expect(nalazi).toHaveLength(1)
      expect(nalazi[0]!.linija).toBe(6)
    })

    it("UKRŠTANJE: $$ unutar `--` komentara NE otvara tijelo", () => {
      const ulaz = [
        "-- ranije je ovdje bio $$ blok",
        "create table prava (id int primary key);",
        "-- kraj $$",
        "create table druga (id int primary key);",
      ].join("\n")
      const izlaz = sanitizujSql(ulaz)
      expect(izlaz).toContain("create table prava (id int primary key);")
      expect(izlaz).toContain("create table druga (id int primary key);")
    })

    it("UKRŠTANJE: $$ unutar '...' NE otvara tijelo", () => {
      const ulaz = [
        "select 'literal sa $$ unutra';",
        "create table prava (id int primary key);",
        "select 'drugi $$ literal';",
        "create table druga (id int primary key);",
      ].join("\n")
      const izlaz = sanitizujSql(ulaz)
      expect(izlaz).toContain("create table prava (id int primary key);")
      expect(izlaz).toContain("create table druga (id int primary key);")
    })

    it("SVJESTAN KOMPROMIS: prava CREATE POLICY u DO $$ bloku postaje nevidljiva (lažno pozitivan nalaz)", () => {
      // Zapisano u modul-nivo komentaru sql.ts: cijena za to da apostrof u tijelu ne
      // ugasi provjeru je da izvršni DDL UNUTAR tijela više nije vidljiv. Smjer greške
      // je bučan (višak nalaza), ne tih (fajl prolazi kao čist).
      const ulaz = [
        "create table t (id int primary key);",
        "do $$ begin",
        "  create policy p on t for select using (true);",
        "end $$;",
      ].join("\n")
      const nalazi = provjeriSql({ putanja: MIGRACIJA, sadrzaj: sanitizujSql(ulaz) })
      expect(nalazi).toHaveLength(1)
      expect(nalazi[0]!.pravilo).toBe("tabela-bez-politike")
      expect(nalazi[0]!.tabela).toBe("t")
    })

    it("`$1` pozicioni parametar (bez zatvarajućeg $) NE otvara tijelo", () => {
      const ulaz = [
        "prepare p as select * from t where id = $1 and ime = $2;",
        "create table prava (id int primary key);",
      ].join("\n")
      expect(sanitizujSql(ulaz)).toContain("create table prava (id int primary key);")
    })
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

    // Dvije plauzibilne "popravke" za blok komentare koje NE rade: lanac `.replace()`
    // koraka koji ne znaju jedan za drugoga (samo se razlikuju po redoslijedu).
    const BLOK = new RegExp("\\/\\*[\\s\\S]*?\\*\\/", "g")
    function lancanoKomentarPrvi(sadrzaj: string): string {
      return sadrzaj
        .replace(/--[^\n]*/g, maskiraj)
        .replace(BLOK, maskiraj)
        .replace(/'(?:[^']|'')*'/g, maskiraj)
    }
    function lancanoBlokPrvi(sadrzaj: string): string {
      return sadrzaj
        .replace(BLOK, maskiraj)
        .replace(/--[^\n]*/g, maskiraj)
        .replace(/'(?:[^']|'')*'/g, maskiraj)
    }

    it("DISKRIMINATOR: `--` prije zatvarača bloka — lanac (`--` prvi) izgubi zatvarač i ostavi zakomentarisan DDL vidljiv", () => {
      const ulaz = [
        `${OTV} napomena`,
        `   create table lazna (id int); -- rep ${ZATV}`,
        "create table prava (id int primary key);",
      ].join("\n")
      expect(sanitizujSql(ulaz)).not.toContain("create table lazna")
      expect(lancanoKomentarPrvi(ulaz)).toContain("create table lazna")
    })

    it("DISKRIMINATOR: otvarač bloka u stringu — lanac otvori lažan komentar i proguta STVARAN DDL", () => {
      const ulaz = [
        `select 'literal sa ${OTV} unutra';`,
        "create table prava (id int primary key);",
        `select 'drugi ${ZATV} literal';`,
      ].join("\n")
      expect(sanitizujSql(ulaz)).toContain("create table prava (id int primary key);")
      expect(lancanoKomentarPrvi(ulaz)).not.toContain("create table prava (id int primary key);")
      expect(lancanoBlokPrvi(ulaz)).not.toContain("create table prava (id int primary key);")
    })

    it("DISKRIMINATOR: otvarač bloka u `--` komentaru — lanac (blok prvi) proguta STVARAN DDL", () => {
      const ulaz = [
        `-- ovo je samo napomena ${OTV}`,
        "create table prava (id int primary key);",
        `-- kraj ${ZATV}`,
      ].join("\n")
      expect(sanitizujSql(ulaz)).toContain("create table prava (id int primary key);")
      expect(lancanoBlokPrvi(ulaz)).not.toContain("create table prava (id int primary key);")
    })

    it("DISKRIMINATOR: ugnježđeni blok — nedubinska varijanta ostavi zakomentarisan DDL vidljiv", () => {
      const ulaz =
        `${OTV} vanjski ${OTV} unutrasnji ${ZATV} create table lazna (id int); ${ZATV}\n` +
        "create table prava (id int primary key);"
      expect(sanitizujSql(ulaz)).not.toContain("create table lazna")
      expect(lancanoKomentarPrvi(ulaz)).toContain("create table lazna")
    })

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

  it("stvaran DDL izvan komentara/stringova nije izgubljen (I komentar/string SU stvarno maskirani)", () => {
    // Prijašnja verzija je provjeravala SAMO da DDL preživi — što bi prošlo i kod
    // identity funkcije (return sadrzaj nepromijenjeno), pošto ovaj DDL uopšte ne
    // sadrži ni komentar ni navodnik koji bi identity funkcija morala pokvariti.
    // Sad se eksplicitno provjerava i UKLANJANJE (komentar, string) i OČUVANJE (DDL)
    // u ISTOM ulazu — identity-funkcija mutant sad pada na prve dvije provjere.
    const ulaz = [
      "-- napomena o klijenti tabeli",
      "create table klijenti (id uuid primary key);",
      "create policy klijenti_sel on klijenti for select using ('aktivan');",
    ].join("\n")
    const izlaz = sanitizujSql(ulaz)
    expect(izlaz).not.toContain("napomena")
    expect(izlaz).not.toContain("aktivan")
    expect(izlaz).toContain("create table klijenti (id uuid primary key);")
    expect(izlaz).toContain("create policy klijenti_sel on klijenti for select using (")
  })
})

function nalaz(pravilo: string, poruka: string, tabela?: string): Nalaz {
  return { putanja: "x.sql", linija: 1, pravilo, poruka, ...(tabela === undefined ? {} : { tabela }) }
}

describe("filtrirajNamjernePolicyless", () => {
  const allowlist = ["termin_zakazano_obavijest", "post_due_obavijesti"]

  it("izbacuje 'tabela-bez-politike' nalaz za tabelu iz allowlist-e", () => {
    const nalazi = [
      nalaz(
        "tabela-bez-politike",
        "tabela termin_zakazano_obavijest nema RLS politiku — ...",
        "termin_zakazano_obavijest",
      ),
    ]
    expect(filtrirajNamjernePolicyless(nalazi, allowlist)).toEqual([])
  })

  it("nalaz BEZ `tabela` polja se ZADRŽAVA i kad poruka pominje allowlist-ovanu tabelu", () => {
    // Fail-loud: filter se oslanja ISKLJUČIVO na strukturirano polje. Ako pravila.ts
    // ikad prestane da ga popunjava, izuzetak prestaje da važi (šum), umjesto da se
    // tiho oslanja na tekst poruke koji niko ne čuva.
    const nalazi = [
      nalaz("tabela-bez-politike", "tabela termin_zakazano_obavijest nema RLS politiku — ..."),
    ]
    expect(filtrirajNamjernePolicyless(nalazi, allowlist)).toEqual(nalazi)
  })

  it("čita `tabela` polje, NE tekst poruke — poruka pominje tabelu VAN allowlist-e, polje je u njoj", () => {
    // Diskriminator za M4: mutant koji se vrati na parsiranje imena iz `poruka` bi
    // ovaj nalaz ZADRŽAO (jer poruka pominje `klijenti`), a ispravna verzija ga izbacuje.
    const nalazi = [
      nalaz(
        "tabela-bez-politike",
        "tabela klijenti nema RLS politiku — ...",
        "termin_zakazano_obavijest",
      ),
    ]
    expect(filtrirajNamjernePolicyless(nalazi, allowlist)).toEqual([])
  })

  it("od MIJEŠANE liste izbacuje SAMO allowlist-ovanu, čuva onu VAN allowlist-e", () => {
    // Zamjena za prijašnji "ne izbacuje ... VAN allowlist-e" — taj test je izolovano
    // prolazio i kod mutanta koji UVIJEK vraća ulaz nepromijenjen (filter(() => true)),
    // jer je testirao samo "sačuvaj" stranu. Ovdje su OBA nalaza u istoj listi, pa
    // mutant koji ništa ne izbacuje PADA na prvom nalazu, a mutant koji izbacuje SVE
    // pada na drugom.
    const uAllowlisti = nalaz(
      "tabela-bez-politike",
      "tabela termin_zakazano_obavijest nema RLS politiku — ...",
      "termin_zakazano_obavijest",
    )
    const vanAllowlist = nalaz(
      "tabela-bez-politike",
      "tabela klijenti nema RLS politiku — ...",
      "klijenti",
    )
    expect(filtrirajNamjernePolicyless([uAllowlisti, vanAllowlist], allowlist)).toEqual([
      vanAllowlist,
    ])
  })

  it("tabela sa DIJAKRITIKOM u imenu se može pogoditi u allowlist-i", () => {
    // Zavisi od toga da pravila.ts ne siječe ime na dijakritiku (v. IDENT razred u
    // pravila.ts): dok je polje `tabela` glasilo `zadu`, nijedan unos u allowlist-i se
    // ne bi poklopio, pa bi namjerno policyless tabela bila trajno prijavljivana.
    const nalazi = [
      nalaz("tabela-bez-politike", "tabela zaduženja nema RLS politiku — ...", "zaduženja"),
    ]
    expect(filtrirajNamjernePolicyless(nalazi, ["zaduženja"])).toEqual([])
    expect(filtrirajNamjernePolicyless(nalazi, ["zaduživanja"])).toEqual(nalazi)
  })

  it("ne izbacuje tabelu sličnog imena koja nije tačno u allowlist-i", () => {
    const nalazi = [
      nalaz(
        "tabela-bez-politike",
        "tabela termin_zakazano_obavijest_v2 nema RLS politiku — ...",
        "termin_zakazano_obavijest_v2",
      ),
    ]
    expect(filtrirajNamjernePolicyless(nalazi, allowlist)).toEqual(nalazi)
  })

  it("NE dira nalaze drugih pravila — čak ni kad NOSE allowlist-ovanu tabelu u polju `tabela`", () => {
    // Guard na `pravilo` mora da se čita PRIJE polja `tabela`: `zastita-uklonjena` nad
    // namjerno policyless tabelom je i dalje pravi nalaz (RLS isključen na njoj znači da
    // više ni service-role izolacija ne važi), pa se NE smije izgubiti kroz ovaj filter.
    // Bez guard-a bi ovaj nalaz bio (pogrešno) izbačen.
    const nalazi = [
      nalaz(
        "zastita-uklonjena",
        "isključen RLS (row level security) na tabeli termin_zakazano_obavijest — ...",
        "termin_zakazano_obavijest",
      ),
    ]
    expect(filtrirajNamjernePolicyless(nalazi, allowlist)).toEqual(nalazi)
  })
})

describe("filtrirajOznaceneIzuzetke", () => {
  const MARKER = "-- integracija-dozvoli: zastita-uklonjena — politike ne koristi nijedan tok"
  const uPutanji = (putanja: string, pravilo = "zastita-uklonjena"): Nalaz => ({
    putanja,
    linija: 1,
    pravilo,
    poruka: "obrisana RLS politika p sa tabele t bez zamjene",
    tabela: "t",
  })

  it("izbacuje 'zastita-uklonjena' za fajl koji nosi marker sa obrazloženjem", () => {
    const nalazi = [uPutanji("a.sql")]
    expect(filtrirajOznaceneIzuzetke(nalazi, new Map([["a.sql", `${MARKER}\ndrop policy p on t;`]]))).toEqual([])
  })

  it("marker u JEDNOM fajlu ne izuzima nalaz DRUGOG fajla", () => {
    // Filter mora biti po-fajl. Da gleda globalno, jedna migracija sa markerom bi utišala
    // sve ostale u istom prolazu — tiho i bez ikakvog traga.
    const nalazi = [uPutanji("a.sql"), uPutanji("b.sql")]
    const sirovo = new Map([
      ["a.sql", `${MARKER}\ndrop policy p on t;`],
      ["b.sql", "drop policy p on t;"],
    ])
    expect(filtrirajOznaceneIzuzetke(nalazi, sirovo)).toEqual([uPutanji("b.sql")])
  })

  it("goli marker BEZ razloga ne vrijedi — izuzetak mora nositi obrazloženje", () => {
    const nalazi = [uPutanji("a.sql")]
    for (const goli of [
      "-- integracija-dozvoli: zastita-uklonjena",
      "-- integracija-dozvoli: zastita-uklonjena —",
      "-- integracija-dozvoli: zastita-uklonjena —   ",
    ]) {
      expect(filtrirajOznaceneIzuzetke(nalazi, new Map([["a.sql", `${goli}\ndrop policy p on t;`]]))).toEqual(
        nalazi,
      )
    }
  })

  it("NE dira nalaze drugih pravila ni kad fajl nosi marker", () => {
    // Marker izuzima isključivo `zastita-uklonjena`. Da izuzima sve, jedan komentar bi
    // ugasio i `tabela-bez-politike` i `rls-iskljucen` u istom fajlu.
    const nalazi = [uPutanji("a.sql", "tabela-bez-politike"), uPutanji("a.sql", "rls-iskljucen")]
    expect(filtrirajOznaceneIzuzetke(nalazi, new Map([["a.sql", MARKER]]))).toEqual(nalazi)
  })

  it("nalaz čija putanja nije u mapi se ZADRŽAVA (fail-loud)", () => {
    const nalazi = [uPutanji("nepoznat.sql")]
    expect(filtrirajOznaceneIzuzetke(nalazi, new Map([["a.sql", MARKER]]))).toEqual(nalazi)
  })

  it("marker mora biti SQL komentar — isti tekst kao gola naredba ne vrijedi", () => {
    const nalazi = [uPutanji("a.sql")]
    const bezCrtica = "integracija-dozvoli: zastita-uklonjena — razlog"
    expect(filtrirajOznaceneIzuzetke(nalazi, new Map([["a.sql", bezCrtica]]))).toEqual(nalazi)
  })
})
