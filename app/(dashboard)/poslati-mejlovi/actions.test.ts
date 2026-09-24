import { describe, it, expect, vi, beforeEach } from "vitest"

// B6: `OznaciPregledanimButton` sakriva dugme ulozi `pregled`, ali server akcija je javni
// endpoint — do 02.08.2026. nije bilo NIJEDNE serverske provjere, pa je read-only uloga
// mogla pisati u `mejl_log` (RPC je SECURITY DEFINER, RLS ga ne dodiruje).

const korisnik = vi.fn()
const rpc = vi.fn()

vi.mock("@/lib/auth/current-user", () => ({ getTrenutniKorisnik: () => korisnik() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (k: string) => k,
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}))

const { oznaciPregledanim } = await import("./actions")

const ID = "11111111-1111-4111-8111-111111111111"
const kaoUloga = (uloga: string | null) =>
  korisnik.mockResolvedValue(uloga === null ? null : { id: "u1", ime: "X", uloga, dozvole: {} })

describe("oznaciPregledanim — serverski gejt uloge", () => {
  beforeEach(() => {
    korisnik.mockReset()
    rpc.mockReset()
    rpc.mockResolvedValue({ error: null })
  })

  it("pregled ne dolazi do RPC-a", async () => {
    kaoUloga("pregled")
    const r = await oznaciPregledanim(ID)
    expect(r).toEqual({ ok: false, message: "oznacavanjeNijeDozvoljeno" })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("neprijavljen ne dolazi do RPC-a", async () => {
    kaoUloga(null)
    expect((await oznaciPregledanim(ID)).ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("operater i dalje označava (gejt ne lomi normalan put)", async () => {
    kaoUloga("operater")
    expect(await oznaciPregledanim(ID)).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith("oznaci_mejl_pregledan", { p_id: ID })
  })

  it("admin i dalje označava", async () => {
    kaoUloga("admin")
    expect(await oznaciPregledanim(ID)).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith("oznaci_mejl_pregledan", { p_id: ID })
  })
})
