export const DOKUMENT_TIPOVI = [
  "strucni_nalaz",
  "zapisnik",
  "ugovor",
  "ponuda",
  "fotografija",
  "ostalo",
] as const
export type DokumentTip = (typeof DOKUMENT_TIPOVI)[number]

export function jeValidanTip(t: string): t is DokumentTip {
  return (DOKUMENT_TIPOVI as readonly string[]).includes(t)
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "dokument"
}

type DokumentScope =
  | { klijentId: string }
  | { ugovorId: string }
  | { terminId: string }

/** Storage putanja po vezi dokumenta. Prefiks bira kontekst (klijent/ugovor/termin). */
export function dokumentStoragePath(scope: DokumentScope, filename: string): string {
  const naziv = safeName(filename)
  const rand = crypto.randomUUID()
  if ("klijentId" in scope) return `klijenti/${scope.klijentId}/${rand}-${naziv}`
  if ("ugovorId" in scope) return `ugovori/${scope.ugovorId}/${rand}-${naziv}`
  return `termini/${scope.terminId}/${rand}-${naziv}`
}
