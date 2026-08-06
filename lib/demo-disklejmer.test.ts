import { describe, it, expect } from "vitest"
import {
  DISKLEJMER_KLJUC,
  bezbjedniSessionStorage,
  trebaPrikazatiDisklejmer,
  potvrdiDisklejmer,
  ponistiDisklejmer,
} from "./demo-disklejmer"

// Minimalni in-memory Storage — vitest okruženje je node, nema window/sessionStorage.
function napraviStorage(): Storage {
  const mapa = new Map<string, string>()
  return {
    getItem: (k: string) => (mapa.has(k) ? mapa.get(k)! : null),
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
    clear: () => mapa.clear(),
    key: (i: number) => [...mapa.keys()][i] ?? null,
    get length() {
      return mapa.size
    },
  }
}

describe("demo-disklejmer", () => {
  it("prikazuje se kad ključ ne postoji, ne prikazuje se poslije potvrde", () => {
    const s = napraviStorage()
    expect(trebaPrikazatiDisklejmer(s)).toBe(true)
    potvrdiDisklejmer(s)
    expect(s.getItem(DISKLEJMER_KLJUC)).toBe("1")
    expect(trebaPrikazatiDisklejmer(s)).toBe(false)
  })

  it("poništavanje (nova prijava) vraća prikaz", () => {
    const s = napraviStorage()
    potvrdiDisklejmer(s)
    ponistiDisklejmer(s)
    expect(trebaPrikazatiDisklejmer(s)).toBe(true)
  })

  it("bez storage-a (null) uvijek prikazuje, a upisi ne pucaju", () => {
    expect(trebaPrikazatiDisklejmer(null)).toBe(true)
    expect(() => potvrdiDisklejmer(null)).not.toThrow()
    expect(() => ponistiDisklejmer(null)).not.toThrow()
  })

  it("storage koji baca izuzetak tretira se kao nedostupan", () => {
    const pokvaren = {
      getItem: () => {
        throw new Error("blokiran")
      },
      setItem: () => {
        throw new Error("blokiran")
      },
      removeItem: () => {
        throw new Error("blokiran")
      },
    } as unknown as Storage
    expect(trebaPrikazatiDisklejmer(pokvaren)).toBe(true)
    expect(() => potvrdiDisklejmer(pokvaren)).not.toThrow()
    expect(() => ponistiDisklejmer(pokvaren)).not.toThrow()
  })

  it("bezbjedniSessionStorage vraća null u node okruženju (nema window)", () => {
    expect(bezbjedniSessionStorage()).toBeNull()
  })
})
