import { describe, it, expect, vi, beforeEach } from "vitest"

// B6: uloga `pregled` je do 02.08.2026. mogla pokrenuti plaćeno AI generisanje zapisnika i
// upis fajla u Storage (service-role klijent ne vidi RLS) — odbijenicu je dobijala tek na
// DB insertu, kad su i model i blob već potrošeni. Gejt uloge sada ide PRVI.

const korisnik = vi.fn()
const generateZapisnik = vi.fn()
const buildZapisnikDocx = vi.fn()
const snimiZapisnikDokument = vi.fn()
const uploadDokument = vi.fn()
const maybeSingle = vi.fn()

vi.mock("@/lib/auth/current-user", () => ({ getTrenutniKorisnik: () => korisnik() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/supabase/storage", () => ({
  uploadDokument: (...a: unknown[]) => uploadDokument(...a),
  removeDokument: vi.fn(),
}))
vi.mock("@/lib/zapisnik/generate", () => ({
  generateZapisnik: (...a: unknown[]) => generateZapisnik(...a),
}))
vi.mock("@/lib/zapisnik/template", () => ({
  buildZapisnikDocx: (...a: unknown[]) => buildZapisnikDocx(...a),
}))
vi.mock("@/lib/zapisnik/snimi", () => ({
  snimiZapisnikDokument: (...a: unknown[]) => snimiZapisnikDokument(...a),
}))
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      insert: async () => ({ error: null }),
    }),
  }),
}))

const { generateZapisnikAction, uploadDokumentAction, uploadKlijentDokumentAction } =
  await import("./actions")

const TERMIN = "11111111-1111-4111-8111-111111111111"
const KLIJENT = "22222222-2222-4222-8222-222222222222"

const kaoUloga = (uloga: string | null) =>
  korisnik.mockResolvedValue(uloga === null ? null : { id: "u1", ime: "X", uloga, dozvole: {} })

function fajl(): File {
  return new File([new Uint8Array([1, 2, 3])], "nalaz.pdf", { type: "application/pdf" })
}

describe("dokumenti akcije — gejt uloge prije modela i Storage-a", () => {
  beforeEach(() => {
    korisnik.mockReset()
    generateZapisnik.mockReset()
    buildZapisnikDocx.mockReset()
    snimiZapisnikDokument.mockReset()
    uploadDokument.mockReset()
    maybeSingle.mockReset()
    generateZapisnik.mockResolvedValue({ nalaz: "n", zakljucak: "z" })
    buildZapisnikDocx.mockResolvedValue(Buffer.from("docx"))
    snimiZapisnikDokument.mockResolvedValue({ ok: true })
    maybeSingle.mockResolvedValue({
      data: {
        id: TERMIN,
        klijent_id: KLIJENT,
        klijent_naziv: "Firma",
        lokacija_naziv: null,
        vrsta_naziv: "ZNR",
        datum_izvrsenja: "2026-07-01",
        zaduzeni: null,
        status: "izvrseno",
      },
      error: null,
    })
  })

  it("pregled ne pokreće generisanje zapisnika — model se NE zove, Storage se NE dira", async () => {
    kaoUloga("pregled")
    const fd = new FormData()
    fd.set("termin_id", TERMIN)
    const r = await generateZapisnikAction({ ok: true }, fd)
    expect(r.ok).toBe(false)
    expect(generateZapisnik).not.toHaveBeenCalled()
    expect(buildZapisnikDocx).not.toHaveBeenCalled()
    expect(snimiZapisnikDokument).not.toHaveBeenCalled()
  })

  it("operater i dalje generiše zapisnik (gejt ne lomi normalan put)", async () => {
    kaoUloga("operater")
    const fd = new FormData()
    fd.set("termin_id", TERMIN)
    const r = await generateZapisnikAction({ ok: true }, fd)
    expect(r).toEqual({ ok: true })
    expect(generateZapisnik).toHaveBeenCalledTimes(1)
    expect(snimiZapisnikDokument).toHaveBeenCalledTimes(1)
  })

  it("pregled ne upload-uje dokument na termin — nema osirotjelog blob-a", async () => {
    kaoUloga("pregled")
    const fd = new FormData()
    fd.set("termin_id", TERMIN)
    fd.set("tip", "strucni_nalaz")
    fd.set("file", fajl())
    const r = await uploadDokumentAction({ ok: true }, fd)
    expect(r.ok).toBe(false)
    expect(uploadDokument).not.toHaveBeenCalled()
  })

  it("pregled ne upload-uje dokument na klijenta", async () => {
    kaoUloga("pregled")
    const fd = new FormData()
    fd.set("klijent_id", KLIJENT)
    fd.set("tip", "ostalo")
    fd.set("file", fajl())
    const r = await uploadKlijentDokumentAction({ ok: true }, fd)
    expect(r.ok).toBe(false)
    expect(uploadDokument).not.toHaveBeenCalled()
  })

  it("neprijavljen (istekla sesija) ne prolazi ni jedan put pisanja", async () => {
    kaoUloga(null)
    const fd = new FormData()
    fd.set("termin_id", TERMIN)
    expect((await generateZapisnikAction({ ok: true }, fd)).ok).toBe(false)
    expect(generateZapisnik).not.toHaveBeenCalled()
  })
})
