// Disklejmer u DEMO režimu se prikazuje jednom po prijavi: ključ u sessionStorage
// znači „potvrđeno", a /prijava ga briše na mount pa svaka nova prijava ponovo
// prikazuje modal. Storage može biti nedostupan (SSR, strogi privatni režim) ili
// bacati na pristup — tada namjerno biramo „prikaži" (bolje previše nego premalo).
export const DISKLEJMER_KLJUC = "demo-disklejmer-potvrdjen"

export function bezbjedniSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function trebaPrikazatiDisklejmer(storage: Storage | null): boolean {
  if (!storage) return true
  try {
    return storage.getItem(DISKLEJMER_KLJUC) === null
  } catch {
    return true
  }
}

export function potvrdiDisklejmer(storage: Storage | null): void {
  try {
    storage?.setItem(DISKLEJMER_KLJUC, "1")
  } catch {
    // namjerno progutano — bez storage-a modal se prikazuje ponovo, što je prihvatljivo
  }
}

export function ponistiDisklejmer(storage: Storage | null): void {
  try {
    storage?.removeItem(DISKLEJMER_KLJUC)
  } catch {
    // namjerno progutano
  }
}
