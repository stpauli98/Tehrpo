/**
 * GC: čišćenje ORPHAN fajlova iz Storage bucketa (tehpro-dokumenti).
 * Orphan = fajl u bucketu bez reda u tabeli `dokumenti`.
 *
 * Default = DRY-RUN (samo izvještaj; ništa se ne briše).
 * Stvarno brisanje:        pnpm gc:dokumenti -- --apply
 * Grace (ne diraj svjež):  pnpm gc:dokumenti -- --grace-hours=24   (default 24)
 * Bez ograda (opasno):     pnpm gc:dokumenti -- --apply --zanemari-ograde
 *
 * Slomljeni redovi (red u bazi, fajl fali) se SAMO prijavljuju — nikad ne brišu.
 *
 * ── N14 ─────────────────────────────────────────────────────────────────────────────────
 * Ova skripta i noćni cron (`app/api/cron/ciscenje-storagea/route.ts`) rade ISTI nepovratan
 * posao nad ISTIM bucketom, pa moraju dijeliti i ISTE ograde. Ranije je skripta zvala
 * `analizirajOrphan` direktno i time preskakala sve tri ograde iz `lib/dokumenti/sweep.ts`
 * (prazna baza uz pun bucket, udio kandidata > 50%, plafon po prolazu) — dakle upravo one
 * situacije u kojima je ulaz očigledno pokvaren. Ručno pokretanje nije „bezopasnije" od
 * cron-a: čovjek ga pokreće rijetko, obično kad nešto već ne valja, i bez izlaza iz kojeg bi
 * se poslije vidjelo šta je nestalo.
 *
 * Zato odluku sada donosi ISKLJUČIVO `odluciSta` iz `lib/dokumenti/sweep.ts` — ista čista
 * funkcija koju zove i cron. Kad ona kaže `prekid`, skripta ne briše ništa i izlazi statusom
 * 1. Jedini način da se ograde zaobiđu je eksplicitan `--zanemari-ograde`, koji uz `--apply`
 * traži i ukucanu potvrdu sa terminala (v. `POTVRDNA_RIJEC`).
 *
 * Drugi dio istog nalaza: broj obrisanih se uzima iz ODGOVORA `remove()` (`data.length`), ne
 * iz `grupa.length`. `remove()` nad putanjom koje nema u bucketu vraća `data: []` bez greške,
 * pa je stari brojač prijavljivao NAMJERU — „Obrisano 58" i kad nije obrisano ništa.
 */
import { createInterface } from "node:readline/promises"
import { createAdminSupabaseClient } from "../lib/supabase/admin"
import { analizirajOrphan, type StorageObjekat } from "../lib/dokumenti-gc"
import { listajFajlove, svePutanjeUBazi, DOKUMENTI_BUCKET } from "../lib/dokumenti/popis"
import { odluciSta, MAX_UDIO_BRISANJA, MAX_PO_PROLAZU } from "../lib/dokumenti/sweep"

type Sb = ReturnType<typeof createAdminSupabaseClient>

const PAGE = 100

/** Tačan tekst koji korisnik mora ukucati da bi `--zanemari-ograde` stvarno brisao. */
export const POTVRDNA_RIJEC = "ZANEMARI OGRADE"

export type Opcije = {
  apply: boolean
  graceHours: number
  zanemariOgrade: boolean
}

export type Parsiranje = { ok: true; opcije: Opcije } | { ok: false; greska: string }

export function parsirajArgumente(argv: string[]): Parsiranje {
  const apply = argv.includes("--apply")
  const zanemariOgrade = argv.includes("--zanemari-ograde")
  const graceArg = argv.find((a) => a.startsWith("--grace-hours="))
  const graceHours = graceArg ? Number(graceArg.split("=")[1]) : 24

  if (!Number.isFinite(graceHours) || graceHours <= 0) {
    return {
      ok: false,
      greska:
        `Neispravan --grace-hours: "${graceArg?.split("=")[1] ?? ""}". ` +
        `Mora biti pozitivan broj (npr. --grace-hours=24).`,
    }
  }
  return { ok: true, opcije: { apply, graceHours, zanemariOgrade } }
}

/**
 * Ishod jednog prolaza — vraća se i testovima, da se ponašanje skripte može provjeriti bez
 * čitanja ispisa. `trazeno` je broj putanja poslatih u `remove()`, `obrisano` je broj koji je
 * Storage STVARNO potvrdio. Njihova razlika je signal (fajl je već nestao, ili nikad nije ni
 * postojao pod tom putanjom) i zato se prijavljuje odvojeno.
 */
export type Ishod =
  | { status: "prekid"; razlog: string }
  | { status: "odustao"; razlog: string }
  | { status: "probno"; kandidati: string[] }
  | { status: "obrisano"; trazeno: number; obrisano: number }

/** Potvrda sa terminala; izdvojena da je test može zamijeniti bez glumljenja stdin-a. */
export type TraziPotvrdu = (poruka: string) => Promise<string>

const potvrdaSaTerminala: TraziPotvrdu = async (poruka) => {
  // Neinteraktivan poziv (cron, CI, `| tee`) nema kome da postavi pitanje — tretira se kao
  // odbijena potvrda, nikad kao prećutni pristanak.
  if (!process.stdin.isTTY) return ""
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(poruka)).trim()
  } finally {
    rl.close()
  }
}

/**
 * Jedan prolaz GC-a. Sav I/O ide kroz `sb`; odluka ide kroz `odluciSta` (ista koju zove cron).
 * `sada` i `traziPotvrdu` se injektuju da bi prolaz bio determinističan u testu.
 */
export async function gcProlaz(
  sb: Sb,
  opcije: Opcije,
  traziPotvrdu: TraziPotvrdu = potvrdaSaTerminala,
  sada: number = Date.now(),
): Promise<Ishod> {
  const graceMs = opcije.graceHours * 60 * 60 * 1000

  // 1) svi fajlovi u bucketu (rekurzivno kroz klijenti/ ugovori/ termini/)
  //    2) sve putanje iz baze (keyset paginacija)
  //    Oba popisa dolaze iz lib/dokumenti/popis.ts — istu kopiju koristi i noćni cron.
  const bucketObjekti: StorageObjekat[] = await listajFajlove(sb)

  const { putanje: dbPutanje, error: popisGreska } = await svePutanjeUBazi(sb)
  if (popisGreska) throw new Error(`select dokumenti: ${popisGreska}`)

  console.log(`Bucket fajlova: ${bucketObjekti.length} · DB redova: ${dbPutanje.length}`)

  // 3) odluka — ISTA ograđena odluka koju donosi i noćni cron.
  //    Zabilježena brisanja (`za_brisanje_iz_storagea`) se namjerno NE prosljeđuju: ona
  //    ublažavaju ogradu po udjelu, a ručni prolaz treba da bude najstroža varijanta.
  const odluka = odluciSta(bucketObjekti, dbPutanje, sada, graceMs)
  const ulaz = { bucketObjekti, dbPutanje, sada, graceMs }

  if (odluka.akcija === "prekid") {
    console.error(`\nPREKID: ${odluka.razlog}`)
    console.error(
      `Iste ograde ima i noćni cron (lib/dokumenti/sweep.ts): prazna tabela "dokumenti" uz pun\n` +
        `bucket, ili više od ${MAX_UDIO_BRISANJA * 100}% bucketa kao kandidat, znači da je ULAZ pokvaren\n` +
        `(pogrešan projekat/ključ, odsječen popis iz baze), ne da je bucket zaista smeće.`,
    )
    if (!opcije.zanemariOgrade) {
      console.error(`Ako si SIGURAN da je ulaz ispravan: pnpm gc:dokumenti -- --apply --zanemari-ograde`)
      return { status: "prekid", razlog: odluka.razlog }
    }
    return brisiBezOgrada(sb, ulaz, opcije, traziPotvrdu)
  }

  const r = analizirajOrphan(ulaz)
  console.log(`Orphan za brisanje (≥ ${opcije.graceHours}h): ${odluka.putanje.length}`)
  console.log(`Svjež orphan, preskočen (< ${opcije.graceHours}h): ${odluka.presvjezi.length}`)
  console.log(`Slomljeni redovi (fajl fali — SAMO PRIJAVA): ${odluka.slomljeniRedovi.length}`)
  for (const p of odluka.slomljeniRedovi) console.warn(`  ⚠ slomljen red → ${p}`)

  const odgodjeni = odluka.odgodjeni ?? []
  if (odgodjeni.length) {
    console.warn(
      `Odgođeno za sljedeći prolaz (plafon ${MAX_PO_PROLAZU} po prolazu / ograda po udjelu): ${odgodjeni.length}`,
    )
  }

  // Ograde nisu prekinule prolaz, ali jesu odsjekle dio kandidata (plafon / udio).
  if (opcije.zanemariOgrade && r.orphanFajlovi.length > odluka.putanje.length) {
    return brisiBezOgrada(sb, ulaz, opcije, traziPotvrdu)
  }

  if (!opcije.apply) {
    console.log("\nDRY-RUN — ništa nije obrisano. Za stvarno brisanje: pnpm gc:dokumenti -- --apply")
    for (const p of odluka.putanje) console.log(`  bi obrisao → ${p}`)
    return { status: "probno", kandidati: odluka.putanje }
  }

  return izvrsiBrisanje(sb, odluka.putanje)
}

/** Grana `--zanemari-ograde`: puna lista kandidata, ali samo uz ukucanu potvrdu. */
async function brisiBezOgrada(
  sb: Sb,
  ulaz: { bucketObjekti: StorageObjekat[]; dbPutanje: string[]; sada: number; graceMs: number },
  opcije: Opcije,
  traziPotvrdu: TraziPotvrdu,
): Promise<Ishod> {
  const kandidati = analizirajOrphan(ulaz).orphanFajlovi

  console.warn(`\n--zanemari-ograde: ograde su ISKLJUČENE, kandidata za brisanje: ${kandidati.length}`)
  for (const p of kandidati) console.warn(`  bi obrisao → ${p}`)

  if (!opcije.apply) {
    console.log("\nDRY-RUN — ništa nije obrisano (nedostaje --apply).")
    return { status: "probno", kandidati }
  }
  if (!kandidati.length) return { status: "obrisano", trazeno: 0, obrisano: 0 }

  const odgovor = await traziPotvrdu(
    `\nBrisanje je NEPOVRATNO (bucket drži zakonski obavezne zapisnike ZNR).\n` +
      `Obrisaće se ${kandidati.length} od ${ulaz.bucketObjekti.length} objekata u bucketu.\n` +
      `Ukucaj "${POTVRDNA_RIJEC}" za nastavak: `,
  )
  if (odgovor !== POTVRDNA_RIJEC) {
    const razlog = odgovor
      ? `potvrda nije tačna ("${odgovor}") — ništa nije obrisano`
      : `nema potvrde (neinteraktivan terminal ili prazan unos) — ništa nije obrisano`
    console.error(razlog)
    return { status: "odustao", razlog }
  }
  return izvrsiBrisanje(sb, kandidati)
}

/** Brisanje u grupama od 100; broj obrisanih dolazi iz ODGOVORA, ne iz namjere. */
async function izvrsiBrisanje(sb: Sb, putanje: string[]): Promise<Ishod> {
  let obrisano = 0
  for (let i = 0; i < putanje.length; i += PAGE) {
    const grupa = putanje.slice(i, i + PAGE)
    // Jedini trag o obrisanim fajlovima: tg_audit pokriva redove u `dokumenti`, ne storage
    // objekte. Bez ovog ispisa se poslije pogrešnog brisanja ne bi znalo ni ŠTA tražiti u backupu.
    console.warn(`brišem ${grupa.length} objekata:`, grupa)
    const { data, error: delErr } = await sb.storage.from(DOKUMENTI_BUCKET).remove(grupa)
    if (delErr) throw new Error(`remove batch: ${delErr.message}`)
    // remove() vraća STVARNO uklonjene objekte — grupa.length bi brojala namjeru.
    obrisano += data?.length ?? 0
  }
  console.log(`\nObrisano orphan fajlova: ${obrisano} (traženo: ${putanje.length})`)
  if (obrisano !== putanje.length) {
    console.warn(
      `Storage je potvrdio ${obrisano} od ${putanje.length} — razlika su putanje kojih u bucketu\n` +
        `više nema (već obrisane ili nikad nisu postojale pod tim imenom).`,
    )
  }
  return { status: "obrisano", trazeno: putanje.length, obrisano }
}

async function main() {
  const p = parsirajArgumente(process.argv)
  if (!p.ok) {
    console.error(p.greska)
    process.exit(1)
  }
  const ishod = await gcProlaz(createAdminSupabaseClient(), p.opcije)
  if (ishod.status === "prekid" || ishod.status === "odustao") process.exit(1)
}

// Pokreni SAMO kad je ovaj fajl stvarno ulazna tačka procesa; import iz testa ne smije ništa
// da uradi (stari oblik je zvao main() pri samom import-u, pa se skripta nije mogla testirati).
if ((process.argv[1] ?? "").includes("gc-orphan-dokumenti")) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
