import { describe, it, expect } from "vitest"
import {
  povuciSveStranice,
  IZVOZ_STRANICA,
  IZVOZ_MAX_REDOVA,
  type PovuciStranicu,
} from "./stranicenje"

/**
 * Lažni PostgREST: vraća tražen opseg, ali NIKAD više od `maxRows` redova —
 * tačno ono što Supabase radi sa `max-rows = 1000` i zbog čega je izvoz tiho
 * gubio sve preko 1000 redova.
 */
function lazniKlijent(ukupno: number, maxRows = 1000) {
  const pozivi: Array<[number, number]> = []
  const povuci: PovuciStranicu<{ i: number }> = (od, doIndeks) => {
    pozivi.push([od, doIndeks])
    const trazeno = doIndeks - od + 1
    const kolicina = Math.min(trazeno, maxRows)
    const data = Array.from({ length: Math.max(0, Math.min(kolicina, ukupno - od)) }, (_, k) => ({
      i: od + k,
    }))
    return Promise.resolve({ data, error: null })
  }
  return { povuci, pozivi }
}

describe("povuciSveStranice", () => {
  it("prazan rezultat = nula redova, jedan upit", async () => {
    const { povuci, pozivi } = lazniKlijent(0)
    const r = await povuciSveStranice(povuci)
    expect(r).toEqual({ ok: true, redovi: [] })
    expect(pozivi).toEqual([[0, IZVOZ_STRANICA - 1]])
  })

  // Kratka stranica NIJE dokaz kraja (server smije vratiti manje nego što je traženo),
  // pa se kraj uvijek potvrđuje jednom praznom stranicom. Cijena: +1 sitan upit.
  it("manje od jedne stranice: svi redovi + potvrda praznom stranicom", async () => {
    const { povuci, pozivi } = lazniKlijent(7)
    const r = await povuciSveStranice(povuci)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.redovi).toHaveLength(7)
    expect(pozivi).toEqual([
      [0, IZVOZ_STRANICA - 1],
      [7, 7 + IZVOZ_STRANICA - 1],
    ])
  })

  it("PREKO 1000 redova se povuče CIJEL (regresija C4 — bez straničenja bi bilo 1000)", async () => {
    const { povuci, pozivi } = lazniKlijent(1234)
    const r = await povuciSveStranice(povuci, { stranica: 500 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.redovi).toHaveLength(1234)
    // Bez preskoka i bez duplikata: redom 0..1233.
    expect(r.redovi.map((x) => x.i)).toEqual(Array.from({ length: 1234 }, (_, i) => i))
    expect(pozivi).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499], // vrati 234
      [1234, 1733], // prazna → kraj
    ])
  })

  it("server koji vraća KRAĆE stranice od tražene ne smije prevariti kraj petlje", async () => {
    // max-rows = 200 iako tražimo 500 po stranici: naivno „kraće = kraj" dalo bi 200.
    const { povuci, pozivi } = lazniKlijent(1234, 200)
    const r = await povuciSveStranice(povuci, { stranica: 500 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.redovi).toHaveLength(1234)
    expect(r.redovi.map((x) => x.i)).toEqual(Array.from({ length: 1234 }, (_, i) => i))
    expect(pozivi[1]![0]).toBe(200) // sljedeći offset ide po STVARNO dobijenom broju
  })

  it("tačan višekratnik stranice traži još jednu (praznu) stranicu", async () => {
    const { povuci, pozivi } = lazniKlijent(1000)
    const r = await povuciSveStranice(povuci, { stranica: 500 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.redovi).toHaveLength(1000)
    expect(pozivi).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ])
  })

  it("nijedan pojedinačni upit ne traži više od PostgREST max-rows (1000)", async () => {
    const { povuci, pozivi } = lazniKlijent(4321)
    await povuciSveStranice(povuci)
    for (const [od, doIndeks] of pozivi) {
      expect(doIndeks - od + 1).toBeLessThanOrEqual(1000)
    }
  })

  it("tačno na granici prolazi", async () => {
    const { povuci } = lazniKlijent(200)
    const r = await povuciSveStranice(povuci, { stranica: 50, maks: 200 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.redovi).toHaveLength(200)
  })

  it("jedan red preko granice = ODBIJENO (nikad krnji fajl)", async () => {
    const { povuci } = lazniKlijent(201)
    const r = await povuciSveStranice(povuci, { stranica: 50, maks: 200 })
    expect(r).toEqual({ ok: false, razlog: "previse", granica: 200 })
  })

  it("prekoračenje ne povlači cijeli ogroman skup — staje na maks+1", async () => {
    const { povuci, pozivi } = lazniKlijent(1_000_000)
    const r = await povuciSveStranice(povuci, { stranica: 500, maks: 1000 })
    expect(r.ok).toBe(false)
    const povuceno = pozivi.reduce((s, [od, d]) => s + (d - od + 1), 0)
    expect(povuceno).toBeLessThanOrEqual(1001)
  })

  it("greška na bilo kojoj stranici prekida odmah", async () => {
    let n = 0
    const r = await povuciSveStranice<{ i: number }>((od, doIndeks) => {
      n++
      if (n === 2) return Promise.resolve({ data: null, error: { message: "timeout" } })
      const data = Array.from({ length: doIndeks - od + 1 }, (_, k) => ({ i: od + k }))
      return Promise.resolve({ data, error: null })
    }, { stranica: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok && r.razlog === "greska") expect(r.error).toEqual({ message: "timeout" })
    expect(n).toBe(2)
  })

  it("podrazumijevane konstante su konzistentne", () => {
    expect(IZVOZ_STRANICA).toBeLessThanOrEqual(1000) // PostgREST max-rows
    expect(IZVOZ_MAX_REDOVA).toBeGreaterThan(1000) // inače granica ne bi ništa rješavala
  })
})
