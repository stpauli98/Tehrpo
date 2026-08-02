import { describe, it, expect, vi, beforeEach } from "vitest"

// B6: pregled je do 02.08.2026. vraćao SIROVI potpisani Storage URL — bearer token u
// query stringu, upotrebljiv 10 min bez sesije, sa bilo kog uređaja. Ovi testovi drže
// da odgovor više ne nosi Storage URL i da sadržaj ide kroz server.

const maybeSingle = vi.fn()
const downloadDokument = vi.fn()
const signedUrl = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}))
vi.mock("@/lib/supabase/storage", () => ({
  downloadDokument: (...a: unknown[]) => downloadDokument(...a),
  signedUrl: (...a: unknown[]) => signedUrl(...a),
}))
vi.mock("mammoth", () => ({ default: { convertToHtml: async () => ({ value: "<p>x</p>" }) } }))

const { GET } = await import("./route")

const params = Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" })
const zahtjev = (qs = "") =>
  new Request(`http://localhost/api/dokumenti/11111111-1111-1111-1111-111111111111/pregled${qs}`)

function dokument(mime: string | null, naziv = "nalaz.pdf") {
  maybeSingle.mockResolvedValue({
    data: { storage_path: "termini/t1/abc.pdf", naziv, mime_type: mime },
    error: null,
  })
}

describe("GET /api/dokumenti/[id]/pregled", () => {
  beforeEach(() => {
    maybeSingle.mockReset()
    downloadDokument.mockReset()
    signedUrl.mockReset()
  })

  it("metapodaci za PDF NE sadrže potpisani Storage URL, nego rutu ove aplikacije", async () => {
    dokument("application/pdf")
    const res = await GET(zahtjev(), { params })
    const json = await res.json()
    expect(json.vrsta).toBe("url")
    expect(json.url).toBe(
      "/api/dokumenti/11111111-1111-1111-1111-111111111111/pregled?sadrzaj=1",
    )
    expect(json.url).not.toMatch(/^https?:/)
    expect(json.url).not.toMatch(/token=/)
    expect(signedUrl).not.toHaveBeenCalled() // nijedan potpisani URL se više ne pravi
  })

  it("?sadrzaj=1 streamuje bajtove sa nosniff + no-store i bez preusmjerenja na Storage", async () => {
    dokument("image/png", "slika.png")
    downloadDokument.mockResolvedValue(Buffer.from([1, 2, 3, 4]))
    const res = await GET(zahtjev("?sadrzaj=1"), { params })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/png")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it("dokument koji korisnik ne smije vidjeti (RLS prazan red) je 404 i ne dira Storage", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const res = await GET(zahtjev("?sadrzaj=1"), { params })
    expect(res.status).toBe(404)
    expect(downloadDokument).not.toHaveBeenCalled()
  })

  it("SVG (izvršni sadržaj) se ne servira sa našeg origin-a — ni kao metapodatak ni kao stream", async () => {
    dokument("image/svg+xml", "xss.svg")
    const meta = await (await GET(zahtjev(), { params })).json()
    expect(meta.vrsta).toBe("nedostupan")
    const res = await GET(zahtjev("?sadrzaj=1"), { params })
    expect(res.status).toBe(415)
    expect(downloadDokument).not.toHaveBeenCalled()
  })

  it("DOCX i dalje ide kroz mammoth (HTML), ne kroz stream", async () => {
    dokument(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "zapisnik.docx",
    )
    downloadDokument.mockResolvedValue(Buffer.from("docx"))
    const json = await (await GET(zahtjev(), { params })).json()
    expect(json).toMatchObject({ vrsta: "html", html: "<p>x</p>" })
  })

  it("ime fajla sa ne-ASCII znakovima ne razbija Content-Disposition", async () => {
    dokument("application/pdf", 'Zapisnik "ŽŠĆ".pdf')
    downloadDokument.mockResolvedValue(Buffer.from([0]))
    const res = await GET(zahtjev("?sadrzaj=1"), { params })
    const cd = res.headers.get("Content-Disposition") ?? ""
    expect(cd).toContain("filename*=UTF-8''")
    expect(cd).not.toMatch(/[^\x20-\x7e]/) // header ostaje čist ASCII
  })
})
