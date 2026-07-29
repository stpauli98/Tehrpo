import { describe, it, expect } from "vitest"
import sr from "@/messages/sr.json"
import en from "@/messages/en.json"
import de from "@/messages/de.json"
import {
  izracunajIshodReda,
  izracunajStatusRadnika,
  stalniPrimaoci,
  nepokriveneLokacije,
  type LokacijaRef,
} from "./koStaPrima"

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

describe("izracunajStatusRadnika", () => {
  it("nema dodijeljenih", () => {
    expect(izracunajStatusRadnika(0, 0)).toBe("nemaDodijeljenih")
  })

  it("ima dodijeljenih ali nijedan ne prima → optOut", () => {
    expect(izracunajStatusRadnika(3, 0)).toBe("optOut")
  })

  it("barem jedan prima → ima", () => {
    expect(izracunajStatusRadnika(3, 1)).toBe("ima")
    expect(izracunajStatusRadnika(1, 1)).toBe("ima")
  })
})

describe("stalniPrimaoci", () => {
  const admin = {
    id: "a1", email: "admin@firma.ba", uloga: "admin", aktivan: true, prima_podsjetnike: true,
  }

  it("uključuje aktivnog admina koji prima i REMINDER_TO adrese, lowercase i bez duplikata", () => {
    expect(stalniPrimaoci([admin], "Sef@Firma.ba, admin@firma.ba")).toEqual([
      "sef@firma.ba",
      "admin@firma.ba",
    ])
  })

  it("izostavlja admina koji je deaktiviran ili je isključio podsjetnike", () => {
    expect(stalniPrimaoci([{ ...admin, aktivan: false }], "")).toEqual([])
    expect(stalniPrimaoci([{ ...admin, prima_podsjetnike: false }], "")).toEqual([])
  })

  it("izostavlja ne-admine (oni primaju samo preko dodjele)", () => {
    expect(stalniPrimaoci([{ ...admin, uloga: "operater" }], "")).toEqual([])
  })

  it("preskače nevalidne adrese i prazan REMINDER_TO", () => {
    expect(stalniPrimaoci([{ ...admin, email: "nije-mejl" }], undefined)).toEqual([])
  })
})

describe("nepokriveneLokacije", () => {
  const lokA: LokacijaRef = { id: "a", naziv: "Lokacija A" }
  const lokB: LokacijaRef = { id: "b", naziv: "Lokacija B" }
  const lokC: LokacijaRef = { id: "c", naziv: "Lokacija C" }

  it("firma bez lokacija → prazan rezultat", () => {
    expect(
      nepokriveneLokacije({ lokacije: [], brojAdresaFirme: 0, adresePoLokaciji: new Map() }),
    ).toEqual([])
  })

  it("brojAdresaFirme > 0 → prazan rezultat bez obzira na adresePoLokaciji", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA, lokB],
        brojAdresaFirme: 1,
        adresePoLokaciji: new Map(),
      }),
    ).toEqual([])
  })

  it("brojAdresaFirme === 0, lokacija ima svoj kontakt → pokrivena", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map([["a", 1]]),
      }),
    ).toEqual([])
  })

  it("brojAdresaFirme === 0, lokacija nema kontakt → nepokrivena", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map(),
      }),
    ).toEqual([lokA])
  })

  it("miješan slučaj: tri lokacije, samo jedna ima kontakt → druge dvije u rezultatu, tim redom", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA, lokB, lokC],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map([["b", 2]]),
      }),
    ).toEqual([lokA, lokC])
  })

  it("adresePoLokaciji sa vrijednošću 0 za lokaciju → tretira se kao nepokrivena", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map([["a", 0]]),
      }),
    ).toEqual([lokA])
  })

  it("unos u adresePoLokaciji za lokacija_id koji ne postoji u lokacije → ignoriše se, ne pada", () => {
    expect(
      nepokriveneLokacije({
        lokacije: [lokA],
        brojAdresaFirme: 0,
        adresePoLokaciji: new Map([["nepostojeca", 5]]),
      }),
    ).toEqual([lokA])
  })
})
