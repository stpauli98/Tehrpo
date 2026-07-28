/**
 * Provjere nad imenima fajlova u supabase/migrations.
 *
 * Postoji zato što dvije grane mogu nezavisno napraviti migraciju s istim
 * timestamp prefiksom. Imena fajlova se razlikuju, pa git spaja bez konflikta
 * i oba PR-a prolaze — a redoslijed primjene postaje nedefinisan. Na cloud se
 * migracije primjenjuju ručno, jedna po jedna, pa ništa ne garantuje da su
 * obje stigle prije koda koji ih očekuje.
 *
 * Čisto nad podacima: bez dodira s diskom, mrežom i process.env.
 */

export type SudarMigracija = {
  prefiks: string
  fajlovi: string[]
}

const PREFIKS = /^(\d{14})_/

/** 14-cifreni timestamp s početka imena, ili null ako ga nema. */
export function izdvojiPrefiks(imeFajla: string): string | null {
  return PREFIKS.exec(imeFajla)?.[1] ?? null
}

/** Prefiksi koje dijeli više od jednog fajla. Sortirano, stabilno. */
export function nadjiSudarenePrefikse(imenaFajlova: string[]): SudarMigracija[] {
  const poPrefiksu = new Map<string, string[]>()

  for (const ime of imenaFajlova) {
    const prefiks = izdvojiPrefiks(ime)
    if (prefiks === null) continue
    poPrefiksu.set(prefiks, [...(poPrefiksu.get(prefiks) ?? []), ime])
  }

  return [...poPrefiksu.entries()]
    .filter(([, fajlovi]) => fajlovi.length > 1)
    .map(([prefiks, fajlovi]) => ({ prefiks, fajlovi: [...fajlovi].sort() }))
    .sort((a, b) => a.prefiks.localeCompare(b.prefiks))
}

/**
 * Fajl iz sudara na koji se nalaz prijavljuje — onaj koji treba PREIMENOVATI.
 *
 * Sudarene fajlove `nadjiSudarenePrefikse` vraća abecedno, a abecedno prvi je po pravilu
 * ZATEČENA, nedužna migracija (već je u `main`-u); preimenovati treba onu koju grana
 * donosi. Zato: ako je ijedan od sudarenih fajlova u obuhvatu izmijenjenih (`uObuhvatu`
 * = imena fajlova, ne putanje), bira se on. Kad ih je više u obuhvatu, ili kad obuhvat
 * ne zna nijedan (npr. `--sve`, ili sudar zatečen na baznoj grani), bira se abecedno
 * POSLJEDNJI — pošto sudarene migracije dijele identičan 14-cifreni prefiks, poređenje
 * pada na ostatak imena, pa je to determinističan izbor, a ne prvi (nedužni).
 *
 * `fajlovi` je uvijek neprazan (sudar po definiciji ima bar dva fajla); prazan ulaz
 * vraća prazan string umjesto da baca — pozivalac ga nikad ne proizvodi.
 */
export function odaberiFajlZaPrijavu(
  fajlovi: readonly string[],
  uObuhvatu: ReadonlySet<string>,
): string {
  const kandidati = fajlovi.filter((f) => uObuhvatu.has(f))
  const izbor = (kandidati.length > 0 ? kandidati : fajlovi).reduce<string | undefined>(
    (najveci, f) => (najveci === undefined || f.localeCompare(najveci) > 0 ? f : najveci),
    undefined,
  )
  return izbor ?? ""
}

/** .sql fajlovi bez ispravnog timestamp prefiksa — redoslijed im je nedefinisan. */
export function nadjiNeispravnaImena(imenaFajlova: string[]): string[] {
  return imenaFajlova
    .filter((ime) => ime.endsWith(".sql") && izdvojiPrefiks(ime) === null)
    .sort()
}
