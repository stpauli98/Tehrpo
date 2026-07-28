/**
 * Čiste funkcije za CLI opcije i git-izlaz koje koristi scripts/provjeri-integraciju.ts.
 * vitest.config.ts ne obuhvata scripts/, pa ova logika mora živjeti ovdje, testirana —
 * prošla runda je ovo ostavila u ljusci i odmah unijela defekt (izgubljen `.sql` filter
 * pod --sve, tiho gutanje nepoznatih zastavica). Ljuska smije samo pozvati ove funkcije,
 * pokrenuti `git`/`readdir`/`readFile` i ispisati rezultat — bez dodira s diskom, mrežom
 * i process.env ovdje.
 */

export type Opcije = { sve: boolean; baza: string }

export type RezultatParsiranja =
  | { ok: true; opcije: Opcije; upozorenje: string | null }
  | { ok: false; poruka: string }

const BAZA_PODRAZUMIJEVANA = "origin/main"

/**
 * Parsira argumente (npr. `process.argv.slice(2)`). Nepoznata zastavica ili `--baza`
 * bez vrijednosti su GREŠKA (`ok:false`) — ne tiho ignorisanje koje bi palo u uski
 * podrazumijevani režim i lažno prijavilo "čisto" (tačno ta klasa kvara koju je
 * prošla runda trebala zatvoriti, a nije). `--sve` uz `--baza` je dozvoljeno, ali se
 * `baza` tada ignoriše (--sve čita cijeli direktorij, bez obzira na git) — `upozorenje`
 * nosi tu poruku da se ne ćuti.
 */
export function parsirajOpcije(argovi: readonly string[]): RezultatParsiranja {
  let sve = false
  let baza: string | undefined
  for (let i = 0; i < argovi.length; i++) {
    const a = argovi[i]
    if (a === undefined) continue
    // `--` je konvencionalni separator ("sve poslije ovoga je za skriptu"). Neki
    // pokretači (npr. `pnpm run x -- --sve`, zavisno od verzije) ga NE skinu prije
    // prosljeđivanja u argv skripte — tiho ga preskačemo umjesto da ga tretiramo kao
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

/** Samo `.sql` imena, sortirano — koristi --sve grana (čita cijeli direktorij preko
 *  readdir) da se npr. README.md ne pročita kao migracija (prošli defekt: netačan broj
 *  u obuhvatu, i EISDIR pad kad je stavka poddirektorij um jesto fajla — potonje se
 *  rješava time da pozivalac uopšte ne uvrsti direktorije u `imena`, v. scripts/). */
export function filtrirajSqlImena(imena: readonly string[]): string[] {
  return imena.filter((ime) => ime.endsWith(".sql")).sort()
}

/** Repo-relativne putanje suzene na `supabase/migrations/*.sql` — zajednička logika za
 *  izlaz `git diff --name-only` i (parsiran) izlaz `git status --porcelain`. */
export function filtrirajMigracijskePutanje(putanje: readonly string[]): string[] {
  return putanje.filter((p) => p.startsWith("supabase/migrations/") && p.endsWith(".sql"))
}

/**
 * Parsira `git status --porcelain` (format v1) u listu putanja — untracked (`??`),
 * staged i modified. Obrisani fajlovi (status sadrži `D`) se izbacuju (nema šta
 * pročitati sa diska). Rename zapis (`R  stara -> nova`) uzima NOVU putanju. Putanje
 * u navodnicima (git ih tako ispiše kad sadrže specijalne karaktere) se otkidaju.
 *
 * Vraća SVE putanje iz izlaza (ne samo migracije) — suženje na
 * `supabase/migrations/*.sql` radi `filtrirajMigracijskePutanje` odvojeno, da ova
 * funkcija ostane generički parser jednog formata, testiran nezavisno od domena.
 */
export function parsirajGitStatusPorcelain(izlaz: string): string[] {
  const putanje: string[] = []
  for (const red of izlaz.split("\n")) {
    if (red.length < 4) continue
    const status = red.slice(0, 2)
    if (status.includes("D")) continue
    const dioPuta = red.slice(3)
    const zadnji = dioPuta.includes(" -> ") ? dioPuta.split(" -> ").at(-1) : dioPuta
    if (zadnji === undefined) continue
    putanje.push(zadnji.replace(/^"|"$/g, ""))
  }
  return putanje
}
