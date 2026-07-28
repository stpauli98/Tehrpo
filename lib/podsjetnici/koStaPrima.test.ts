import { describe, it, expect } from "vitest"
import sr from "@/messages/sr.json"
import en from "@/messages/en.json"
import de from "@/messages/de.json"
import { izracunajIshodReda } from "./koStaPrima"

describe("izracunajIshodReda", () => {
  const ok = { podsjetniciAktivni: true, saljiGlobalno: true, saljiFirmi: true, brojAdresa: 1 }

  it("prima kad su sva četiri uslova ispunjena", () => {
    expect(izracunajIshodReda(ok)).toEqual({ prima: true, razlog: null })
  })

  it("automatika je najviši razlog — nadjačava i globalni i firmin i adrese", () => {
    expect(izracunajIshodReda({ ...ok, podsjetniciAktivni: false })).toEqual({
      prima: false,
      razlog: "automatika",
    })
    expect(
      izracunajIshodReda({ podsjetniciAktivni: false, saljiGlobalno: false, saljiFirmi: false, brojAdresa: 0 }),
    ).toEqual({ prima: false, razlog: "automatika" })
  })

  it("globalni prekidač je iznad firminog", () => {
    expect(izracunajIshodReda({ ...ok, saljiGlobalno: false, saljiFirmi: false })).toEqual({
      prima: false,
      razlog: "globalno",
    })
  })

  it("firmin flag je iznad adresa", () => {
    expect(izracunajIshodReda({ ...ok, saljiFirmi: false, brojAdresa: 0 })).toEqual({
      prima: false,
      razlog: "firma",
    })
  })

  it("nema adrese je zadnji razlog", () => {
    expect(izracunajIshodReda({ ...ok, brojAdresa: 0 })).toEqual({
      prima: false,
      razlog: "nemaAdrese",
    })
  })
})

describe("katalozi — opis automatskog slanja", () => {
  const katalozi = { sr, en, de }

  it("ne tvrdi zastarjelo vrijeme slanja (cron je 09:00 i 13:00 UTC)", () => {
    for (const [jezik, k] of Object.entries(katalozi)) {
      const opis = k.postavke.podsjetniciKontrole.opis
      expect(opis, jezik).not.toMatch(/06:00|6:00/)
    }
  })

  it("kaže da obavijest o zakazivanju ima svoj prekidač", () => {
    // Nalaz #3: podsjetnici_aktivni NE gasi zabiljezi_zakazano_obavijest (gejtuje ga
    // samo zakazano_obavijest_aktivna). Opis to mora reći, jer se inače čita kao master.
    expect(sr.postavke.podsjetniciKontrole.opis).toContain("zakazivanju")
    expect(en.postavke.podsjetniciKontrole.opis.toLowerCase()).toContain("scheduling")
    expect(de.postavke.podsjetniciKontrole.opis.toLowerCase()).toContain("terminierung")
  })
})
