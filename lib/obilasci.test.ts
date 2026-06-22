import { describe, it, expect } from "vitest"
import { groupByGrad, type ObilazakItem } from "./obilasci"

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
})
