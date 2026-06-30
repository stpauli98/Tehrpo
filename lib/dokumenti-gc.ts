// Pure reconciliation: uparuje bucket fajlove i dokumenti.storage_path.
// Bez I/O — vrijeme i grace se INJEKTUJU radi determinističnih testova.

export type StorageObjekat = { path: string; updatedAt: string } // ISO timestamp

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
    const starostMs = args.sada - Date.parse(o.updatedAt)
    if (starostMs >= args.graceMs) orphanFajlovi.push(o.path)
    else presvjeziOrphani.push(o.path)
  }

  const slomljeniRedovi = args.dbPutanje.filter((p) => !bucketSet.has(p))

  return { orphanFajlovi, presvjeziOrphani, slomljeniRedovi }
}
