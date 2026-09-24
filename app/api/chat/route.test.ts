import { describe, it, expect, vi, beforeEach } from "vitest"

// B6: asistent je poslovno ADMIN-ONLY (`/asistent` i `/zapisnici` redirektuju ne-admina),
// ali je ruta do 02.08.2026. odbijala samo ulogu `pregled` — operater je direktnim POST-om
// mogao trošiti model i čitati podatke kroz alate asistenta.

const korisnik = vi.fn()
const runChat = vi.fn()

vi.mock("@/lib/auth/current-user", () => ({ getTrenutniKorisnik: () => korisnik() }))
vi.mock("@/lib/claude/chat", () => ({ runChat: (...a: unknown[]) => runChat(...a) }))
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    // Rate-limit brojač namjerno vraća grešku: ako zahtjev DOĐE dovde, uloga je prošla gejt.
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ gte: async () => ({ error: { message: "stop" }, count: null }) }) }),
      }),
    }),
  }),
}))

const { POST } = await import("./route")

const tijelo = () =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({
      konverzacija_id: "11111111-1111-4111-8111-111111111111",
      userText: "zdravo",
    }),
  })

const kaoUloga = (uloga: string | null) =>
  korisnik.mockResolvedValue(uloga === null ? null : { id: "u1", ime: "X", uloga, dozvole: {} })

describe("POST /api/chat — pristup asistentu", () => {
  beforeEach(() => {
    korisnik.mockReset()
    runChat.mockReset()
  })

  it("operater dobija 403 i model se NE poziva", async () => {
    kaoUloga("operater")
    const res = await POST(tijelo())
    expect(res.status).toBe(403)
    expect(runChat).not.toHaveBeenCalled()
  })

  it("pregled dobija 403", async () => {
    kaoUloga("pregled")
    expect((await POST(tijelo())).status).toBe(403)
    expect(runChat).not.toHaveBeenCalled()
  })

  it("neprijavljen dobija 401", async () => {
    kaoUloga(null)
    expect((await POST(tijelo())).status).toBe(401)
  })

  it("admin prolazi gejt uloge (pada tek na sljedećem koraku, ne na 403)", async () => {
    kaoUloga("admin")
    const res = await POST(tijelo())
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(500) // rate-limit brojač je mockovan da padne
  })
})
