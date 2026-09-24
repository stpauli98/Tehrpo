/**
 * N11 — `generated_by_ai` u tabeli `dokumenti` mora odgovarati STVARNOM porijeklu teksta.
 * Prije popravke je bio hardkodiran na `true`, pa je i čisti šablon (dry-run, bez
 * ANTHROPIC_API_KEY) završavao u bazi kao AI-generisan zapisnik.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/storage", () => ({
  uploadDokument: vi.fn(async () => undefined),
  removeDokument: vi.fn(async () => undefined),
}))

type Red = Record<string, unknown>

function lazniSupabase(sakupi: (r: Red) => void) {
  return {
    from: () => ({ insert: async (r: Red) => { sakupi(r); return { error: null } } }),
  } as never
}

const OPTS = {
  terminId: "00000000-0000-0000-0000-000000000001",
  klijentId: "00000000-0000-0000-0000-000000000002",
  vrstaNaziv: "Pregled aparata",
  datum: "2026-07-15",
  docx: Buffer.from("PK"),
  uploadGreskaFallback: "greška",
}

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
})

async function snimiIVrati(opts: Partial<typeof OPTS> & { izvor?: "model" | "sablon" } = {}) {
  const { snimiZapisnikDokument } = await import("./snimi")
  let red: Red | null = null
  const res = await snimiZapisnikDokument(lazniSupabase((r) => { red = r }), { ...OPTS, ...opts })
  expect(res.ok).toBe(true)
  return red as Red | null
}

describe("snimiZapisnikDokument — porijeklo sadržaja ne laže", () => {
  // `generated_by_ai` odgovara na pitanje „je li dokument generisan ili otpremljen?" i za
  // svaki zapisnik iz ovog puta je tačno — zato je UVIJEK true. Odakle mu tekst je zasebno
  // pitanje i nosi ga `zapisnik_izvor`. Ranije je jedna kolona pokušavala odgovoriti na oba,
  // pa je šablonski zapisnik izgledao kao ručno otpremljen dokument.

  it("bez ANTHROPIC_API_KEY (šablon je jedino moguće) -> izvor 'sablon', ali i dalje generisan", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    const red = await snimiIVrati()
    expect(red?.zapisnik_izvor).toBe("sablon")
    expect(red?.generated_by_ai).toBe(true)
  })

  it("ZAPISNIK_DRY_RUN=1 uz postojeći ključ -> izvor 'sablon'", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-lazni")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "1")
    const red = await snimiIVrati()
    expect(red?.zapisnik_izvor).toBe("sablon")
    expect(red?.generated_by_ai).toBe(true)
  })

  it("ključ postoji i dry-run je isključen -> izvor 'model'", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-lazni")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    const red = await snimiIVrati()
    expect(red?.zapisnik_izvor).toBe("model")
    expect(red?.generated_by_ai).toBe(true)
    expect(red?.tip).toBe("zapisnik")
  })

  it("eksplicitan izvor pozivaoca pobjeđuje izvođenje iz okruženja", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-lazni")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "")
    expect((await snimiIVrati({ izvor: "sablon" }))?.zapisnik_izvor).toBe("sablon")
    expect((await snimiIVrati({ izvor: "model" }))?.zapisnik_izvor).toBe("model")
  })

  it("oznaka AI zapisnika u UI ostaje i za šablonski sadržaj (regresija e2e 08/35)", async () => {
    // DokumentiSekcija prikazuje badge po `generated_by_ai`. E2E vozi ZAPISNIK_DRY_RUN=1, pa bi
    // vezivanje badge-a za porijeklo teksta oborilo 08-dokumenti i 35-dokument-pregled na oba browsera.
    vi.stubEnv("ANTHROPIC_API_KEY", "")
    vi.stubEnv("ZAPISNIK_DRY_RUN", "1")
    expect((await snimiIVrati())?.generated_by_ai).toBe(true)
  })
})
