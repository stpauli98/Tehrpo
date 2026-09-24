/**
 * C4: izvoz plana je do 02.08.2026. povlačio redove JEDNIM upitom bez `.range()`.
 * PostgREST na Supabase-u ima `max-rows = 1000`, pa je odgovor tiho odsijecan na
 * 1000 redova — a brojač iznad dugmeta (`count: "exact", head: true`) je javljao PUN
 * broj. Korisnik je preuzimao krnji plan i slao ga klijentu vjerujući da je cio.
 *
 * Ovdje živi straničenje: svaka stranica je ZASEBAN upit (statement_timeout je 8s —
 * jedan ogroman upit bi ga probio), i tvrda gornja granica iznad koje se izvoz ODBIJA
 * jasnom porukom umjesto da tiho isporuči krnji fajl.
 */

/**
 * Redova po stranici. Mora biti ≤ PostgREST `max-rows` (1000) — veći `range` bi bio
 * tiho skraćen na 1000 i straničenje bi opet gubilo redove. 500 drži jedan upit
 * duboko ispod 8s statement_timeout-a.
 */
export const IZVOZ_STRANICA = 500

/**
 * Najviše redova u jednom izvozu. Iznad ovoga izvoz se odbija (413) umjesto da se
 * generiše fajl koji niko ne može pročitati (a i PDF/XLSX generisanje bi probilo
 * memoriju/timeout serverless funkcije).
 */
export const IZVOZ_MAX_REDOVA = 5000

/** Ono što PostgREST vrati za jednu stranicu (samo dio koji nam treba). */
export type StranicaOdgovor<T> = { data: T[] | null; error: unknown }

/** Povlači redove [od, do] (uključivo, 0-bazirano) — tačno semantika `.range()`. */
export type PovuciStranicu<T> = (od: number, doIndeks: number) => PromiseLike<StranicaOdgovor<T>>

export type StranicenjeRezultat<T> =
  | { ok: true; redovi: T[] }
  | { ok: false; razlog: "greska"; error: unknown }
  | { ok: false; razlog: "previse"; granica: number }

/**
 * Povlači sve redove u stranicama dok ih ima.
 *
 * Prekida sa `razlog: "previse"` čim utvrdi da rezultat prelazi `maks` — traži se
 * najviše `maks + 1` redova, pa je jedan red preko granice dovoljan dokaz i nikad se
 * ne povlači ogroman skup samo da bi bio odbačen.
 *
 * `povuci` MORA imati stabilan, totalan poredak (npr. `.order(datum).order(id)`) —
 * bez jedinstvenog tie-breakera Postgres smije vratiti redove sa istim datumom u
 * različitom redoslijedu po stranici, pa bi se redovi duplirali i gubili.
 */
export async function povuciSveStranice<T>(
  povuci: PovuciStranicu<T>,
  opcije?: { stranica?: number; maks?: number },
): Promise<StranicenjeRezultat<T>> {
  const stranica = Math.max(1, opcije?.stranica ?? IZVOZ_STRANICA)
  const maks = Math.max(0, opcije?.maks ?? IZVOZ_MAX_REDOVA)
  const redovi: T[] = []

  let od = 0
  for (;;) {
    // Koliko još smijemo povući: maks + 1 (jedan „preko" je signal prekoračenja).
    const ostalo = maks + 1 - redovi.length
    if (ostalo <= 0) return { ok: false, razlog: "previse", granica: maks }

    const velicina = Math.min(stranica, ostalo)
    // Namjerno SEKVENCIJALNO: sljedeća stranica se traži tek kad znamo da prethodna
    // nije bila zadnja. Paralelizacija bi zahtijevala unaprijed poznat ukupan broj i
    // otvorila N upita odjednom prema istoj bazi.
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await povuci(od, od + velicina - 1)
    if (error) return { ok: false, razlog: "greska", error }

    const komad = data ?? []
    // Kraj je SAMO prazna stranica. Kraća-od-tražene stranica NIJE dokaz kraja: server
    // smije vratiti manje nego što je traženo (PostgREST `max-rows` je konfigurabilan i
    // može pasti ispod naše stranice) — zaustaviti se tu značilo bi vratiti isti tihi
    // gubitak redova zbog kojeg ova funkcija i postoji.
    if (komad.length === 0) break
    redovi.push(...komad)
    // Pomjeraj po STVARNO dobijenom broju redova, ne po traženom.
    od += komad.length
  }

  if (redovi.length > maks) return { ok: false, razlog: "previse", granica: maks }
  return { ok: true, redovi }
}
