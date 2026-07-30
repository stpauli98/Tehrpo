// Pure reconciliation: uparuje bucket fajlove i dokumenti.storage_path.
// Bez I/O — vrijeme i grace se INJEKTUJU radi determinističnih testova.

// `updatedAt` je ISO-8601 SA zonom (Supabase Storage vraća npr. "2026-07-30T12:00:00.000Z").
// Bez zone bi Date.parse tumačio string kao lokalno vrijeme i grace bi se pomjerio za offset.
export type StorageObjekat = { path: string; updatedAt: string }

export type GcRezultat = {
  orphanFajlovi: string[] // u bucketu, nema reda, dovoljno star → za brisanje
  presvjeziOrphani: string[] // orphan ali mlađi od grace → preskoči (in-flight zaštita)
  slomljeniRedovi: string[] // dokumenti.storage_path bez fajla → SAMO prijava
}

export function analizirajOrphan(args: {
  bucketObjekti: StorageObjekat[]
  dbPutanje: string[]
  sada: number
  graceMs: number
}): GcRezultat {
  const dbSet = new Set(args.dbPutanje)
  const bucketSet = new Set(args.bucketObjekti.map((o) => o.path))

  const orphanFajlovi: string[] = []
  const presvjeziOrphani: string[] = []
  for (const o of args.bucketObjekti) {
    if (dbSet.has(o.path)) continue
    const kreiran = Date.parse(o.updatedAt)
    if (Number.isNaN(kreiran)) {
      // Neparsibilan/nedostajući timestamp → fajl je ZAŠTIĆEN, nikad obrnuto. Ranije se na
      // ovo oslanjalo implicitno (NaN >= graceMs je uvijek false); grana je eksplicitna da
      // se pri refaktoru poređenja ne izgubi smjer u kojem se griješi.
      presvjeziOrphani.push(o.path)
      continue
    }
    const starostMs = args.sada - kreiran
    if (starostMs >= args.graceMs) orphanFajlovi.push(o.path)
    else presvjeziOrphani.push(o.path)
  }

  const slomljeniRedovi = args.dbPutanje.filter((p) => !bucketSet.has(p))

  return { orphanFajlovi, presvjeziOrphani, slomljeniRedovi }
}
