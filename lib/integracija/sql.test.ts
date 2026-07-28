import { describe, it, expect } from "vitest"
import { maskiraj, sanitizujSql, filtrirajNamjernePolicyless } from "./sql"
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

  it("od MIJEŠANE liste izbacuje SAMO allowlist-ovanu, čuva onu VAN allowlist-e", () => {
    // Zamjena za prijašnji "ne izbacuje ... VAN allowlist-e" — taj test je izolovano
    // prolazio i kod mutanta koji UVIJEK vraća ulaz nepromijenjen (filter(() => true)),
    // jer je testirao samo "sačuvaj" stranu. Ovdje su OBA nalaza u istoj listi, pa
    // mutant koji ništa ne izbacuje PADA na prvom nalazu, a mutant koji izbacuje SVE
    // pada na drugom.
    const uAllowlisti = nalaz(
      "tabela-bez-politike",
      "tabela termin_zakazano_obavijest nema RLS politiku — ...",
    )
    const vanAllowlist = nalaz("tabela-bez-politike", "tabela klijenti nema RLS politiku — ...")
    expect(filtrirajNamjernePolicyless([uAllowlisti, vanAllowlist], allowlist)).toEqual([
      vanAllowlist,
    ])
  })

  it("tabela sa DIJAKRITIKOM u imenu se može pogoditi u allowlist-i", () => {
    // Zavisi od toga da pravila.ts ne siječe ime na dijakritiku (v. IDENT razred u
    // pravila.ts): dok je poruka glasila "tabela zadu nema RLS politiku", nijedan unos
    // u allowlist-i ne bi se poklopio, pa bi namjerno policyless tabela bila trajno
    // prijavljivana. (`\S+` u IME_IZ_PORUKE dijakritiku hvata bez izmjene.)
    const nalazi = [nalaz("tabela-bez-politike", "tabela zaduženja nema RLS politiku — ...")]
    expect(filtrirajNamjernePolicyless(nalazi, ["zaduženja"])).toEqual([])
    expect(filtrirajNamjernePolicyless(nalazi, ["zaduživanja"])).toEqual(nalazi)
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

  it("NE dira nalaze drugih pravila — čak ni kad poruka SLIČI na tabela-bez-politike format", () => {
    // Zamjena za prijašnji "ne dira nalaze drugih pravila" — taj test je (dokazano)
    // preživljavao mutaciju koja UKLANJA `if (n.pravilo !== "tabela-bez-politike")`,
    // jer poruka u tom testu ("VIEW x bez security_invoker=on") ionako ne poklapa
    // IME_IZ_PORUKE regex — sa ili bez guard-a, ishod je identičan ("zadrži"), pa test
    // ne testira granu koju mu ime tvrdi da testira.
    //
    // Ovdje poruka NAMJERNO poklapa IME_IZ_PORUKE (kao da je allowlist-ovana tabela),
    // ALI `pravilo` NIJE "tabela-bez-politike" — provjerava da se `pravilo` STVARNO
    // čita prije poruke. Bez guard-a, ovaj nalaz bi bio (pogrešno) izbačen.
    const nalazi = [
      nalaz(
        "neko-drugo-pravilo",
        "tabela termin_zakazano_obavijest nema RLS politiku — lažna poruka",
      ),
    ]
    expect(filtrirajNamjernePolicyless(nalazi, allowlist)).toEqual(nalazi)
  })
})
