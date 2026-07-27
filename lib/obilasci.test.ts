import { describe, it, expect } from "vitest"
import {
  AKTIVNI_ISKLJUCENI,
  AKTIVNI_NOT_IN,
  buildGradoviMapa,
  groupByGrad,
  izvediGrad,
  kvartalIzDatuma,
  parsirajObilasciParams,
  type ObilazakItem,
} from "./obilasci"

const it1 = (over: Partial<ObilazakItem>): ObilazakItem => ({
  id: "x", klijent_id: "k", klijent_naziv: "Firma", vrsta_naziv: "Hidranti",
  lokacija_naziv: "L", lokacija_grad: "Doboj", rok_dospijeca: "2026-02-10", status_izvedeni: "planirano",
  status: "planirano", datum_zakazan: null, ...over,
})

describe("groupByGrad", () => {
  it("grupiše po gradu, abecedno", () => {
    const g = groupByGrad([it1({ lokacija_grad: "Prijedor" }), it1({ lokacija_grad: "Doboj" })])
    expect(g.map((x) => x.grad)).toEqual(["Doboj", "Prijedor"])
  })
  it("null grad ide u 'Bez grada' na kraj", () => {
    const g = groupByGrad([it1({ lokacija_grad: null }), it1({ lokacija_grad: "Banja Luka" })])
    expect(g.map((x) => x.grad)).toEqual(["Banja Luka", "Bez grada"])
  })
  it("sr eksplicitno → identično defaultu (byte-identical, reuse obilasci.toolbar.gradBez)", () => {
    const g = groupByGrad([it1({ lokacija_grad: null }), it1({ lokacija_grad: "Banja Luka" })], "sr")
    expect(g.map((x) => x.grad)).toEqual(["Banja Luka", "Bez grada"])
  })
  it("en → 'No city' na kraju (reuse obilasci.toolbar.gradBez)", () => {
    const g = groupByGrad([it1({ lokacija_grad: null }), it1({ lokacija_grad: "Banja Luka" })], "en")
    expect(g.map((x) => x.grad)).toEqual(["Banja Luka", "No city"])
  })
  it("de → 'Ohne Stadt' na kraju (reuse obilasci.toolbar.gradBez)", () => {
    const g = groupByGrad([it1({ lokacija_grad: null }), it1({ lokacija_grad: "Banja Luka" })], "de")
    expect(g.map((x) => x.grad)).toEqual(["Banja Luka", "Ohne Stadt"])
  })
})

describe("izvediGrad", () => {
  it("čist grad → kanonski oblik (case/dijakritika)", () => {
    expect(izvediGrad("PRIJEDOR")).toBe("Prijedor")
    expect(izvediGrad("BRČKO")).toBe("Brčko")
    expect(izvediGrad("GRADIŠKA")).toBe("Gradiška")
    expect(izvediGrad("ISTOČNO SARAJEVO")).toBe("Istočno Sarajevo")
  })
  it("'Grad - Objekat' → grad iz prefiksa", () => {
    expect(izvediGrad("Banja Luka - Kort")).toBe("Banja Luka")
    expect(izvediGrad("Banja Luka - Delta")).toBe("Banja Luka")
    expect(izvediGrad("Banja Luka - Emporium")).toBe("Banja Luka")
  })
  it("višegradski naziv (zarez) → prvi segment", () => {
    expect(izvediGrad("ZVORNIK, BRČKO, BIJELJINA")).toBe("Zvornik")
  })
  it("market/negeo nazivi → null (Bez grada)", () => {
    expect(izvediGrad("KORT, DELTA")).toBeNull()
    expect(izvediGrad("RS")).toBeNull()
    expect(izvediGrad("FBiH - kancelarija")).toBeNull()
    expect(izvediGrad("Centrala")).toBeNull()
    expect(izvediGrad("PJ 20")).toBeNull()
  })
  it("postojeći grad se zadržava (ne gazi se)", () => {
    expect(izvediGrad("Dom zdravlja", "Laktasi")).toBe("Laktasi")
    expect(izvediGrad("BRČKO", "Doboj")).toBe("Doboj")
  })
  it("prazan/null naziv → null", () => {
    expect(izvediGrad(null)).toBeNull()
    expect(izvediGrad("   ")).toBeNull()
  })
})

describe("buildGradoviMapa", () => {
  it("foldira dijakritiku u ključ, čuva kanonski naziv kao vrijednost", () => {
    expect(buildGradoviMapa(["Gradiška"])).toEqual({ gradiska: "Gradiška" })
  })
  it("fold pokriva sve dijakritičke parove (č/ć/š/ž/đ)", () => {
    expect(buildGradoviMapa(["Brčko", "Istočno Sarajevo", "Laktaši", "Žepče", "Đurđevik"])).toEqual({
      brcko: "Brčko",
      "istocno sarajevo": "Istočno Sarajevo",
      laktasi: "Laktaši",
      zepce: "Žepče",
      durdevik: "Đurđevik",
    })
  })
  it("trimuje naziv i preskače prazne unose", () => {
    expect(buildGradoviMapa(["  Doboj  ", "   ", ""])).toEqual({ doboj: "Doboj" })
  })
  it("prazna lista → prazna mapa", () => {
    expect(buildGradoviMapa([])).toEqual({})
  })
  it("mapa iz kataloga ima isti oblik kao statična whitelista (fold ključ → kanonski)", () => {
    const mapa = buildGradoviMapa(["Banja Luka", "Brčko"])
    // Prvo apsolutna očekivanja (da poređenje ispod ne prođe vakuumski null===null),
    // pa tek onda ekvivalencija sa statičnom whitelistom.
    expect(izvediGrad("BANJA LUKA", null, mapa)).toBe("Banja Luka")
    expect(izvediGrad("BRČKO", null, mapa)).toBe("Brčko")
    expect(izvediGrad("BANJA LUKA", null, mapa)).toBe(izvediGrad("BANJA LUKA"))
    expect(izvediGrad("BRČKO", null, mapa)).toBe(izvediGrad("BRČKO"))
  })
})

describe("izvediGrad sa gradoviMapa (katalog iz baze)", () => {
  const mapa = buildGradoviMapa(["Bihać", "Banja Luka"])

  it("pogađa grad kog nema u statičnoj GRADOVI_BIH whitelisti", () => {
    expect(izvediGrad("BIHAĆ")).toBeNull() // statični fallback ga ne poznaje
    expect(izvediGrad("BIHAĆ", null, mapa)).toBe("Bihać")
  })
  it("proslijeđena mapa ZAMJENJUJE whitelistu (ne dopunjuje je)", () => {
    expect(izvediGrad("Prijedor", null, mapa)).toBeNull()
  })
  it("normalizacija naziva (zarez / 'Grad - Objekat') radi i sa mapom", () => {
    expect(izvediGrad("Banja Luka - Delta", null, mapa)).toBe("Banja Luka")
    expect(izvediGrad("BIHAĆ, BANJA LUKA", null, mapa)).toBe("Bihać")
  })
  it("postojeći grad se i dalje zadržava kad je mapa data", () => {
    expect(izvediGrad("BIHAĆ", "Doboj", mapa)).toBe("Doboj")
  })
  it("prazna mapa → sve null (katalog prazan, bez tihog pada na whitelistu)", () => {
    expect(izvediGrad("PRIJEDOR", null, {})).toBeNull()
  })
  it("bez 3. argumenta = identično dosadašnjem ponašanju (backward-kompatibilnost)", () => {
    expect(izvediGrad("PRIJEDOR")).toBe("Prijedor")
    expect(izvediGrad("Banja Luka - Kort")).toBe("Banja Luka")
    expect(izvediGrad("KORT, DELTA")).toBeNull()
  })
  it("eksplicitni undefined kao 3. argument → fallback na GRADOVI_BIH", () => {
    expect(izvediGrad("Doboj", null, undefined)).toBe("Doboj")
  })
})

describe("AKTIVNI_ISKLJUCENI", () => {
  it("definiše 'Aktivni' kao sve osim izvršenog i otkazanog", () => {
    expect([...AKTIVNI_ISKLJUCENI]).toEqual(["izvrseno", "otkazano"])
  })
  it("AKTIVNI_NOT_IN je PostgREST in-lista nad istim skupom", () => {
    expect(AKTIVNI_NOT_IN).toBe("(izvrseno,otkazano)")
  })
})

describe("kvartalIzDatuma", () => {
  it("mapira mjesec na kvartal 1–4", () => {
    expect(kvartalIzDatuma("2026-01-15")).toBe(1)
    expect(kvartalIzDatuma("2026-03-31")).toBe(1)
    expect(kvartalIzDatuma("2026-04-01")).toBe(2)
    expect(kvartalIzDatuma("2026-07-27")).toBe(3)
    expect(kvartalIzDatuma("2026-12-01")).toBe(4)
  })
})

describe("parsirajObilasciParams", () => {
  const DANAS = "2026-07-27" // Q3, mjesec 7, godina 2026

  it("prazan URL → svi defaultovi (tekući mjesec/kvartal/godina, status aktivni)", () => {
    expect(parsirajObilasciParams({}, DANAS)).toEqual({
      period: "mjesec", godina: 2026, mjesec: 7, kvartal: 3,
      status: "aktivni", grad: "", strana: 1,
    })
  })

  it("nepoznat period → mjesec", () => {
    expect(parsirajObilasciParams({ period: "xyz" }, DANAS).period).toBe("mjesec")
    expect(parsirajObilasciParams({ period: ["godina"] }, DANAS).period).toBe("mjesec")
  })

  it("validan period prolazi", () => {
    expect(parsirajObilasciParams({ period: "kvartal" }, DANAS).period).toBe("kvartal")
    expect(parsirajObilasciParams({ period: "godina" }, DANAS).period).toBe("godina")
  })

  it("nepoznat status → aktivni; poznati statusi prolaze (izvedeni iz STATUS_FILTER_OPTIONS)", () => {
    expect(parsirajObilasciParams({ status: "abc" }, DANAS).status).toBe("aktivni")
    expect(parsirajObilasciParams({ status: "svi" }, DANAS).status).toBe("svi")
    expect(parsirajObilasciParams({ status: "kasni" }, DANAS).status).toBe("kasni")
    expect(parsirajObilasciParams({ status: "izvrseno" }, DANAS).status).toBe("izvrseno")
    expect(parsirajObilasciParams({ status: "otkazano" }, DANAS).status).toBe("otkazano")
  })

  it("kvartal default je TEKUĆI kvartal, ne 1", () => {
    expect(parsirajObilasciParams({}, "2026-11-05").kvartal).toBe(4)
    expect(parsirajObilasciParams({ kvartal: "abc" }, "2026-11-05").kvartal).toBe(4)
    expect(parsirajObilasciParams({ kvartal: "9" }, "2026-11-05").kvartal).toBe(4)
    expect(parsirajObilasciParams({ kvartal: "2" }, "2026-11-05").kvartal).toBe(2)
  })

  it("mjesec: van 1–12 ili nebrojiv → tekući mjesec", () => {
    expect(parsirajObilasciParams({ mjesec: "0" }, DANAS).mjesec).toBe(7)
    expect(parsirajObilasciParams({ mjesec: "13" }, DANAS).mjesec).toBe(7)
    expect(parsirajObilasciParams({ mjesec: "foo" }, DANAS).mjesec).toBe(7)
    expect(parsirajObilasciParams({ mjesec: "2" }, DANAS).mjesec).toBe(2)
  })

  it("godina: nebrojiva ili van raspona → tekuća", () => {
    expect(parsirajObilasciParams({ godina: "foo" }, DANAS).godina).toBe(2026)
    expect(parsirajObilasciParams({ godina: "1200" }, DANAS).godina).toBe(2026)
    expect(parsirajObilasciParams({ godina: "2024" }, DANAS).godina).toBe(2024)
  })

  it("strana: 'abc', 0 i negativno → 1", () => {
    expect(parsirajObilasciParams({ strana: "abc" }, DANAS).strana).toBe(1)
    expect(parsirajObilasciParams({ strana: "0" }, DANAS).strana).toBe(1)
    expect(parsirajObilasciParams({ strana: "-3" }, DANAS).strana).toBe(1)
    expect(parsirajObilasciParams({ strana: "1.5" }, DANAS).strana).toBe(1)
    expect(parsirajObilasciParams({ strana: "3" }, DANAS).strana).toBe(3)
  })

  it("grad je passthrough (sentineli i slobodan tekst); nizovi → prazno", () => {
    expect(parsirajObilasciParams({ grad: "Banja Luka" }, DANAS).grad).toBe("Banja Luka")
    expect(parsirajObilasciParams({ grad: "__bez__" }, DANAS).grad).toBe("__bez__")
    expect(parsirajObilasciParams({ grad: ["a", "b"] }, DANAS).grad).toBe("")
  })

  it("nepoznati parametri se ignorišu (ne cure u rezultat)", () => {
    const r = parsirajObilasciParams({ nesto: "1", period: "godina" }, DANAS)
    expect(Object.keys(r).sort()).toEqual(
      ["godina", "grad", "kvartal", "mjesec", "period", "status", "strana"],
    )
  })
})
