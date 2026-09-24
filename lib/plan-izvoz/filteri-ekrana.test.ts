import { describe, it, expect } from "vitest"
import { filteriSaEkrana, periodSaEkrana } from "./filteri-ekrana"

const sp = (qs: string) => new URLSearchParams(qs)
const DANAS = "2026-09-15"

describe("filteriSaEkrana", () => {
  it("prosljeđuje filtere sa liste", () => {
    expect(
      filteriSaEkrana(sp("status=kasni&q=una&klijent_id=k1&lokacija=l1&vrsta_id=v1&nacin=pracenje")),
    ).toEqual({
      status: "kasni",
      q: "una",
      klijent_id: "k1",
      lokacija: "l1",
      vrsta_id: "v1",
      nacin: "pracenje",
    })
  })

  it("prazne vrijednosti se izostavljaju", () => {
    expect(filteriSaEkrana(sp("status=&q=una&lokacija="))).toEqual({ q: "una" })
  })

  it("ne prosljeđuje ključeve koji nisu filteri", () => {
    expect(filteriSaEkrana(sp("page=3&view=matrica&selected=x&dan=2026-09-01&mjesec=9&godina=2026"))).toEqual({})
  })

  /**
   * Matrica piše izabranu firmu u `klijent`, a lista u `klijent_id`. Izvoz je čitao
   * samo `klijent_id`, pa je filter sa Matrice tiho ispadao — a modal je uz to javljao
   * „Nema aktivnih filtera" iako je ekran bio filtriran.
   */
  it("mapira `klijent` sa Matrice na `klijent_id`", () => {
    expect(filteriSaEkrana(sp("view=matrica&mode=klijent&klijent=k9"))).toEqual({ klijent_id: "k9" })
  })

  it("mod `klijent` je podrazumijevan i kad `mode` nije u URL-u", () => {
    expect(filteriSaEkrana(sp("view=matrica&klijent=k9"))).toEqual({ klijent_id: "k9" })
  })

  /** U modu „mjesec" matrica ne filtrira po firmi — zaostali `klijent` ne smije stegnuti izvoz. */
  it("u modu `mjesec` ignoriše zaostali `klijent`", () => {
    expect(filteriSaEkrana(sp("view=matrica&mode=mjesec&mjesec=9&klijent=k9"))).toEqual({})
  })

  it("izričiti `klijent_id` ima prednost nad `klijent`", () => {
    expect(filteriSaEkrana(sp("klijent_id=k1&klijent=k9"))).toEqual({ klijent_id: "k1" })
  })
})

/**
 * Modal se ranije uvijek otvarao na „Ovaj mjesec", pa je „Samo trenutno filtrirano"
 * nad listom filtriranom na mart tiho vraćalo tekući mjesec — period iz modala
 * zamjenjuje datumski filter ekrana, a korisnik to nije imao odakle znati.
 */
describe("periodSaEkrana", () => {
  it("lista filtrirana na određeni mjesec → taj mjesec", () => {
    expect(periodSaEkrana(sp("view=lista&mjesec=3&godina=2026"), DANAS)).toEqual({
      mod: "mj", godina: 2026, mjesec: 3,
    })
  })

  it("lista sa mjesec=svi → bez vremenskog ograničenja", () => {
    expect(periodSaEkrana(sp("view=lista&mjesec=svi"), DANAS)).toEqual({
      mod: "svi", godina: 2026, mjesec: 9,
    })
  })

  it("podrazumijevani raspon liste (tn) ostaje na „ovaj mjesec”", () => {
    expect(periodSaEkrana(sp("view=lista&mjesec=tn"), DANAS)).toEqual({
      mod: "om", godina: 2026, mjesec: 9,
    })
    expect(periodSaEkrana(sp("view=lista"), DANAS)).toEqual({
      mod: "om", godina: 2026, mjesec: 9,
    })
  })

  it("kalendar bez parametara → tekući mjesec", () => {
    expect(periodSaEkrana(sp(""), DANAS)).toEqual({ mod: "om", godina: 2026, mjesec: 9 })
  })

  it("kalendar na drugom mjesecu → taj mjesec", () => {
    expect(periodSaEkrana(sp("view=kalendar&mjesec=11&godina=2027"), DANAS)).toEqual({
      mod: "mj", godina: 2027, mjesec: 11,
    })
  })

  it("matrica po firmi prikazuje cijelu godinu → cijela godina", () => {
    expect(periodSaEkrana(sp("view=matrica&mode=klijent&godina=2027&klijent=k9"), DANAS)).toEqual({
      mod: "god", godina: 2027, mjesec: 9,
    })
  })

  it("matrica po firmi ignoriše zaostali `mjesec` iz ranijeg moda", () => {
    expect(periodSaEkrana(sp("view=matrica&mode=klijent&mjesec=5&godina=2026"), DANAS)).toEqual({
      mod: "god", godina: 2026, mjesec: 5,
    })
  })

  it("matrica po mjesecu → taj mjesec", () => {
    expect(periodSaEkrana(sp("view=matrica&mode=mjesec&mjesec=9&godina=2026"), DANAS)).toEqual({
      mod: "mj", godina: 2026, mjesec: 9,
    })
  })

  it("besmislen mjesec ne obara modal", () => {
    expect(periodSaEkrana(sp("view=lista&mjesec=13"), DANAS)).toEqual({
      mod: "om", godina: 2026, mjesec: 9,
    })
  })
})
