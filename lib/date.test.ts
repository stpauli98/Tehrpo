import { describe, it, expect } from "vitest"
import {
  formatDatum, monthRange, MONTHS_BS, todayIso, periodRange, addMjeseci,
  monthName, jeIsoDatum, APP_TIME_ZONE,
} from "./date"

describe("APP_TIME_ZONE", () => {
  it("jedina zona aplikacije je Europe/Belgrade", () => {
    expect(APP_TIME_ZONE).toBe("Europe/Belgrade")
  })
})

describe("formatDatum", () => {
  it("ISO datum → dd.MM.yyyy (bez tačke iza godine)", () => {
    expect(formatDatum("2026-07-28")).toBe("28.07.2026")
  })
  it("ISO timestamp → uzima samo datum dio", () => {
    expect(formatDatum("2026-02-05T12:30:00Z")).toBe("05.02.2026")
  })
  it("null → em-dash", () => {
    expect(formatDatum(null)).toBe("—")
    expect(formatDatum(undefined)).toBe("—")
    expect(formatDatum("")).toBe("—")
  })
  it("nevažeći format → em-dash", () => {
    expect(formatDatum("28/07/2026")).toBe("—")
    expect(formatDatum("garbage")).toBe("—")
  })
  it("izlaz nikad nema završnu tačku niti zavisi od lokala", () => {
    // standard vlasnika: JEDAN format za sve lokale — funkcija više ne prima locale
    expect(formatDatum("2026-01-02")).toBe("02.01.2026")
    expect(formatDatum("2026-01-02")).not.toMatch(/\.$/)
  })
})

describe("monthName", () => {
  it("sr (default) → identično MONTHS_BS (byte-identical)", () => {
    expect(monthName(1)).toBe("Januar")
    expect(monthName(12)).toBe("Decembar")
    expect(monthName(1, "sr")).toBe("Januar")
  })
  it("en → puno ime mjeseca preko Intl", () => {
    expect(monthName(1, "en")).toBe("January")
    expect(monthName(7, "en")).toBe("July")
    expect(monthName(12, "en")).toBe("December")
  })
  it("de → puno ime mjeseca preko Intl", () => {
    expect(monthName(1, "de")).toBe("Januar")
    expect(monthName(7, "de")).toBe("Juli")
    expect(monthName(12, "de")).toBe("Dezember")
  })
  it("nevažeći broj mjeseca → prazan string", () => {
    expect(monthName(0)).toBe("")
    expect(monthName(13)).toBe("")
  })
})

describe("monthRange", () => {
  it("Februar 2026 (28 dana)", () => {
    expect(monthRange(2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })
  it("Juli 2026 (31 dan)", () => {
    expect(monthRange(2026, 7)).toEqual({ from: "2026-07-01", to: "2026-07-31" })
  })
  it("Februar 2028 (prestupna, 29 dana)", () => {
    expect(monthRange(2028, 2)).toEqual({ from: "2028-02-01", to: "2028-02-29" })
  })
})

describe("MONTHS_BS", () => {
  it("ima 12 mjeseci, Januar prvi", () => {
    expect(MONTHS_BS).toHaveLength(12)
    expect(MONTHS_BS[0]).toBe("Januar")
    expect(MONTHS_BS[11]).toBe("Decembar")
  })
})

describe("todayIso", () => {
  it("vraća YYYY-MM-DD string za današnji zidni datum u Europe/Belgrade", () => {
    const result = todayIso()
    // format check
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // value check: očekivanje nezavisno izgrađeno preko Intl u istoj zoni
    const expected = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Belgrade",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date())
    expect(result).toBe(expected)
  })
})

describe("periodRange", () => {
  it("mjesec → prvi do zadnji dan mjeseca", () => {
    expect(periodRange("mjesec", 2026, 2)).toEqual({ od: "2026-02-01", do: "2026-02-28" })
  })
  it("kvartal Q2 → april–jun", () => {
    expect(periodRange("kvartal", 2026, undefined, 2)).toEqual({ od: "2026-04-01", do: "2026-06-30" })
  })
  it("godina → 01-01 do 12-31", () => {
    expect(periodRange("godina", 2026)).toEqual({ od: "2026-01-01", do: "2026-12-31" })
  })
})

describe("addMjeseci", () => {
  it("dodaje mjesece unutar godine", () => {
    expect(addMjeseci("2026-03-15", 3)).toBe("2026-06-15")
  })
  it("prelazi godinu", () => {
    expect(addMjeseci("2026-11-15", 3)).toBe("2027-02-15")
  })
  it("clamp na zadnji dan kraćeg mjeseca (31 jan +1 → 28 feb)", () => {
    expect(addMjeseci("2026-01-31", 1)).toBe("2026-02-28")
  })
  it("prestupna godina (29 feb)", () => {
    expect(addMjeseci("2024-01-31", 1)).toBe("2024-02-29")
  })
  it("0 i 12 mjeseci", () => {
    expect(addMjeseci("2026-05-10", 0)).toBe("2026-05-10")
    expect(addMjeseci("2026-05-10", 12)).toBe("2027-05-10")
  })
})

import { tekuciNarednomMjesecuRange } from "./date"

describe("tekuciNarednomMjesecuRange", () => {
  it("jun → [01.06, 31.07]", () => {
    expect(tekuciNarednomMjesecuRange(new Date(Date.UTC(2026, 5, 15)))).toEqual({ from: "2026-06-01", to: "2026-07-31" })
  })
  it("preko granice godine: decembar → [01.12, 31.01 sljedeće]", () => {
    expect(tekuciNarednomMjesecuRange(new Date(Date.UTC(2026, 11, 3)))).toEqual({ from: "2026-12-01", to: "2027-01-31" })
  })
  it("februar (28 dana naredni? ne — naredni je mart) → [01.02, 31.03]", () => {
    expect(tekuciNarednomMjesecuRange(new Date(Date.UTC(2026, 1, 10)))).toEqual({ from: "2026-02-01", to: "2026-03-31" })
  })
  it("tekući mjesec je po Europe/Belgrade zidnom datumu: 30.06. 23:00Z = 01.07. 01:00 lokalno → jul+avgust", () => {
    expect(tekuciNarednomMjesecuRange(new Date("2026-06-30T23:00:00Z"))).toEqual({ from: "2026-07-01", to: "2026-08-31" })
  })
})

import { formatDatumVrijeme, formatDatumInstant, utcGranicaDana, dodajDan, dodajDana } from "./date"

describe("formatDatumVrijeme", () => {
  // (a) ljetnje računanje: Europe/Belgrade = UTC+2 → 10:00Z = 12:00
  it("ljetnji timestamp → Europe/Belgrade UTC+2 (12:00)", () => {
    expect(formatDatumVrijeme("2026-07-26T10:00:00Z")).toBe("26.07.2026 12:00")
  })
  // (b) zimski slučaj: Europe/Belgrade = UTC+1 → 10:00Z = 11:00
  it("zimski timestamp → Europe/Belgrade UTC+1 (11:00)", () => {
    expect(formatDatumVrijeme("2026-01-15T10:00:00Z")).toBe("15.01.2026 11:00")
  })
  // (c) ponoć mora biti "00", ne "24" (hourCycle h23)
  it("ponoć → 00:00, i zidni datum prelazi na sljedeći dan", () => {
    expect(formatDatumVrijeme("2026-07-25T22:00:00Z")).toBe("26.07.2026 00:00")
  })
  // (d) null/""/nevažeći → "—"
  it("null/prazan/nevažeći → em-dash", () => {
    expect(formatDatumVrijeme(null)).toBe("—")
    expect(formatDatumVrijeme(undefined)).toBe("—")
    expect(formatDatumVrijeme("")).toBe("—")
    expect(formatDatumVrijeme("garbage")).toBe("—")
  })
  // (e) izlaz ne sadrži sekunde, strogo dd.MM.yyyy HH:mm
  it("izlaz ne sadrži sekunde i strogo je dd.MM.yyyy HH:mm", () => {
    const out = formatDatumVrijeme("2026-07-26T10:00:45Z")
    expect(out).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
    expect(out).toBe("26.07.2026 12:00")
    expect(out).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/)
  })
})

describe("formatDatumInstant", () => {
  it("timestamptz noću po Belgradu → NAŠ datum, ne UTC datum-dio", () => {
    // 25.07. 22:30Z = 26.07. 00:30 po Europe/Belgrade (ljeto) — slice(0,10) bi dao 25.07!
    expect(formatDatumInstant("2026-07-25T22:30:00Z")).toBe("26.07.2026")
    // zima: 14.01. 23:30Z = 15.01. 00:30 lokalno
    expect(formatDatumInstant("2026-01-14T23:30:00Z")).toBe("15.01.2026")
  })
  it("običan dnevni timestamp → isti datum", () => {
    expect(formatDatumInstant("2026-07-26T10:00:00Z")).toBe("26.07.2026")
  })
  it("null/nevažeći → em-dash", () => {
    expect(formatDatumInstant(null)).toBe("—")
    expect(formatDatumInstant(undefined)).toBe("—")
    expect(formatDatumInstant("garbage")).toBe("—")
  })
})

describe("utcGranicaDana", () => {
  // (e) ljeto (UTC+2) i zima (UTC+1)
  it("ljetnji datum → lokalna ponoć = 22:00Z prethodnog dana", () => {
    expect(utcGranicaDana("2026-07-26")).toBe("2026-07-25T22:00:00.000Z")
  })
  it("zimski datum → lokalna ponoć = 23:00Z prethodnog dana", () => {
    expect(utcGranicaDana("2026-01-15")).toBe("2026-01-14T23:00:00.000Z")
  })
})

describe("dodajDan / dodajDana", () => {
  // (f) prestupni februar + granica godine
  it("prestupna godina: 28.02.2024 + 1 → 29.02.2024", () => {
    expect(dodajDan("2024-02-28")).toBe("2024-02-29")
  })
  it("granica godine: 31.12.2026 + 1 → 01.01.2027", () => {
    expect(dodajDan("2026-12-31")).toBe("2027-01-01")
  })
  it("dodajDana: N dana naprijed preko granice mjeseca", () => {
    expect(dodajDana("2026-07-25", 30)).toBe("2026-08-24")
  })
  it("dodajDana: 0 je identitet, negativan ide unazad", () => {
    expect(dodajDana("2026-07-15", 0)).toBe("2026-07-15")
    expect(dodajDana("2026-03-01", -1)).toBe("2026-02-28")
  })
})

// ── Očvršćavanje datumskih helpera ────────────────────────────────────────────
// Povod: dvije grane Talasa 1 (Aktivnost, Poslati mejlovi) nezavisno su otkrile
// da nevaljan URL parametar (?od=abc) ruši cijelu rutu, i svaka je napisala
// vlastitu zaštitu. Validacija je sada ovdje — jedan izvor za sve pozivaoce.
describe("jeIsoDatum", () => {
  it("prihvata strogi YYYY-MM-DD", () => {
    expect(jeIsoDatum("2026-07-15")).toBe(true)
    expect(jeIsoDatum("2024-02-29")).toBe(true) // prestupna
  })
  it("odbacuje pogrešan oblik", () => {
    expect(jeIsoDatum("2026-7-15")).toBe(false)
    expect(jeIsoDatum("15.07.2026")).toBe(false)
    expect(jeIsoDatum("2026-07-15T10:00:00Z")).toBe(false)
    expect(jeIsoDatum("abc")).toBe(false)
    expect(jeIsoDatum("")).toBe(false)
    expect(jeIsoDatum(undefined)).toBe(false)
    expect(jeIsoDatum(null)).toBe(false)
  })
  it("odbacuje nepostojeće datume koje Date.parse propušta", () => {
    expect(jeIsoDatum("2026-02-30")).toBe(false)
    expect(jeIsoDatum("2026-13-45")).toBe(false)
    expect(jeIsoDatum("2026-04-31")).toBe(false)
    expect(jeIsoDatum("2026-00-10")).toBe(false)
  })
})

describe("datumski helperi odbijaju nevaljan ulaz umjesto tihe korupcije", () => {
  const nevaljani = ["abc", "", "2026-13-45", "2026-02-30", "15.07.2026", "2026-7-15"]

  it("dodajDan baca umjesto da vrati 'NaN-NaN-NaN'", () => {
    for (const v of nevaljani) {
      expect(() => dodajDan(v)).toThrow(/ISO datum/)
      // regresija: ranije je tiho vraćao string sa NaN-ovima
    }
  })

  it("dodajDana baca na nevaljan ulaz", () => {
    for (const v of nevaljani) {
      expect(() => dodajDana(v, 5)).toThrow(/ISO datum/)
    }
  })

  it("utcGranicaDana baca jasnu grešku, ne sirovi RangeError", () => {
    for (const v of nevaljani) {
      expect(() => utcGranicaDana(v)).toThrow(/ISO datum/)
    }
  })

  it("poruka greške imenuje funkciju i vrijednost, i upućuje na jeIsoDatum", () => {
    expect(() => utcGranicaDana("abc")).toThrow(/utcGranicaDana/)
    expect(() => utcGranicaDana("abc")).toThrow(/"abc"/)
    expect(() => dodajDan("abc")).toThrow(/jeIsoDatum/)
  })

  it("invarijanta: svaka vrijednost koju jeIsoDatum prihvati je bezbjedna za oba helpera", () => {
    for (const v of ["2026-01-01", "2026-07-15", "2024-02-29", "2026-12-31", "2026-03-30"]) {
      expect(jeIsoDatum(v)).toBe(true)
      expect(() => utcGranicaDana(v)).not.toThrow()
      expect(() => utcGranicaDana(dodajDan(v))).not.toThrow()
    }
  })
})
