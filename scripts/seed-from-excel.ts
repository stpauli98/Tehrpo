/**
 * Seed baze sa Tehpro Excel podacima.
 *
 * PAŽNJA: ovo NIJE čista dopuna — skripta prvo BRIŠE `termini`,
 * `klijent_provjere` i `lokacije` (uz kaskade na `podsjetnici`, `dokumenti`,
 * `termin_zakazano_obavijest`, `post_due_obavijesti`), pa tek onda uvozi Excel.
 *
 * Zato se okruženje bira EKSPLICITNO, isto kao kod `db:apply-cloud`:
 *   pnpm seed --lokalno
 *   pnpm seed --demo
 *   POTVRDI_PROD=da SEED_BRISI=da pnpm seed --prod
 *
 * Ranije je skripta bila vezana isključivo na `--env-file=.env.local`, a taj fajl
 * nosi PROD ref — dakle podrazumijevani cilj wipe-a je bila PRODUKCIJA, bez
 * ijedne provjere, bez ispisa cilja i bez ispisa koliko redova nestaje. Prvo što
 * bi se vidjelo bilo je „✅ termini obrisani". Sada:
 *   1. bez --lokalno/--demo/--prod skripta odbija da radi,
 *   2. URL na koji se klijent spaja mora odgovarati traženom cilju
 *      (zahtijevajCilj iz lib/supabase/refs.ts, isti guard kao db:apply-cloud),
 *   3. za --prod se traži POTVRDI_PROD=da, a pošto seed briše — i SEED_BRISI=da,
 *   4. broj redova koji nestaje se PREBROJI i ISPIŠE prije prvog DELETE-a.
 * Sve to ide PRIJE ijednog dodira baze (i prije čitanja Excela).
 *
 * Dodatne zastavice:
 *   --suho            ništa ne mijenja: ispiše cilj i koliko bi redova nestalo, pa izađe
 *   --samo-brisanje   uradi SAMO wipe (bez uvoza Excela) i izađi
 *   --bez-brisanja    preskoči wipe, radi samo upsert/uvoz (nema gubitka podataka)
 *
 * Idempotentno — pokretanje 2× ne pravi duplikate (upsert onConflict).
 *
 * Redoslijed wipe-a (FK-safe):
 * 1. delete termini          (CASCADE: podsjetnici/dokumenti)
 * 2. delete klijent_provjere (lokacija_id je NOT NULL + ON DELETE RESTRICT od
 *    migracije 20260703102000 — bez ovoga brisanje lokacija pada; preživjeli
 *    redovi bi ionako pokazivali na obrisane lokacije)
 * 3. delete lokacije         (termini.lokacija_id je SET NULL — ali termini su već obrisani)
 * 4. upsert klijenti       from ParseResult.firme, onConflict naziv
 * 5. upsert vrste_provjera from ParseResult.vrste (includes "Obilazak"),
 *    onConflict naziv; NE postavljati podrazumevani_interval_mjeseci (ostaje NULL)
 * 6. upsert lokacije       from ParseResult.lokacije: {klijent_id, naziv},
 *    onConflict (klijent_id, naziv) [uq_lokacije_klijent_naziv]
 * 7. insert termini        batch ~500:
 *    - klijent_id  = firmaId(firma_naziv)
 *    - lokacija_id = lokId(firmaId + "|" + lokacija_naziv) | null
 *    - izvrseno: datum_zadnjeg + datum_izvrsenja + rok_dospijeca = datum
 *    - planirano:  datum_zakazan + rok_dospijeca = datum
 *    Skip ako firma/vrsta id missing.
 */

import path from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { todayIso } from "../lib/date"
import { prepoznajCilj, zahtijevajCilj } from "../lib/supabase/refs"
import { parseTehproExcel } from "../lib/excel/parser"

const EXCEL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "2026- obilasci, pregledi i ispitivanja, obuke, dokumentacija.xlsx"
)

const BATCH = 500

/** Tabele koje wipe briše, redoslijedom (FK-safe). */
const TABELE_ZA_BRISANJE = ["termini", "klijent_provjere", "lokacije"] as const

/** Filter koji `.delete()` traži da ne bi bio bez `where` — ne izuzima nijedan stvarni red. */
const NIJEDAN_UUID = "00000000-0000-0000-0000-000000000000"

// ───────────────────────────────────────────────────────────────────────────────
// GUARD OKRUŽENJA — čista funkcija, bez ijednog dodira baze i bez čitanja Excela.
// Izdvojeno iz main() da se ponašanje može provjeriti testom bez konekcije.
// ───────────────────────────────────────────────────────────────────────────────

export type Okruzenje = "lokalno" | "demo" | "prod"

export type Zastavice = {
  suho: boolean
  samoBrisanje: boolean
  bezBrisanja: boolean
}

export type Rjesenje =
  | { ok: true; okruzenje: Okruzenje; url: string; kljuc: string; zastavice: Zastavice }
  | { ok: false; greska: string }

const CILJ_ZASTAVICE = ["--lokalno", "--demo", "--prod"] as const
const OSTALE_ZASTAVICE = ["--suho", "--samo-brisanje", "--bez-brisanja"] as const
const POZNATE_ZASTAVICE: readonly string[] = [...CILJ_ZASTAVICE, ...OSTALE_ZASTAVICE]

/** Da li URL vodi na lokalni Supabase stack (supabase start / Docker). */
export function jeLokalniUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(url.trim())
}

/**
 * Odlučuje smije li se seed uopšte pokrenuti i na koji URL se smije spojiti.
 * Vraća grešku umjesto da baca, da se ista logika može provjeriti u testu.
 */
export function odrediCilj(
  args: string[],
  okolina: Record<string, string | undefined>,
): Rjesenje {
  const nepoznate = args.filter((a) => a.startsWith("-") && !POZNATE_ZASTAVICE.includes(a))
  if (nepoznate.length > 0) {
    return { ok: false, greska: `Nepoznata zastavica: ${nepoznate.join(", ")}` }
  }
  const visak = args.filter((a) => !a.startsWith("-"))
  if (visak.length > 0) {
    return { ok: false, greska: `Neočekivan argument: ${visak.join(", ")}` }
  }

  const izabrani: readonly string[] = CILJ_ZASTAVICE.filter((z) => args.includes(z))
  const prvi = izabrani[0]
  if (!prvi) {
    return {
      ok: false,
      greska: "Nedostaje --lokalno, --demo ili --prod. Cilj se mora navesti eksplicitno.",
    }
  }
  if (izabrani.length > 1) {
    return { ok: false, greska: `${izabrani.join(" i ")} se međusobno isključuju.` }
  }

  const zastavice: Zastavice = {
    suho: args.includes("--suho"),
    samoBrisanje: args.includes("--samo-brisanje"),
    bezBrisanja: args.includes("--bez-brisanja"),
  }
  if (zastavice.samoBrisanje && zastavice.bezBrisanja) {
    return { ok: false, greska: "--samo-brisanje i --bez-brisanja se međusobno isključuju." }
  }

  const okruzenje = prvi.slice(2) as Okruzenje

  // Po cilju specifične varijable imaju prednost; bez njih se koristi ono što je
  // aplikacija ionako učitala (NEXT_PUBLIC_SUPABASE_URL + service role ključ).
  const imeUrla = {
    lokalno: "SUPABASE_URL_LOKALNO",
    demo: "SUPABASE_URL_DEMO",
    prod: "SUPABASE_URL_PROD",
  }[okruzenje]
  const imeKljuca = {
    lokalno: "SUPABASE_SERVICE_ROLE_KEY_LOKALNO",
    demo: "SUPABASE_SERVICE_ROLE_KEY_DEMO",
    prod: "SUPABASE_SERVICE_ROLE_KEY_PROD",
  }[okruzenje]

  // `||` namjerno, ne `??`: prazna varijabla u okruženju znači „nije postavljena".
  const url = okolina[imeUrla] || okolina.NEXT_PUBLIC_SUPABASE_URL
  const kljuc = okolina[imeKljuca] || okolina.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    return { ok: false, greska: `Ni ${imeUrla} ni NEXT_PUBLIC_SUPABASE_URL nisu postavljeni.` }
  }

  // Guard cilja: URL mora stvarno voditi na traženo okruženje.
  if (okruzenje === "lokalno") {
    if (!jeLokalniUrl(url)) {
      const stvarno = prepoznajCilj(url)
      const opis =
        stvarno === "nepoznato"
          ? "URL nije lokalni (127.0.0.1/localhost)"
          : `URL pogađa ${stvarno.toUpperCase()}`
      return {
        ok: false,
        greska: `seed --lokalno: očekivan lokalni Supabase, ali ${opis}. Prekidam. (Postavi ${imeUrla} ako ti env fajl gađa cloud.)`,
      }
    }
  } else {
    try {
      zahtijevajCilj(url, okruzenje, `seed --${okruzenje}`)
    } catch (e) {
      return {
        ok: false,
        greska: `${(e as Error).message} (Postavi ${imeUrla} i ${imeKljuca} ako gađaš drugi cilj od onog u env fajlu.)`,
      }
    }
  }

  // Produkcija: dvije nezavisne potvrde — jedna za cilj, jedna za to što seed BRIŠE.
  // `--suho` ne mijenja ništa, pa mu potvrde nisu potrebne.
  if (okruzenje === "prod" && !zastavice.suho) {
    if (okolina.POTVRDI_PROD !== "da") {
      return { ok: false, greska: "Seed na PRODUKCIJU traži POTVRDI_PROD=da u okruženju." }
    }
    if (!zastavice.bezBrisanja && okolina.SEED_BRISI !== "da") {
      return {
        ok: false,
        greska:
          "Seed BRIŠE termine, klijent_provjere i lokacije. Na PRODUKCIJI to traži i SEED_BRISI=da " +
          "(ili pokreni sa --bez-brisanja).",
      }
    }
  }

  if (!kljuc) {
    return { ok: false, greska: `Ni ${imeKljuca} ni SUPABASE_SERVICE_ROLE_KEY nisu postavljeni.` }
  }

  return { ok: true, okruzenje, url, kljuc, zastavice }
}

function usage(poruka: string): never {
  console.error(`❌ ${poruka}

Upotreba:
  pnpm seed --lokalno
  pnpm seed --demo
  POTVRDI_PROD=da SEED_BRISI=da pnpm seed --prod

Zastavice:
  --suho            ništa ne mijenja: ispiše cilj i koliko bi redova nestalo
  --samo-brisanje   uradi samo wipe (bez uvoza Excela)
  --bez-brisanja    preskoči wipe, uradi samo uvoz`)
  process.exit(1)
}

/** Broj redova koje bi wipe pogodio, po tabeli. Samo HEAD count — ništa se ne mijenja. */
async function prebrojZaBrisanje(
  supabase: SupabaseClient<Database>
): Promise<{ tabela: string; redova: number }[]> {
  const rezultat: { tabela: string; redova: number }[] = []
  for (const tabela of TABELE_ZA_BRISANJE) {
    const { count, error } = await supabase
      .from(tabela)
      .select("*", { count: "exact", head: true })
      .neq("id", NIJEDAN_UUID)
    if (error) throw new Error(`${tabela} count failed: ${error.message}`)
    rezultat.push({ tabela, redova: count ?? 0 })
  }
  return rezultat
}

async function main() {
  // ── GUARD — prije Excela, prije klijenta, prije ijednog upita ───────────────
  const rjesenje = odrediCilj(process.argv.slice(2), process.env)
  if (!rjesenje.ok) usage(rjesenje.greska)
  const { okruzenje, url, kljuc, zastavice } = rjesenje

  console.log(
    `▶ cilj: ${okruzenje.toUpperCase()}` +
      `${okruzenje === "lokalno" ? " (lokalni Supabase)" : ` (ref potvrđen: ${prepoznajCilj(url)})`}` +
      `${zastavice.suho ? " · SUHO (ništa se ne mijenja)" : ""}` +
      `${zastavice.samoBrisanje ? " · SAMO BRISANJE (bez uvoza)" : ""}` +
      `${zastavice.bezBrisanja ? " · BEZ BRISANJA (samo uvoz)" : ""}`
  )

  const supabase = createClient<Database>(url, kljuc, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Koliko redova nestaje — ispis PRIJE prvog DELETE-a ─────────────────────
  if (!zastavice.bezBrisanja) {
    const popis = await prebrojZaBrisanje(supabase)
    const ukupno = popis.reduce((z, r) => z + r.redova, 0)
    console.log(`\n⚠️  Wipe će obrisati ${ukupno} redova na ${okruzenje.toUpperCase()}:`)
    for (const { tabela, redova } of popis) {
      console.log(`   ${tabela.padEnd(18)} ${redova}`)
    }
    console.log(
      "   (kaskadno nestaju i podsjetnici/dokumenti/obavijesti vezani za te termine;\n" +
        "    fajlovi u Storage-u ostaju osirotjeli — poslije seed-a pokreni `pnpm gc:dokumenti`)"
    )
  }

  if (zastavice.suho) {
    console.log("\n✅ Suho pokretanje — baza nije mijenjana.")
    return
  }

  // ── Wipe ───────────────────────────────────────────────────────────────────
  if (!zastavice.bezBrisanja) {
    for (const tabela of TABELE_ZA_BRISANJE) {
      console.log(`\n🗑️  Brisanje ${tabela}...`)
      const { error } = await supabase.from(tabela).delete().neq("id", NIJEDAN_UUID)
      if (error) throw new Error(`${tabela} delete failed: ${error.message}`)
      console.log(`   ✅ ${tabela} obrisano`)
    }
  }

  if (zastavice.samoBrisanje) {
    console.log("\n✅ Samo brisanje — uvoz preskočen.")
    return
  }

  // ── Excel ──────────────────────────────────────────────────────────────────
  console.log("\n📁 Excel:", EXCEL_PATH)
  console.log("🔄 Parsing Excel...")

  const parsed = await parseTehproExcel(EXCEL_PATH)

  console.log(`   Firme:   ${parsed.firme.length}`)
  console.log(`   Lokacije: ${parsed.lokacije.length}`)
  console.log(`   Vrste:   ${parsed.vrste.length}`)
  console.log(`   Termini: ${parsed.termini.length}`)
  console.log(`   Skipped: ${parsed.skipped.length}`)

  if (parsed.skipped.length > 0) {
    console.log(`⚠️  Skipped rows (first 5 od ${parsed.skipped.length}):`)
    parsed.skipped.slice(0, 5).forEach(s =>
      console.log(`   Sheet=${s.sheet} R${s.row} C${s.col}: ${s.reason}`)
    )
  }

  // ── 4) Upsert klijenti ─────────────────────────────────────────────────────
  console.log("\n💾 Upsert klijenti...")
  const klijentiRows = parsed.firme.map((naziv: string) => ({ naziv }))
  const { data: klijenti, error: kErr } = await supabase
    .from("klijenti")
    .upsert(klijentiRows, { onConflict: "naziv", ignoreDuplicates: false })
    .select("id, naziv")
  if (kErr) throw new Error(`klijenti upsert failed: ${kErr.message}`)
  const firmaMap = new Map<string, string>((klijenti ?? []).map(k => [k.naziv, k.id]))
  console.log(`   ✅ ${firmaMap.size} klijenata (firmi) u bazi`)

  // ── 5) Upsert vrste_provjera ───────────────────────────────────────────────
  console.log("\n💾 Upsert vrste_provjera...")
  // NOTE: podrazumevani_interval_mjeseci se NE postavlja — ostaje NULL.
  // Korisnik ga unosi u /postavke.
  const vrsteRows = parsed.vrste.map((naziv: string) => ({ naziv }))
  const { data: vrste, error: vErr } = await supabase
    .from("vrste_provjera")
    .upsert(vrsteRows, { onConflict: "naziv", ignoreDuplicates: false })
    .select("id, naziv")
  if (vErr) throw new Error(`vrste_provjera upsert failed: ${vErr.message}`)
  const vrstaMap = new Map<string, string>((vrste ?? []).map(v => [v.naziv, v.id]))
  console.log(`   ✅ ${vrstaMap.size} vrsta provjera u bazi`)

  // ── 6) Upsert lokacije ─────────────────────────────────────────────────────
  console.log("\n💾 Upsert lokacije...")
  type LokacijaRow = { klijent_id: string; naziv: string; grad: string | null }
  const lokacijeRows: LokacijaRow[] = []
  const lokSkipped: string[] = []

  for (const lok of parsed.lokacije) {
    const klijentId = firmaMap.get(lok.firma_naziv)
    if (!klijentId) {
      lokSkipped.push(`${lok.firma_naziv} / ${lok.lokacija_naziv}`)
      continue
    }
    lokacijeRows.push({ klijent_id: klijentId, naziv: lok.lokacija_naziv, grad: lok.grad })
  }

  if (lokSkipped.length > 0) {
    console.warn(`   ⚠️ ${lokSkipped.length} lokacija preskočeno (firma not in DB):`)
    lokSkipped.slice(0, 5).forEach(s => console.warn(`      ${s}`))
  }

  // Upsert in batches (onConflict = uq_lokacije_klijent_naziv unique index)
  const lokMap = new Map<string, string>() // "firmaId|lokNaziv" -> lokacijaId
  for (let i = 0; i < lokacijeRows.length; i += BATCH) {
    const batch = lokacijeRows.slice(i, i + BATCH)
    const { data: upsertedLok, error: lErr } = await supabase
      .from("lokacije")
      .upsert(batch, { onConflict: "klijent_id,naziv", ignoreDuplicates: false })
      .select("id, klijent_id, naziv")
    if (lErr) throw new Error(`lokacije upsert failed: ${lErr.message}`)
    for (const l of upsertedLok ?? []) {
      lokMap.set(`${l.klijent_id}|${l.naziv}`, l.id)
    }
  }
  console.log(`   ✅ ${lokMap.size} lokacija u bazi`)

  // ── 7) Insert termini ──────────────────────────────────────────────────────
  console.log("\n💾 Inserting termini...")

  type TerminIzvrseno = {
    klijent_id: string
    lokacija_id: string | null
    vrsta_provjere_id: string
    datum_zadnjeg: string
    datum_izvrsenja: string
    rok_dospijeca: string
    status: "izvrseno"
  }
  type TerminPlanirano = {
    klijent_id: string
    lokacija_id: string | null
    vrsta_provjere_id: string
    datum_zakazan: string
    rok_dospijeca: string
    status: "planirano"
  }
  type TerminRow = TerminIzvrseno | TerminPlanirano

  const terminiRows: TerminRow[] = []
  const terminiSkippedFK: string[] = []
  const todayStr = todayIso() // "YYYY-MM-DD", zidni datum u APP_TIME_ZONE (Europe/Belgrade)

  for (const t of parsed.termini) {
    const klijentId = firmaMap.get(t.firma_naziv)
    const vrstaId = vrstaMap.get(t.vrsta_naziv)

    if (!klijentId || !vrstaId) {
      terminiSkippedFK.push(`${t.firma_naziv} / ${t.vrsta_naziv}`)
      continue
    }

    // Resolve lokacija_id (nullable)
    let lokacijaId: string | null = null
    if (t.lokacija_naziv != null) {
      lokacijaId = lokMap.get(`${klijentId}|${t.lokacija_naziv}`) ?? null
    }

    // chk_termini_datumi: datum_izvrsenja <= CURRENT_DATE
    // Future "izvrseno" dates in Excel are treated as planirano to satisfy the constraint.
    const isReallyIzvrseno = t.izvor === "izvrseno" && t.datum <= todayStr

    if (isReallyIzvrseno) {
      // PAŽNJA (od 2026-07-30): auto-ciklus se okida i na INSERT-u termina sa
      // `status: "izvrseno"`, ne samo na prelazu u izvršeno. Na djevičanskom importu je
      // bezopasno — vrste provjere još nemaju `interval_mjeseci`, pa trigger nema šta da
      // izračuna. Ali ponovni seed NAKON što admin podesi podrazumijevane intervale
      // generiše naredne termine koji dupliraju planirane redove iz samog Excela.
      // Lijek poslije takvog re-importa: `pnpm dedup:termini`.
      terminiRows.push({
        klijent_id: klijentId,
        lokacija_id: lokacijaId,
        vrsta_provjere_id: vrstaId,
        datum_zadnjeg: t.datum,
        datum_izvrsenja: t.datum,
        // rok_dospijeca NOT NULL — use same date (trigger tg_termini_compute_rok
        // may overwrite if interval is set, but seed leaves interval NULL)
        rok_dospijeca: t.datum,
        status: "izvrseno",
      })
    } else {
      terminiRows.push({
        klijent_id: klijentId,
        lokacija_id: lokacijaId,
        vrsta_provjere_id: vrstaId,
        datum_zakazan: t.datum,
        rok_dospijeca: t.datum,
        status: "planirano",
      })
    }
  }

  if (terminiSkippedFK.length > 0) {
    console.warn(`   ⚠️ ${terminiSkippedFK.length} termina preskočeno (missing FK — first 5):`)
    terminiSkippedFK.slice(0, 5).forEach(s => console.warn(`      ${s}`))
  }

  let inserted = 0
  for (let i = 0; i < terminiRows.length; i += BATCH) {
    const batch = terminiRows.slice(i, i + BATCH)
    const { error: tErr, count } = await supabase
      .from("termini")
      .insert(batch, { count: "exact" })
    if (tErr) throw new Error(`termini insert failed at batch ${Math.floor(i / BATCH) + 1}: ${tErr.message}`)
    inserted += count ?? batch.length
  }
  console.log(`   ✅ ${inserted} termina insertovano`)

  console.log(`\n✅ Seed gotov na ${okruzenje.toUpperCase()}.`)
  console.log(
    `   Firme: ${firmaMap.size} | Lokacije: ${lokMap.size} | Vrste: ${vrstaMap.size} | Termini: ${inserted} | Skipped Excel: ${parsed.skipped.length}`
  )
}

// Skripta se i importuje (test guarda), pa main() ide samo kad je pokrenuta direktno.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch(err => {
    console.error("❌ Seed failed:", err)
    process.exit(1)
  })
}
