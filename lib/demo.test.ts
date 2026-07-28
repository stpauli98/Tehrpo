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

  it('ignoriše vrijednosti koje liče na uključeno ("true", "0", prazno)', async () => {
    for (const v of ["true", "0", "", "yes"]) {
      vi.resetModules()
      process.env.NEXT_PUBLIC_DEMO_MODE = v
      const { DEMO_MODE } = await import("./demo")
      expect(DEMO_MODE, `vrijednost ${JSON.stringify(v)}`).toBe(false)
    }
  })
})
