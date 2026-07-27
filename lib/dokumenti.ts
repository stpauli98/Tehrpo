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

// ─── Upload ograničenja: JEDAN izvor za server i klijent (S8.5) ───────────────
// Modul je client-safe (bez `server-only`) da isti limiti važe i u formama.

export const ALLOWED_MIME = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const

export const MAX_MB = 10
/** 10 MiB — ispod `serverActions.bodySizeLimit=12mb` iz `next.config.ts`. */
export const MAX_BYTES = MAX_MB * 1024 * 1024

/** MIME → ekstenzija za `accept` atribut; `image/*` prolazi kao MIME. */
const MIME_EKSTENZIJA: Partial<Record<(typeof ALLOWED_MIME)[number], string>> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/pdf": ".pdf",
}

/** Vrijednost `accept` atributa file inputa, izvedena iz `ALLOWED_MIME`. */
export const ACCEPT_ATTR = ALLOWED_MIME.map((mime) => MIME_EKSTENZIJA[mime] ?? mime).join(",")

/** Čista klijentska/serverska provjera fajla prije uploada. */
export function validirajFajl(f: { type: string; size: number }):
  | { ok: true }
  | { ok: false; razlog: "tip" | "velicina" } {
  if (!(ALLOWED_MIME as readonly string[]).includes(f.type)) return { ok: false, razlog: "tip" }
  if (f.size > MAX_BYTES) return { ok: false, razlog: "velicina" }
  return { ok: true }
}

/** Sanitizacija imena fajla za storage ključ (razmak je dozvoljen — čitljivija imena). */
export function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "dokument"
}

type DokumentScope =
  | { klijentId: string }
  | { terminId: string }

/** Storage putanja po vezi dokumenta. Prefiks bira kontekst (klijent/termin). */
export function dokumentStoragePath(scope: DokumentScope, filename: string): string {
  const naziv = safeName(filename)
  const rand = crypto.randomUUID()
  if ("klijentId" in scope) return `klijenti/${scope.klijentId}/${rand}-${naziv}`
  return `termini/${scope.terminId}/${rand}-${naziv}`
}
