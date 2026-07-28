import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

describe("DEMO_MODE", () => {
  const original = process.env.NEXT_PUBLIC_DEMO_MODE

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE
    else process.env.NEXT_PUBLIC_DEMO_MODE = original
  })

  it("je ISKLJUČEN kad varijabla nije postavljena — produkcija ne smije slučajno ući u demo", async () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE
    const { DEMO_MODE } = await import("./demo")
    expect(DEMO_MODE).toBe(false)
  })

  it('je uključen samo na tačnu vrijednost "1"', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "1"
    const { DEMO_MODE } = await import("./demo")
    expect(DEMO_MODE).toBe(true)
  })

  // Svaka vrijednost se učitava u SVOM modulu — `vi.resetModules()` mora pasti između
  // importa, pa `it.each` (jedan test po vrijednosti) umjesto petlje sa await unutra.
  it.each(["true", "0", "", "yes", " 1 x"])(
    'ignoriše vrijednost %j — uključuje samo tačno "1"',
    async (v) => {
      process.env.NEXT_PUBLIC_DEMO_MODE = v
      const { DEMO_MODE } = await import("./demo")
      expect(DEMO_MODE).toBe(false)
    },
  )
})
