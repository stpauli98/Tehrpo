import { describe, it, expect } from "vitest"
import { buildGradoviMapa, groupByGrad, izvediGrad, type ObilazakItem } from "./obilasci"

const it1 = (over: Partial<ObilazakItem>): ObilazakItem => ({
  id: "x", klijent_id: "k", klijent_naziv: "Firma", vrsta_naziv: "Hidranti",
  lokacija_naziv: "L", lokacija_grad: "Doboj", rok_dospijeca: "2026-02-10", status_izvedeni: "planirano", ...over,
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
