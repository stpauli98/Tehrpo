import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const posalji = vi.fn()
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: posalji }
  },
}))

describe("sendEmail — demo režim", () => {
  const originalDemo = process.env.NEXT_PUBLIC_DEMO_MODE
  const originalKey = process.env.RESEND_API_KEY

  beforeEach(() => {
    vi.resetModules()
    posalji.mockReset()
    posalji.mockResolvedValue({ data: { id: "stvarni-id" }, error: null })
  })

  afterEach(() => {
    if (originalDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE
    else process.env.NEXT_PUBLIC_DEMO_MODE = originalDemo
    if (originalKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalKey
  })

  const args = { to: ["neko@example.org"], subject: "Test", html: "<p>x</p>" }

  it("NE dodiruje mrežu čak ni kad RESEND_API_KEY postoji", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "1"
    process.env.RESEND_API_KEY = "re_stvarni_kljuc"
    const { sendEmail } = await import("./resend")

    const res = await sendEmail(args)

    expect(posalji).not.toHaveBeenCalled()
    expect(res.demo).toBe(true)
    expect(res.dryRun).toBe(true)
  })

  it("bez demo režima šalje normalno", async () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE
    process.env.RESEND_API_KEY = "re_stvarni_kljuc"
    const { sendEmail } = await import("./resend")

    const res = await sendEmail(args)

    expect(posalji).toHaveBeenCalledTimes(1)
    expect(res.demo).toBeUndefined()
    expect(res.dryRun).toBe(false)
    expect(res.id).toBe("stvarni-id")
  })

  it("obični dry-run (nema ključa) NIJE demo — razlikuje se u dnevniku", async () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE
    delete process.env.RESEND_API_KEY
    const { sendEmail } = await import("./resend")

    const res = await sendEmail(args)

    expect(posalji).not.toHaveBeenCalled()
    expect(res.dryRun).toBe(true)
    expect(res.demo).toBeUndefined()
  })
})
