import { describe, it, expect } from "vitest"
import {
  NAJKASNIJI_DOSTIZAN_SAT, SAT_UJUTRO, SAT_POSLIJEPODNE,
  terminIzSata, satIzTermina, type TerminSlanja,
} from "./rasporedSlanja"

// Cron iz vercel.json: "0 9 * * *" i "0 13 * * *" (UTC).
// Po Beču: 10:00 i 14:00 zimi (CET, UTC+1), 11:00 i 15:00 ljeti (CEST, UTC+2).
const JUTARNJI_CRON_BEC = [10, 11]
const POPODNEVNI_CRON_BEC = [14, 15]

// Gate u cron ruti je `sat >= vrijeme_slanja_sat`.
const prolazi = (cronSat: number, postavka: number) => cronSat >= postavka

describe("preslikavanje termin ↔ sat", () => {
  it("satIzTermina daje očekivane vrijednosti", () => {
    expect(satIzTermina("ujutro")).toBe(SAT_UJUTRO)
    expect(satIzTermina("poslijepodne")).toBe(SAT_POSLIJEPODNE)
  })

  it("terminIzSata: sve do 11 je ujutro", () => {
    for (const s of [0, 1, 8, 10, 11]) expect(terminIzSata(s)).toBe("ujutro")
  })

  it("terminIzSata: 12 do 14 je poslijepodne", () => {
    for (const s of [12, 13, 14]) expect(terminIzSata(s)).toBe("poslijepodne")
  })

  it("terminIzSata: granica je između 11 i 12", () => {
    expect(terminIzSata(11)).toBe("ujutro")
    expect(terminIzSata(12)).toBe("poslijepodne")
  })

  it("zatečena nedostižna vrijednost se ne gubi u prikazu", () => {
    // Migracija ih normalizuje, ali forma mora nešto prikazati i za red
    // koji je upisan prije nje ili direktno u bazu.
    for (const s of [15, 20, 23]) expect(terminIzSata(s)).toBe("poslijepodne")
  })

  it("povratak kroz oba smjera je stabilan", () => {
    for (const t of ["ujutro", "poslijepodne"] as TerminSlanja[]) {
      expect(terminIzSata(satIzTermina(t))).toBe(t)
    }
  })
})

// Ovi testovi su jedini automatizovani čuvar veze između vercel.json i konstanti.
// Ako neko promijeni cron raspored a zaboravi konstante, ovdje puca.
describe("veza sa cron rasporedom", () => {
  it("SAT_UJUTRO prolazi gate na jutarnjem runu u obje sezone", () => {
    for (const cron of JUTARNJI_CRON_BEC) expect(prolazi(cron, SAT_UJUTRO)).toBe(true)
  })

  it("SAT_POSLIJEPODNE NE prolazi jutarnji run ni u jednoj sezoni", () => {
    for (const cron of JUTARNJI_CRON_BEC) expect(prolazi(cron, SAT_POSLIJEPODNE)).toBe(false)
  })

  it("SAT_POSLIJEPODNE prolazi popodnevni run u obje sezone", () => {
    for (const cron of POPODNEVNI_CRON_BEC) expect(prolazi(cron, SAT_POSLIJEPODNE)).toBe(true)
  })

  it("NAJKASNIJI_DOSTIZAN_SAT je najraniji popodnevni cron sat", () => {
    expect(NAJKASNIJI_DOSTIZAN_SAT).toBe(Math.min(...POPODNEVNI_CRON_BEC))
  })

  it("svaka vrijednost do NAJKASNIJI_DOSTIZAN_SAT je dostižna u obje sezone", () => {
    for (let s = 0; s <= NAJKASNIJI_DOSTIZAN_SAT; s++) {
      const dostizna = [...JUTARNJI_CRON_BEC, ...POPODNEVNI_CRON_BEC].some((c) => prolazi(c, s))
      expect(dostizna, `sat ${s} mora biti dostižan`).toBe(true)
    }
  })

  it("prva vrijednost iznad praga nije dostižna zimi", () => {
    const s = NAJKASNIJI_DOSTIZAN_SAT + 1
    expect(prolazi(JUTARNJI_CRON_BEC[0]!, s)).toBe(false)
    expect(prolazi(POPODNEVNI_CRON_BEC[0]!, s)).toBe(false)
  })
})
