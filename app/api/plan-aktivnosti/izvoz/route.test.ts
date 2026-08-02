import { describe, it, expect, vi, beforeEach } from "vitest"
import ExcelJS from "exceljs"
import { PDFDocument } from "pdf-lib"

/**
 * C4: izvoz plana je povlačio redove jednim upitom bez `.range()`. Supabase PostgREST
 * ima `max-rows = 1000` → sve preko 1000 redova je TIHO nestajalo iz fajla, dok je
 * brojač u modalu (`count: "exact", head: true`) pokazivao pun broj.
 *
 * Lažni klijent ispod vjerno modeluje tu granicu: koliko god da se traži, nikad ne
 * vrati više od 1000 redova po upitu.
 */
const PG_MAX_ROWS = 1000

type Red = Record<string, unknown>
let baza: Red[] = []
let rangePozivi: Array<[number, number]> = []
let brojUpita = 0

function napraviUpit(head: boolean) {
  let od = 0
  // Kad `.range()` nije pozvan, PostgREST i dalje vraća najviše max-rows redova.
  let doIndeks = PG_MAX_ROWS - 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  for (const m of ["select", "order", "eq", "or", "gte", "lte", "neq", "ilike", "in", "not"]) {
    b[m] = () => b
  }
  b.range = (a: number, z: number) => {
    od = a
    doIndeks = z
    return b
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  b.then = (res: any, rej: any) => {
    brojUpita++
    if (head) return Promise.resolve({ data: null, count: baza.length, error: null }).then(res, rej)
    rangePozivi.push([od, doIndeks])
    const kolicina = Math.min(doIndeks - od + 1, PG_MAX_ROWS)
    return Promise.resolve({ data: baza.slice(od, od + kolicina), count: null, error: null })
      .then(res, rej)
  }
  return b
}

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    from: () => ({
      select: (_sel: string, opts?: { head?: boolean }) => napraviUpit(!!opts?.head),
    }),
  }),
}))
vi.mock("@/lib/auth/zahtijevaj-preuzimanje", () => ({
  smijeTrenutniPreuzeti: async () => true,
}))

// Špijuni koji zovu PRAVI generator — dokazuju i broj redova i da je fajl stvaran.
const xlsxRedovi = vi.fn()
const pdfRedovi = vi.fn()
vi.mock("@/lib/plan-izvoz/xlsx", async (orig) => {
  const stvarni = await orig<typeof import("@/lib/plan-izvoz/xlsx")>()
  return {
    planToXlsx: (rows: unknown[], meta: never) => {
      xlsxRedovi(rows.length)
      return stvarni.planToXlsx(rows as never, meta)
    },
  }
})
vi.mock("@/lib/plan-izvoz/pdf", async (orig) => {
  const stvarni = await orig<typeof import("@/lib/plan-izvoz/pdf")>()
  return {
    planToPdf: (rows: unknown[], meta: never) => {
      pdfRedovi(rows.length)
      return stvarni.planToPdf(rows as never, meta)
    },
  }
})

const { GET } = await import("./route")
const { IZVOZ_MAX_REDOVA } = await import("@/lib/plan-izvoz/stranicenje")

function napuni(n: number) {
  baza = Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    klijent_naziv: `Klijent ${i}`,
    lokacija_naziv: `Lokacija ${i}`,
    vrsta_naziv: "Pregled",
    rok_dospijeca: "2026-08-15",
    datum_prikaza: "2026-08-15",
    status_izvedeni: "planirano",
    interval_mjeseci: 12,
    zaduzeni: "Marko",
    nacin_izvrsenja: "izvrsava",
  }))
}

// NextRequest se u testu dobija preko `new NextRequest`, ali ruta koristi samo
// `req.nextUrl.searchParams` — dovoljno je bilo šta sa tim oblikom.
function zahtjev(qs: string) {
  const url = new URL(`http://localhost/api/plan-aktivnosti/izvoz${qs}`)
  return { nextUrl: url } as unknown as Parameters<typeof GET>[0]
}

describe("GET /api/plan-aktivnosti/izvoz — straničenje (C4)", () => {
  beforeEach(() => {
    baza = []
    rangePozivi = []
    brojUpita = 0
    xlsxRedovi.mockReset()
    pdfRedovi.mockReset()
  })

  it("XLSX sa 1234 reda sadrži SVIH 1234 (prije popravke: 1000)", async () => {
    napuni(1234)
    const res = await GET(zahtjev("?period=svi&opseg=sve&format=xlsx"))
    expect(res.status).toBe(200)
    expect(xlsxRedovi).toHaveBeenCalledWith(1234)

    // Provjera nad STVARNIM fajlom, ne samo nad ulazom u generator.
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ws = wb.worksheets[0]!
    // red 1 naslov, 2 podnaslov, 3 napomena/prazno, 4 zaglavlje → podaci od reda 5.
    expect(ws.rowCount - 4).toBe(1234)
    expect(ws.getRow(5).getCell(1).value).toBe("Klijent 0")
    expect(ws.getRow(4 + 1234).getCell(1).value).toBe("Klijent 1233")
  })

  it("PDF sa 1234 reda dobije svih 1234 i stvaran je PDF", async () => {
    napuni(1234)
    const res = await GET(zahtjev("?period=svi&opseg=sve&format=pdf"))
    expect(res.status).toBe(200)
    expect(pdfRedovi).toHaveBeenCalledWith(1234)
    const bajtovi = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(bajtovi.slice(0, 5))).toBe("%PDF-")
    const pdf = await PDFDocument.load(bajtovi)
    expect(pdf.getPageCount()).toBeGreaterThan(40)
  })

  it("legacy grana (bez `period`) takođe stranici", async () => {
    napuni(1500)
    const res = await GET(zahtjev("?mjesec=svi&format=xlsx"))
    expect(res.status).toBe(200)
    expect(xlsxRedovi).toHaveBeenCalledWith(1500)
  })

  it("nijedan upit ne traži više od PostgREST max-rows", async () => {
    napuni(2500)
    await GET(zahtjev("?period=svi&opseg=sve&format=xlsx"))
    expect(rangePozivi.length).toBeGreaterThan(1)
    for (const [od, doIndeks] of rangePozivi) {
      expect(doIndeks - od + 1).toBeLessThanOrEqual(PG_MAX_ROWS)
    }
  })

  it("preko gornje granice: 413 sa jasnom porukom, BEZ generisanja fajla", async () => {
    napuni(IZVOZ_MAX_REDOVA + 1)
    const res = await GET(zahtjev("?period=svi&opseg=sve&format=xlsx"))
    expect(res.status).toBe(413)
    const json = (await res.json()) as { error: string }
    // Granica mora biti u poruci (next-intl je formatira lokalizovano: 5000 / 5.000).
    expect(json.error.replace(/[., \s]/g, "")).toContain(String(IZVOZ_MAX_REDOVA))
    expect(xlsxRedovi).not.toHaveBeenCalled()
    expect(pdfRedovi).not.toHaveBeenCalled()
  })

  it("tačno na granici još uvijek prolazi", async () => {
    napuni(IZVOZ_MAX_REDOVA)
    const res = await GET(zahtjev("?period=svi&opseg=sve&format=xlsx"))
    expect(res.status).toBe(200)
    expect(xlsxRedovi).toHaveBeenCalledWith(IZVOZ_MAX_REDOVA)
  })

  it("brojač (count=1) javlja granicu i prekoračenje, pa modal ne može lagati", async () => {
    napuni(IZVOZ_MAX_REDOVA + 7)
    const res = await GET(zahtjev("?period=svi&opseg=sve&count=1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      broj: IZVOZ_MAX_REDOVA + 7,
      granica: IZVOZ_MAX_REDOVA,
      prekoracenje: true,
    })
  })

  it("brojač ispod granice = isti broj koji će biti u fajlu", async () => {
    napuni(1234)
    const cres = await GET(zahtjev("?period=svi&opseg=sve&count=1"))
    const { broj, prekoracenje } = (await cres.json()) as { broj: number; prekoracenje: boolean }
    expect(prekoracenje).toBe(false)
    const fres = await GET(zahtjev("?period=svi&opseg=sve&format=xlsx"))
    expect(fres.status).toBe(200)
    expect(xlsxRedovi).toHaveBeenCalledWith(broj)
  })
})
