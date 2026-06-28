import { describe, it, expect } from "vitest"
import { PLAN_VIEWS, jeValidanView, buildViewHref, buildRedirectHref } from "./plan-view"

describe("jeValidanView", () => {
  it("prihvata poznate view-ove", () => {
    for (const v of PLAN_VIEWS) expect(jeValidanView(v)).toBe(true)
  })
  it("odbija nepoznato/undefined", () => {
    expect(jeValidanView("xyz")).toBe(false)
    expect(jeValidanView(undefined)).toBe(false)
  })
})

describe("buildViewHref", () => {
  it("postavlja view i čuva ostale parametre", () => {
    const p = new URLSearchParams("status=kasni&mjesec=7")
    expect(buildViewHref(p, "kalendar")).toBe("/plan-aktivnosti?status=kasni&mjesec=7&view=kalendar")
  })
  it("mijenja postojeći view (view ide na kraj)", () => {
    const p = new URLSearchParams("view=lista&klijent_id=abc")
    expect(buildViewHref(p, "matrica")).toBe("/plan-aktivnosti?klijent_id=abc&view=matrica")
  })
  it("bez parametara → samo view", () => {
    expect(buildViewHref(new URLSearchParams(), "lista")).toBe("/plan-aktivnosti?view=lista")
  })
})

describe("buildRedirectHref", () => {
  it("mapira view + čuva string parametre", () => {
    expect(buildRedirectHref("lista", { status: "kasni" })).toBe("/plan-aktivnosti?status=kasni&view=lista")
  })
  it("ignoriše ne-string (array) parametre", () => {
    expect(buildRedirectHref("matrica", { foo: ["a", "b"], godina: "2026" })).toBe("/plan-aktivnosti?godina=2026&view=matrica")
  })
  it("bez parametara → samo view", () => {
    expect(buildRedirectHref("kalendar", {})).toBe("/plan-aktivnosti?view=kalendar")
  })
})
