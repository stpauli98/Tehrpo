/**
 * Ciste funkcije za CLI opcije i git-izlaz koje koristi scripts/provjeri-integraciju.ts.
 * vitest.config.ts ne obuhvata scripts/, pa ova logika mora zivjeti ovdje, testirana —
 * treca runda je ovo ostavila u ljusci i odmah unijela defekt (izgubljen `.sql` filter
 * pod --sve, tiho gutanje nepoznatih zastavica). Ljuska smije samo pozvati ove funkcije,
 * pokrenuti `git`/`readdir`/`readFile` i ispisati rezultat — bez dodira s diskom, mrezom
 * i process.env ovdje.
 *
 * VAZNO — `core.quotePath` (podrazumijevano `true` u gitu): bez `-z`, i `git diff
 * --name-only` i `git status --porcelain` C-escapuju ne-ASCII imena i omotaju ih u
 * navodnike (npr. `"...20260728990031_\304\215\305\241\304\207\305\276\304\221.sql"` za
 * fajl s `cscz` dijakritikom u imenu) — u repou ciji je domenski jezik BCS latinica to
 * NIJE egzoticno. `-z` NIKAD ne navodi/escapuje (potvrdjeno rucnim testom: sirovi UTF-8
 * bajtovi, NUL-terminated zapisi), pa sve funkcije ovdje ocekuju `-z` izlaz. Rename/copy
 * zapisi u `git status --porcelain -z` imaju DRUGACIJI oblik od `git diff --name-only -z`
 * (potonji, sa `--name-only`, uvijek daje JEDNO polje po fajlu cak i za preimenovanja —
 * potvrdjeno rucnim testom; `status --porcelain -z` daje DVA uzastopna NUL-terminated
 * polja za R/C zapise: `XY noviPut`, pa ODVOJENO `originalniPut`) — v.
 * `parsirajGitStatusPorcelainZ`.
 */

export type Opcije = { sve: boolean; baza: string }

export type RezultatParsiranja =
  | { ok: true; opcije: Opcije; upozorenje: string | null }
  | { ok: false; poruka: string }

const BAZA_PODRAZUMIJEVANA = "origin/main"

/**
 * Parsira argumente (npr. `process.argv.slice(2)`). Nepoznata zastavica ili `--baza`
 * bez vrijednosti su GRESKA (`ok:false`) — ne tiho ignorisanje koje bi palo u uski
 * podrazumijevani rezim i lazno prijavilo "cisto". `--sve` uz `--baza` je dozvoljeno,
 * ali se `baza` tada ignorise (--sve cita cijeli direktorij, bez obzira na git) —
 * `upozorenje` nosi tu poruku da se ne cuti.
 */
export function parsirajOpcije(argovi: readonly string[]): RezultatParsiranja {
  let sve = false
  let baza: string | undefined
  for (let i = 0; i < argovi.length; i++) {
    const a = argovi[i]
    if (a === undefined) continue
    // `--` je konvencionalni separator ("sve poslije ovoga je za skriptu"). Neki
    // pokretaci (npr. `pnpm run x -- --sve`, zavisno od verzije) ga NE skinu prije
    // proslijedjivanja u argv skripte — tiho ga preskacemo umjesto da ga tretiramo kao
    // nepoznatu zastavicu.
    if (a === "--") {
      continue
    }
    if (a === "--sve") {
      sve = true
    } else if (a === "--baza") {
      const vrijednost = argovi[i + 1]
      if (vrijednost === undefined) {
        return { ok: false, poruka: "--baza zahtijeva vrijednost (npr. --baza origin/main)" }
      }
      baza = vrijednost
      i++
    } else {
      return {
        ok: false,
        poruka: `nepoznata zastavica "${a}" — dozvoljeno: --sve, --baza <ref>`,
      }
    }
  }

  const upozorenje =
    sve && baza !== undefined
      ? `--baza "${baza}" je ignorisan jer je --sve postavljen — provjerava se CIJELA istorija migracija, ne git diff prema toj grani`
      : null

  return { ok: true, opcije: { sve, baza: baza ?? BAZA_PODRAZUMIJEVANA }, upozorenje }
}

/** Samo `.sql` imena, sortirano — koristi --sve grana (cita cijeli direktorij preko
 *  readdir) da se npr. README.md ne procita kao migracija (prosli defekt: netacan broj
 *  u obuhvatu, i EISDIR pad kad je stavka poddirektorij umjesto fajla — potonje se
 *  rjesava time da pozivalac uopste ne uvrsti direktorije u `imena`, v. scripts/). */
export function filtrirajSqlImena(imena: readonly string[]): string[] {
  return imena.filter((ime) => ime.endsWith(".sql")).sort()
}

/** Direktorij migracija, repo-relativno — jedina lokacija koju obuhvat gleda. */
const PREFIKS_MIGRACIJA = "supabase/migrations/"

/** Repo-relativne putanje suzene na `supabase/migrations/*.sql` — zajednicka logika za
 *  (parsiran) izlaz `git diff --name-only -z` i `git status --porcelain -z`.
 *  `startsWith` (ne `includes`) je bitan: `docs/supabase/migrations/x.sql` NIJE
 *  migracija i ne smije uci u obuhvat. */
export function filtrirajMigracijskePutanje(putanje: readonly string[]): string[] {
  return putanje.filter((p) => p.startsWith(PREFIKS_MIGRACIJA) && p.endsWith(".sql"))
}

/**
 * Suzi obuhvat na putanje koje STVARNO postoje na disku (`postojecaImena` = imena
 * fajlova u `supabase/migrations`, v. `imenaUMigracijama` u scripts/).
 *
 * ZASTO: obuhvat je unija `git diff <baza>...HEAD` (sta grana donosi) i `git status`
 * (sta je u radnom stablu). Kad se KOMITOVANA migracija preimenuje ili obrise, `git
 * diff` je i dalje vidi pod STARIM imenom (HEAD ga jos ima), a stari fajl vise nije na
 * disku — bezuslovno citanje takve putanje puca sa ENOENT i prekida CIJELU provjeru,
 * pa nestaju i nalazi koji su vec bili prijavljeni. Gore od toga: `git mv` je tacno
 * radni tok koji alat sam propisuje kao popravku za `sudar-migracija`, pa bi alat
 * pukao bas u trenutku kad se njegov nalaz ispravlja.
 *
 * `git status` sam po sebi NIJE dovoljna zastita: obrisan fajl ima status `D` (parser
 * ga izbacuje), a rename daje NOVI put — ali stari put u obuhvat ulazi iz `git diff`
 * grane, ne iz statusa, pa se mora oduzeti ovdje.
 */
export function zadrziPostojeceMigracije(
  putanje: readonly string[],
  postojecaImena: readonly string[],
): string[] {
  const postoje = new Set(postojecaImena.map((ime) => `${PREFIKS_MIGRACIJA}${ime}`))
  return putanje.filter((p) => postoje.has(p))
}

/**
 * Parsira `git diff --name-only -z` izlaz (NUL-terminated, bez navodnika/escape-a) u
 * listu putanja. `--name-only` (za razliku od `--name-status`) daje JEDNO polje po
 * fajlu cak i za preimenovanja — potvrdjeno rucnim testom — pa ovdje NEMA posebnog
 * slucaja za rename kakav postoji u `parsirajGitStatusPorcelainZ`.
 */
export function parsirajGitDiffNameOnly(izlaz: string): string[] {
  return izlaz.split("\0").filter((p) => p.length > 0)
}

/**
 * Parsira `git status --porcelain -z` (v1 format, `-z`) u listu putanja — untracked
 * (`??`), staged i modified. Obrisani fajlovi (status sadrzi `D`) se izbacuju (nema sta
 * procitati sa diska).
 *
 * Rename/copy zapis (status pocinje sa `R` ili `C`) ima DRUGACIJI oblik u `-z` modu —
 * DVA uzastopna NUL-terminated polja: prvo `XY noviPut` (ovo polje), pa ODVOJENO,
 * BEZ prefiksa, `originalniPut` kao svoje vlastito polje (potvrdjeno rucnim testom:
 * `git status --porcelain -z` na preimenovanju daje `R  novi.sql\0stari.sql\0`, ne
 * `R  stari.sql -> novi.sql\0` kako je slucaj bez `-z`). Uzimamo NOVI put i
 * KONZUMIRAMO (preskacemo) sljedece polje da se ne protumaci kao vlastiti zapis.
 *
 * POZNATO OGRANICENJE (namjerno, zabiljezeno — ne rjesava se): untracked *poddirektorij*
 * se u porcelain izlazu sazima na jedan zapis (`?? put/do/direktorija/`), bez
 * pojedinacnih fajlova unutra — `.sql` fajl u novom, jos neispracenom poddirektorijumu
 * nece uci u obuhvat. Migracije ne zive u poddirektorijima (v. `imenaUMigracijama` u
 * scripts/), pa ovo u praksi ne dolazi do izrazaja.
 */
export function parsirajGitStatusPorcelainZ(izlaz: string): string[] {
  const polja = izlaz.split("\0").filter((p) => p.length > 0)
  const putanje: string[] = []
  for (let i = 0; i < polja.length; i++) {
    const polje = polja[i]
    if (polje === undefined || polje.length < 4) continue
    const status = polje.slice(0, 2)
    const put = polje.slice(3)
    if (status[0] === "R" || status[0] === "C") {
      i++ // sljedece polje je originalni put (bez XY prefiksa) — konzumiraj, ne treba nam
    }
    if (status.includes("D")) continue
    putanje.push(put)
  }
  return putanje
}

/** Unija dvije liste putanja, dedupovano i sortirano — koristi se za spajanje
 *  commitovanog (`git diff`) i necommitovanog (`git status`) obuhvata migracija; isti
 *  fajl u OBJE liste (npr. commitovan NA grani, pa dodatno izmijenjen u radnom stablu)
 *  se pojavljuje samo jednom. */
export function spojiPutanje(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort()
}

/** Windows `\` separatori → `/` — `path.relative` na Windows-u vraca `\`-odvojene
 *  putanje; `Izvor.putanja` mora uvijek biti `/`-odvojena (pravila.ts poredi prefikse
 *  poput `putanja.startsWith("app/")`). Na macOS/Linux je ovo no-op (nema `\` u
 *  putanjama). */
export function normalizujPutanju(putanja: string): string {
  return putanja.split("\\").join("/")
}

/** Da li ime fajla odgovara `.ts`/`.tsx` izvoru — koristi ga skupljanje TS/TSX izvora u
 *  ljusci (fs-obilazak ostaje u scripts/, ova odluka o imenu je cista i testirana
 *  nezavisno od diska). */
export function jeTsIzvor(ime: string): boolean {
  return /\.tsx?$/.test(ime)
}
