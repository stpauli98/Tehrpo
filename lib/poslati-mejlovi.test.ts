import { describe, it, expect } from "vitest"
import { Constants } from "@/db/types"
import { utcGranicaSarajevskogDana, dodajDan } from "@/lib/date"
import {
  TIP_KEY,
  STATUS_KEY,
  DOSTAVA_KEY,
  DOSTAVA_VARIJANTA,
  jeGreska,
  jeDemo,
  jeIsoDatum,
  type MejlRed,
} from "./poslati-mejlovi"

/** Minimalni red za `jeGreska` — funkcija čita samo `status` i `delivery_status`. */
function red(
  status: MejlRed["status"],
  delivery_status: MejlRed["delivery_status"],
): Pick<MejlRed, "status" | "delivery_status"> {
  return { status, delivery_status }
}

describe("jeGreska", () => {
  it("greška slanja je greška bez obzira na status dostave", () => {
    expect(jeGreska(red("greska_slanja", "nepoznato"))).toBe(true)
    expect(jeGreska(red("greska_slanja", "delivered"))).toBe(true)
  })

  it("neuspjeli statusi dostave su greška i kad je slanje prošlo", () => {
    expect(jeGreska(red("poslato", "bounced"))).toBe(true)
    expect(jeGreska(red("poslato", "complained"))).toBe(true)
    expect(jeGreska(red("poslato", "delivery_failed"))).toBe(true)
  })

  it("uspješno slanje bez neuspjele dostave nije greška", () => {
    expect(jeGreska(red("poslato", "nepoznato"))).toBe(false)
    expect(jeGreska(red("poslato", "delivered"))).toBe(false)
    expect(jeGreska(red("poslato", "opened"))).toBe(false)
  })
})

describe("jeDemo", () => {
  it("demo red nije greška — ne smije dobiti crvenu pozadinu ni „Označi pregledanim\"", () => {
    expect(jeDemo(red("demo", "nepoznato"))).toBe(true)
    expect(jeGreska(red("demo", "nepoznato"))).toBe(false)
  })

  it("stvarna slanja nisu demo", () => {
    expect(jeDemo(red("poslato", "delivered"))).toBe(false)
    expect(jeDemo(red("greska_slanja", "nepoznato"))).toBe(false)
  })
})

describe("mape enum → i18n ključ", () => {
  // `satisfies Record<Enum, …>` hvata ovo već u tsc-u; test čuva i runtime slučaj
  // kad se `db/types.ts` regeneriše (nova enum vrijednost) bez pokretanja typecheck-a.
  it("TIP_KEY pokriva sve vrijednosti enuma mejl_tip", () => {
    for (const v of Constants.public.Enums.mejl_tip) {
      expect(TIP_KEY[v]).toBeTruthy()
    }
    expect(Object.keys(TIP_KEY)).toHaveLength(Constants.public.Enums.mejl_tip.length)
  })

  it("STATUS_KEY pokriva sve vrijednosti enuma mejl_status", () => {
    for (const v of Constants.public.Enums.mejl_status) {
      expect(STATUS_KEY[v]).toBeTruthy()
    }
    expect(Object.keys(STATUS_KEY)).toHaveLength(Constants.public.Enums.mejl_status.length)
  })

  it("DOSTAVA_KEY i DOSTAVA_VARIJANTA pokrivaju sve vrijednosti enuma mejl_dostava_status", () => {
    for (const v of Constants.public.Enums.mejl_dostava_status) {
      expect(DOSTAVA_KEY[v]).toBeTruthy()
      expect(DOSTAVA_VARIJANTA[v]).toBeTruthy()
    }
    expect(Object.keys(DOSTAVA_KEY)).toHaveLength(
      Constants.public.Enums.mejl_dostava_status.length,
    )
  })

  it("i18n ključevi su jedinstveni po mapi (nema slučajnog dupliranja labele)", () => {
    expect(new Set(Object.values(TIP_KEY)).size).toBe(Object.keys(TIP_KEY).length)
    expect(new Set(Object.values(DOSTAVA_KEY)).size).toBe(Object.keys(DOSTAVA_KEY).length)
  })
})

describe("jeIsoDatum — zaštita od/do parametara", () => {
  it("prihvata isključivo strogi yyyy-MM-dd", () => {
    expect(jeIsoDatum("2026-07-15")).toBe(true)
    expect(jeIsoDatum("2026-7-15")).toBe(false)
    expect(jeIsoDatum("15.07.2026")).toBe(false)
    expect(jeIsoDatum("2026-07-15T10:00:00Z")).toBe(false)
    expect(jeIsoDatum("abc")).toBe(false)
    expect(jeIsoDatum("")).toBe(false)
    expect(jeIsoDatum(undefined)).toBe(false)
  })

  it("odbacuje nepostojeće datume (inače bi se tiho prelili u drugi mjesec)", () => {
    expect(jeIsoDatum("2026-13-45")).toBe(false)
    expect(jeIsoDatum("2026-02-30")).toBe(false)
    expect(jeIsoDatum("2024-02-29")).toBe(true) // prestupna
  })

  it("svaki prihvaćen datum je bezbjedan ulaz za granične helpere (ne baca)", () => {
    for (const v of ["2026-01-01", "2026-07-15", "2026-12-31", "2024-02-29"]) {
      expect(jeIsoDatum(v)).toBe(true)
      expect(() => utcGranicaSarajevskogDana(v)).not.toThrow()
      expect(() => utcGranicaSarajevskogDana(dodajDan(v))).not.toThrow()
    }
  })
})

describe("granice sarajevskog dana za od/do filter (S7)", () => {
  // Helperi žive u lib/date.ts (Talas 0); ovaj blok fiksira TAČNO ponašanje na koje
  // se oslanja page.tsx (od = granica dana, do = granica sljedećeg dana, RPC poredi `<`).
  it("zima (CET, +1) — ponoć je prethodni dan u 23:00 UTC", () => {
    expect(utcGranicaSarajevskogDana("2026-01-15")).toBe("2026-01-14T23:00:00.000Z")
  })

  it("ljeto (CEST, +2) — ponoć je prethodni dan u 22:00 UTC", () => {
    expect(utcGranicaSarajevskogDana("2026-07-15")).toBe("2026-07-14T22:00:00.000Z")
  })

  it("dodajDan prelazi granicu mjeseca", () => {
    expect(dodajDan("2026-07-31")).toBe("2026-08-01")
  })

  it("do=D uključuje mejl u 23:59 dana D, a isključuje 00:00 dana D+1", () => {
    const granica = utcGranicaSarajevskogDana(dodajDan("2026-07-15"))
    const uPonoc23h59 = new Date("2026-07-15T21:59:00.000Z") // 23:59 sarajevski, dan D
    const sutraUPonoc = new Date("2026-07-15T22:00:00.000Z") // 00:00 sarajevski, dan D+1
    expect(uPonoc23h59.getTime()).toBeLessThan(new Date(granica).getTime())
    expect(sutraUPonoc.getTime()).toBeGreaterThanOrEqual(new Date(granica).getTime())
  })
})
