import { describe, it, expect } from "vitest"
import { buildRecipientIndex } from "./recipients"
import { digestGroups, type IstekliRed } from "./digestGroups"

const red = (terminId: string, klijentId: string, danaDoCiklusa: number): IstekliRed => ({
  terminId, klijentId, klijentNaziv: `K-${klijentId}`, vrstaNaziv: "Obilazak",
  rokDospijeca: "2026-06-01", datumZakazan: null, ciklusRok: "2026-06-01",
  danaDoCiklusa, lokacijaNaziv: null,
})

const ADMIN = { id: "u-admin", email: "admin@x.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }
const RADNIK = { id: "u-radnik", email: "radnik@x.com", uloga: "operater", aktivan: true, prima_podsjetnike: true }
const NEAKTIVAN = { id: "u-off", email: "off@x.com", uloga: "operater", aktivan: false, prima_podsjetnike: true }
const BEZ_PODSJETNIKA = { id: "u-np", email: "np@x.com", uloga: "operater", aktivan: true, prima_podsjetnike: false }

function indeks(korisnici = [ADMIN, RADNIK], dodjele = [{ korisnik_id: "u-radnik", klijent_id: "k1" }]) {
  return buildRecipientIndex(korisnici, dodjele, [], [], false)
}

describe("digestGroups", () => {
  it("admin dobija sve termine, radnik samo svoje klijente", () => {
    const m = digestGroups([red("t1", "k1", -5), red("t2", "k2", -9)], indeks(), [])
    expect(m.get("admin@x.com")!.map((r) => r.terminId).sort()).toEqual(["t1", "t2"])
    expect(m.get("radnik@x.com")!.map((r) => r.terminId)).toEqual(["t1"])
  })

  it("REMINDER_TO base se ponaša kao admin — dobija sve", () => {
    const m = digestGroups([red("t1", "k1", -5), red("t2", "k2", -9)], indeks(), ["base@x.com"])
    expect(m.get("base@x.com")!.map((r) => r.terminId).sort()).toEqual(["t1", "t2"])
  })

  it("neaktivan korisnik i onaj bez prima_podsjetnike ne postoje u mapi", () => {
    const m = digestGroups(
      [red("t1", "k1", -5)],
      indeks([ADMIN, NEAKTIVAN, BEZ_PODSJETNIKA], [
        { korisnik_id: "u-off", klijent_id: "k1" },
        { korisnik_id: "u-np", klijent_id: "k1" },
      ]),
      [],
    )
    expect(m.has("off@x.com")).toBe(false)
    expect(m.has("np@x.com")).toBe(false)
  })

  it("primalac bez ijednog isteklog termina ne postoji u mapi", () => {
    const m = digestGroups([red("t2", "k2", -9)], indeks(), [])
    expect(m.has("radnik@x.com")).toBe(false)
    expect(m.has("admin@x.com")).toBe(true)
  })

  it("prazan ulaz daje praznu mapu", () => {
    expect(digestGroups([], indeks(), []).size).toBe(0)
  })

  it("ne duplira termin kad je primalac i admin i dodijeljen", () => {
    const m = digestGroups([red("t1", "k1", -5)], indeks([ADMIN], [{ korisnik_id: "u-admin", klijent_id: "k1" }]), [])
    expect(m.get("admin@x.com")).toHaveLength(1)
  })

  it("čuva redoslijed iz ulaza (RPC već sortira po kašnjenju)", () => {
    const m = digestGroups([red("t1", "k1", -30), red("t2", "k1", -2)], indeks(), [])
    expect(m.get("radnik@x.com")!.map((r) => r.terminId)).toEqual(["t1", "t2"])
  })
})
