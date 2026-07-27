import { describe, it, expect } from "vitest"
import { imeIzContentDisposition } from "./naziv-fajla"

const FB = "plan.xlsx"

describe("imeIzContentDisposition", () => {
  it("nema headera → fallback", () => {
    expect(imeIzContentDisposition(null, FB)).toBe(FB)
    expect(imeIzContentDisposition("", FB)).toBe(FB)
  })

  it("čita `filename=\"...\"` (oblik koji izvoz ruta stvarno šalje)", () => {
    expect(
      imeIzContentDisposition('attachment; filename="plan-aktivnosti-juli-2026.xlsx"', FB),
    ).toBe("plan-aktivnosti-juli-2026.xlsx")
  })

  it("čita `filename=` bez navodnika", () => {
    expect(imeIzContentDisposition("attachment; filename=plan.pdf", FB)).toBe("plan.pdf")
  })

  it("RFC 5987 `filename*` ima prednost i dekodira se", () => {
    const h = "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''plan-%C4%8Ddovi.pdf"
    expect(imeIzContentDisposition(h, FB)).toBe("plan-čdovi.pdf")
  })

  it("odbacuje putanju iz imena (nikad separator staze)", () => {
    expect(imeIzContentDisposition('attachment; filename="../../etc/passwd"', FB)).toBe("passwd")
    expect(imeIzContentDisposition('attachment; filename="C:\\temp\\plan.pdf"', FB)).toBe("plan.pdf")
  })

  it("prazno ime → fallback", () => {
    expect(imeIzContentDisposition('attachment; filename=""', FB)).toBe(FB)
  })

  it("header bez filename dijela → fallback", () => {
    expect(imeIzContentDisposition("attachment", FB)).toBe(FB)
  })

  it("neispravan percent-encoding ne baca", () => {
    expect(imeIzContentDisposition("attachment; filename*=UTF-8''plan-%E0%A4%A.pdf", FB)).toBe(
      "plan-%E0%A4%A.pdf",
    )
  })
})
