/**
 * Puni DEMO bazu sa njemačkim firmama i njemačkom ZNR/ZOP terminologijom,
 * da demo izgleda kao da ga koriste i klijenti sa njemačkog govornog područja.
 *
 * SAMO DEMO — skripta odbija da radi ako connection string ne pogađa DEMO ref.
 *
 *   pnpm seed:demo-de            # upiši
 *   pnpm seed:demo-de --ocisti   # ukloni sve što je ova skripta napravila
 *
 * Idempotentno: svaki prolaz prvo obriše prethodni njemački seed (po nazivima
 * firmi i vrsta provjera niže), pa upiše svježe. Ne dira postojeće bh. klijente,
 * E2E podatke ni korisničke naloge — nijedan auth nalog se ne kreira.
 *
 * Nazivi firmi su izmišljeni; namjerno se ne koristi ime nijedne stvarne
 * njemačke kompanije da se ne bi fabrikovali zapisi o postojećem pravnom licu.
 */
import { Client } from "pg"
import { zahtijevajCilj } from "@/lib/supabase/refs"

/** Sidro za sve relativne datume — demo se čita u odnosu na "danas". */
const DANAS = new Date()

/** Pomjeraj u danima od danas → 'YYYY-MM-DD'. */
function dan(pomjeraj: number): string {
  const d = new Date(DANAS)
  d.setDate(d.getDate() + pomjeraj)
  return d.toISOString().slice(0, 10)
}

// ─── Vrste provjera na njemačkom ────────────────────────────────────────────
// Nazivi nose i srpski prevod u zagradi, da katalog ostane čitljiv i domaćem
// operateru — DB nema zasebnu kolonu za prevod.
const VRSTE = [
  {
    naziv: "DGUV V3 – Prüfung ortsveränderlicher Geräte (Pregled prenosnih el. uređaja)",
    sifra: "DGUV-V3",
    interval: 12,
    osnov: "DGUV Vorschrift 3, DIN VDE 0701-0702",
    napomena: "Prüfprotokoll wird je Gerät geführt.",
  },
  {
    naziv: "Brandschutzbegehung (Obilazak zaštite od požara)",
    sifra: "BRAND-BEG",
    interval: 6,
    osnov: "ASR A2.2, Brandschutzordnung DIN 14096",
    napomena: "Begehung mit Brandschutzbeauftragtem des Kunden.",
  },
  {
    naziv: "Prüfung der Feuerlöscher (Pregled aparata za gašenje)",
    sifra: "FEUERLOESCHER",
    interval: 24,
    osnov: "DIN 14406-4, ASR A2.2",
    napomena: "Instandhaltung alle 2 Jahre durch Sachkundigen.",
  },
  {
    naziv: "Gefährdungsbeurteilung (Procjena rizika)",
    sifra: "GEF-BEURT",
    interval: 12,
    osnov: "ArbSchG § 5, BetrSichV",
    napomena: "Dokumentation nach ArbSchG § 6 erforderlich.",
  },
  {
    naziv: "Sicherheitsunterweisung der Mitarbeiter (Obuka radnika)",
    sifra: "UNTERWEISUNG",
    interval: 12,
    osnov: "ArbSchG § 12, DGUV Vorschrift 1",
    napomena: "Teilnehmerliste als Nachweis.",
  },
  {
    naziv: "Prüfung der Absauganlagen (Pregled ventilacije/odsisa)",
    sifra: "ABSAUG",
    interval: 12,
    osnov: "TRGS 500, BetrSichV § 3",
    napomena: "Messung der Erfassungsgeschwindigkeit.",
  },
] as const

// ─── Firme ──────────────────────────────────────────────────────────────────
// `sifre` referišu VRSTE gore; `pomjeraj` je rok dospijeća u danima od danas.
const FIRME = [
  {
    naziv: "Nordhalle Logistik GmbH",
    adresa: "Speicherstraße 41, 20457 Hamburg",
    email: "office@nordhalle-logistik.example",
    telefon: "+49 40 3210 4455",
    pib: "DE 811 204 337",
    maticni: "HRB 92841 HH",
    djelatnost: "52.10 – Lagerei",
    tip: "ugovor",
    napomena: "Zentrallager mit Hochregal; Begehungen quartalsweise gewünscht.",
    lokacije: [
      { naziv: "Zentrallager Hafen", grad: "Hamburg", regija: "Hamburg", kontakt: "Katrin Bergmann", kontaktEmail: "k.bergmann@nordhalle-logistik.example", kontaktTel: "+49 40 3210 4460", adresa: "Speicherstraße 41" },
      { naziv: "Umschlaghalle Süd", grad: "Hamburg", regija: "Hamburg", kontakt: "Jonas Reuter", kontaktEmail: "j.reuter@nordhalle-logistik.example", kontaktTel: "+49 40 3210 4471", adresa: "Am Sandtorkai 9" },
    ],
    ugovor: { broj: "RV-2025-118", potpis: dan(-402), vazenje: 24, obilasci: 1, napomena: "Rahmenvertrag inkl. Brandschutzbegehung." },
    kontakti: [
      { ime: "Katrin Bergmann", funkcija: "Fachkraft für Arbeitssicherheit", email: "k.bergmann@nordhalle-logistik.example", tel: "+49 40 3210 4460", prima: true },
      { ime: "Jonas Reuter", funkcija: "Standortleiter", email: "j.reuter@nordhalle-logistik.example", tel: "+49 40 3210 4471", prima: false },
    ],
    termini: [
      { sifra: "DGUV-V3", lok: 0, pomjeraj: -318, status: "izvrseno", izvrsen: -320, napomena: "Alle 214 Geräte geprüft, 3 Mängel behoben." },
      { sifra: "BRAND-BEG", lok: 0, pomjeraj: -132, status: "izvrseno", izvrsen: -134, napomena: "Fluchtwege frei, Protokoll übergeben." },
      { sifra: "DGUV-V3", lok: 0, pomjeraj: 47, status: "planirano", napomena: "Jahresprüfung Zentrallager." },
      { sifra: "BRAND-BEG", lok: 1, pomjeraj: 9, status: "zakazano", zakazan: 9, napomena: "Termin mit Herrn Reuter bestätigt." },
      { sifra: "FEUERLOESCHER", lok: 1, pomjeraj: -11, status: "planirano", napomena: "Wartung überfällig — Kunde kontaktiert." },
      { sifra: "UNTERWEISUNG", lok: 0, pomjeraj: 68, status: "planirano", napomena: "Jährliche Unterweisung, ca. 40 Teilnehmer." },
    ],
  },
  {
    naziv: "Rheintal Präzisionstechnik GmbH",
    adresa: "Industriering 7, 68169 Mannheim",
    email: "info@rheintal-praezision.example",
    telefon: "+49 621 55 40 210",
    pib: "DE 293 771 604",
    maticni: "HRB 71155 MA",
    djelatnost: "25.62 – Mechanische Bearbeitung",
    tip: "ugovor",
    napomena: "CNC-Fertigung; Absauganlagen sind prüfpflichtig.",
    lokacije: [
      { naziv: "Werk Nord", grad: "Mannheim", regija: "Baden-Württemberg", kontakt: "Dr. Elke Sauer", kontaktEmail: "e.sauer@rheintal-praezision.example", kontaktTel: "+49 621 55 40 233", adresa: "Industriering 7" },
      { naziv: "Werkstatt Ost", grad: "Ludwigshafen", regija: "Rheinland-Pfalz", kontakt: "Murat Yildiz", kontaktEmail: "m.yildiz@rheintal-praezision.example", kontaktTel: "+49 621 55 40 244", adresa: "Bruchwiesenstraße 22" },
    ],
    ugovor: { broj: "RV-2024-087", potpis: dan(-611), vazenje: 36, obilasci: 2, napomena: "Inkl. Gefährdungsbeurteilung aller Arbeitsplätze." },
    kontakti: [
      { ime: "Dr. Elke Sauer", funkcija: "Leiterin Arbeitssicherheit", email: "e.sauer@rheintal-praezision.example", tel: "+49 621 55 40 233", prima: true },
      { ime: "Murat Yildiz", funkcija: "Brandschutzbeauftragter", email: "m.yildiz@rheintal-praezision.example", tel: "+49 621 55 40 244", prima: true },
    ],
    termini: [
      { sifra: "ABSAUG", lok: 0, pomjeraj: -274, status: "izvrseno", izvrsen: -276, napomena: "Erfassungsgeschwindigkeit im Sollbereich." },
      { sifra: "GEF-BEURT", lok: 0, pomjeraj: -58, status: "izvrseno", izvrsen: -60, napomena: "12 Arbeitsplätze neu bewertet." },
      { sifra: "ABSAUG", lok: 0, pomjeraj: 91, status: "planirano", napomena: "Folgeprüfung Absauganlage Halle 2." },
      { sifra: "DGUV-V3", lok: 1, pomjeraj: -4, status: "planirano", napomena: "Überfällig — Werkstatt war im Betriebsurlaub." },
      { sifra: "UNTERWEISUNG", lok: 1, pomjeraj: 21, status: "zakazano", zakazan: 21, napomena: "Schichtweise, 2 Gruppen." },
      { sifra: "BRAND-BEG", lok: 0, pomjeraj: 5, status: "zakazano", zakazan: 5, napomena: "Gemeinsam mit Herrn Yildiz." },
      { sifra: "FEUERLOESCHER", lok: 0, pomjeraj: 154, status: "planirano", napomena: null },
    ],
  },
  {
    naziv: "Bäckerei Steinofen Wagner KG",
    adresa: "Mühlenweg 3, 04277 Leipzig",
    email: "kontakt@steinofen-wagner.example",
    telefon: "+49 341 22 08 190",
    pib: "DE 158 902 447",
    maticni: "HRA 18204 L",
    djelatnost: "10.71 – Herstellung von Backwaren",
    tip: "ugovor",
    napomena: "Produktion in Nachtschicht; Begehungen morgens ab 07:00.",
    lokacije: [
      { naziv: "Backstube Leipzig", grad: "Leipzig", regija: "Sachsen", kontakt: "Sabine Wagner", kontaktEmail: "s.wagner@steinofen-wagner.example", kontaktTel: "+49 341 22 08 195", adresa: "Mühlenweg 3" },
    ],
    ugovor: { broj: "RV-2025-204", potpis: dan(-198), vazenje: 12, obilasci: 1, napomena: "Kleinbetrieb — reduzierter Umfang." },
    kontakti: [
      { ime: "Sabine Wagner", funkcija: "Geschäftsführerin", email: "s.wagner@steinofen-wagner.example", tel: "+49 341 22 08 195", prima: true },
      { ime: "Tobias Kern", funkcija: "Schichtleiter Produktion", email: "t.kern@steinofen-wagner.example", tel: "+49 341 22 08 197", prima: false },
    ],
    termini: [
      { sifra: "FEUERLOESCHER", lok: 0, pomjeraj: -166, status: "izvrseno", izvrsen: -166, napomena: "6 Löscher gewartet, 1 ersetzt." },
      { sifra: "UNTERWEISUNG", lok: 0, pomjeraj: -21, status: "izvrseno", izvrsen: -22, napomena: "9 Mitarbeiter unterwiesen." },
      { sifra: "BRAND-BEG", lok: 0, pomjeraj: 33, status: "planirano", napomena: "Schwerpunkt Ofenbereich." },
      { sifra: "DGUV-V3", lok: 0, pomjeraj: -37, status: "planirano", napomena: "Überfällig — Nachtschicht erschwert Terminfindung." },
      { sifra: "GEF-BEURT", lok: 0, pomjeraj: 112, status: "planirano", napomena: null },
    ],
  },
  {
    naziv: "Alpenbau Hochtief Süd GmbH",
    adresa: "Lindenallee 88, 83022 Rosenheim",
    email: "verwaltung@alpenbau-sued.example",
    telefon: "+49 8031 40 77 12",
    pib: "DE 447 630 118",
    maticni: "HRB 30117 TS",
    djelatnost: "41.20 – Hochbau",
    tip: "ponuda",
    napomena: "Angebot für Baustellenbetreuung liegt beim Kunden — noch kein Rahmenvertrag.",
    lokacije: [
      { naziv: "Baustelle Inntal", grad: "Rosenheim", regija: "Bayern", kontakt: "Florian Huber", kontaktEmail: "f.huber@alpenbau-sued.example", kontaktTel: "+49 8031 40 77 20", adresa: "Inntalstraße 14" },
      { naziv: "Bauhof Rosenheim", grad: "Rosenheim", regija: "Bayern", kontakt: "Anja Löffler", kontaktEmail: "a.loeffler@alpenbau-sued.example", kontaktTel: "+49 8031 40 77 26", adresa: "Lindenallee 88" },
    ],
    ugovor: null,
    kontakti: [
      { ime: "Florian Huber", funkcija: "Bauleiter", email: "f.huber@alpenbau-sued.example", tel: "+49 8031 40 77 20", prima: true },
      { ime: "Anja Löffler", funkcija: "Sicherheits- und Gesundheitsschutzkoordinatorin (SiGeKo)", email: "a.loeffler@alpenbau-sued.example", tel: "+49 8031 40 77 26", prima: true },
    ],
    termini: [
      { sifra: "GEF-BEURT", lok: 0, pomjeraj: -89, status: "izvrseno", izvrsen: -90, napomena: "Baustellenspezifische Beurteilung erstellt." },
      { sifra: "UNTERWEISUNG", lok: 0, pomjeraj: 2, status: "zakazano", zakazan: 2, napomena: "Erstunterweisung neue Baustelle." },
      { sifra: "DGUV-V3", lok: 1, pomjeraj: 60, status: "planirano", napomena: "Elektrowerkzeuge Bauhof." },
      { sifra: "BRAND-BEG", lok: 1, pomjeraj: -19, status: "otkazano", napomena: "Vom Kunden abgesagt — Bauhof umgebaut." },
      { sifra: "FEUERLOESCHER", lok: 1, pomjeraj: 128, status: "planirano", napomena: null },
    ],
  },
] as const

const NAZIVI_FIRMI = FIRME.map((f) => f.naziv)
const NAZIVI_VRSTA = VRSTE.map((v) => v.naziv)

async function ocisti(c: Client) {
  // termini imaju ON DELETE RESTRICT prema klijenti/vrste_provjera → prvo oni.
  const t = await c.query(
    `delete from termini where klijent_id in (select id from klijenti where naziv = any($1))
       or vrsta_provjere_id in (select id from vrste_provjera where naziv = any($2))`,
    [NAZIVI_FIRMI, NAZIVI_VRSTA],
  )
  // lokacije/ugovori/kontakti/klijent_provjere padaju kroz ON DELETE CASCADE.
  const k = await c.query(`delete from klijenti where naziv = any($1)`, [NAZIVI_FIRMI])
  const v = await c.query(`delete from vrste_provjera where naziv = any($1)`, [NAZIVI_VRSTA])
  console.log(`🧹 očišćeno: ${k.rowCount} firmi, ${v.rowCount} vrsta provjera, ${t.rowCount} termina`)
}

async function upisi(c: Client) {
  const vrstaId = new Map<string, string>()
  for (const v of VRSTE) {
    const r = await c.query(
      `insert into vrste_provjera (naziv, sifra, podrazumevani_interval_mjeseci, zakonski_osnov, napomena, aktivna, vodi_dokumentaciju)
       values ($1,$2,$3,$4,$5,true,true) returning id`,
      [v.naziv, v.sifra, v.interval, v.osnov, v.napomena],
    )
    vrstaId.set(v.sifra, r.rows[0].id)
  }
  console.log(`✅ vrste provjera: ${VRSTE.length}`)

  let brLok = 0
  let brUg = 0
  let brKont = 0
  let brTerm = 0
  let brProvj = 0

  for (const f of FIRME) {
    const kr = await c.query(
      // salji_podsjetnik_klijentu=false NAMJERNO: adrese su @*.example (rezervisan TLD),
      // a vercel.json ima dnevni cron za podsjetnike — uključen prekidač bi značio
      // svakodnevne bounce-ove sa podsjetnik@nextpixel.dev. Kontakti su i dalje
      // označeni kao primaoci, pa ekran „Ko šta prima" izgleda popunjeno.
      `insert into klijenti (naziv, adresa, email, telefon, pib, maticni_broj, sifra_djelatnosti, tip_odnosa, napomena, salji_podsjetnik_klijentu)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false) returning id`,
      [f.naziv, f.adresa, f.email, f.telefon, f.pib, f.maticni, f.djelatnost, f.tip, f.napomena],
    )
    const klijentId = kr.rows[0].id

    const lokIds: string[] = []
    for (const l of f.lokacije) {
      const r = await c.query(
        `insert into lokacije (klijent_id, naziv, adresa, grad, regija, kontakt_osoba, kontakt_email, kontakt_telefon)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [klijentId, l.naziv, l.adresa, l.grad, l.regija, l.kontakt, l.kontaktEmail, l.kontaktTel],
      )
      lokIds.push(r.rows[0].id)
      brLok++
    }

    let ugovorId: string | null = null
    if (f.ugovor) {
      const u = f.ugovor
      const potpis = new Date(u.potpis)
      const istek = new Date(potpis)
      istek.setMonth(istek.getMonth() + u.vazenje)
      const r = await c.query(
        `insert into ugovori (klijent_id, zavodni_broj, datum_potpisivanja, datum_isteka, vazenje_mjeseci, broj_obilazaka_mjesecno, automatsko_obnavljanje, aktivan, napomena)
         values ($1,$2,$3,$4,$5,$6,true,true,$7) returning id`,
        [klijentId, u.broj, u.potpis, istek.toISOString().slice(0, 10), u.vazenje, u.obilasci, u.napomena],
      )
      ugovorId = r.rows[0].id
      brUg++
    }

    for (const k of f.kontakti) {
      await c.query(
        `insert into kontakt_osobe (klijent_id, ime, funkcija, email, telefon, podsjetnik_primalac)
         values ($1,$2,$3,$4,$5,$6)`,
        [klijentId, k.ime, k.funkcija, k.email, k.tel, k.prima],
      )
      brKont++
    }

    // klijent_provjere = katalog obaveza firme (jedan red po vrsti koju ima).
    const vrsteFirme = [...new Set(f.termini.map((t) => t.sifra))]
    for (const sifra of vrsteFirme) {
      const v = VRSTE.find((x) => x.sifra === sifra)!
      const zadnji = f.termini
        .filter((t) => t.sifra === sifra && t.status === "izvrseno")
        .map((t) => dan(t.izvrsen!))
        .sort()
        .pop()
      await c.query(
        `insert into klijent_provjere (klijent_id, vrsta_provjere_id, ugovor_id, lokacija_id, interval_mjeseci, zadnji_datum, nacin_izvrsenja, aktivan)
         values ($1,$2,$3,null,$4,$5,'izvrsava',true)`,
        [klijentId, vrstaId.get(sifra), ugovorId, v.interval, zadnji ?? null],
      )
      brProvj++
    }

    for (const t of f.termini) {
      const v = VRSTE.find((x) => x.sifra === t.sifra)!
      await c.query(
        `insert into termini (klijent_id, lokacija_id, vrsta_provjere_id, rok_dospijeca, datum_zakazan, datum_izvrsenja, datum_zadnjeg, interval_mjeseci, status, napomena, nacin_izvrsenja)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::termini_status,$10,'izvrsava')`,
        [
          klijentId,
          lokIds[t.lok] ?? null,
          vrstaId.get(t.sifra),
          dan(t.pomjeraj),
          "zakazan" in t && t.zakazan != null ? dan(t.zakazan) : null,
          "izvrsen" in t && t.izvrsen != null ? dan(t.izvrsen) : null,
          null,
          v.interval,
          t.status,
          t.napomena ?? null,
        ],
      )
      brTerm++
    }

    console.log(`  · ${f.naziv} — ${f.lokacije.length} lok, ${f.kontakti.length} kontakt, ${f.termini.length} termina`)
  }

  console.log(
    `✅ firme: ${FIRME.length} · lokacije: ${brLok} · ugovori: ${brUg} · kontakti: ${brKont} · klijent_provjere: ${brProvj} · termini: ${brTerm}`,
  )
}

async function main() {
  const url = process.env.DATABASE_URL_DEMO
  if (!url) throw new Error("DATABASE_URL_DEMO nije postavljen (očekuje se .env.development.local).")
  zahtijevajCilj(url, "demo", "seed-demo-de")

  const samoCiscenje = process.argv.includes("--ocisti")
  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    await c.query("begin")
    await ocisti(c)
    if (!samoCiscenje) await upisi(c)
    await c.query("commit")
    console.log(samoCiscenje ? "🧹 Njemački demo seed uklonjen." : "🇩🇪 Njemački demo seed upisan u DEMO.")
  } catch (e) {
    await c.query("rollback")
    throw e
  } finally {
    await c.end()
  }
}

main()
