import { describe, it, expect, vi, beforeEach } from "vitest"

// Prvi test fajl u components/ — obrazac koji radi ne treba renderer: KoStaPrimaTab je
// async server component, a JSX unutra su obični objekti ({ type, props }) čim se funkcija
// pozove (jsx-runtime konstruiše elemente sinhrono, bez DOM-a). Testovi zato samo pozovu
// `await KoStaPrimaTab()` i obiđu vraćeno stablo tražeći `data-testid`/tekst — bez
// react-dom, bez Testing Library. Supabase se mockuje builderom koji vodi dnevnik poziva
// (za dokaz da su `.range()`/`{count:"exact"}` STVARNO pozvani, ne samo da podaci "štimuju"),
// next-intl/server i tri "use client" pod-komponente se mockuju da modul ostane izolovan i
// da se ne povlači cijeli client-action graf (SaljiFirmiToggle/UkljuciSlanjeFirmamaButton
// uvoze server action fajlove) koji ovom testu ništa ne dokazuje.

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => createServerSupabaseClientMock(),
}))

vi.mock("next-intl/server", () => ({
  // Prevod nije predmet ovog testa (pokriven json-parity testovima u koStaPrima.test.ts) —
  // mock vraća ključ (+ interpolirane parametre) umjesto stvarnog teksta, da asertacije
  // budu čitljive i neosjetljive na promjenu formulacije u messages/*.json.
  getTranslations:
    async (_ns?: string) =>
      (key: string, params?: Record<string, unknown>) => {
        if (!params) return key
        const dio = Object.entries(params)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(",")
        return `${key}{${dio}}`
      },
}))

vi.mock("./CollapsibleSection", () => ({ CollapsibleSection: () => null }))
vi.mock("./SaljiFirmiToggle", () => ({ SaljiFirmiToggle: () => null }))
vi.mock("./UkljuciSlanjeFirmamaButton", () => ({ UkljuciSlanjeFirmamaButton: () => null }))

// vi.mock je hoistovan iznad importa (isti obrazac kao route.test.ts).
import { KoStaPrimaTab } from "./KoStaPrimaTab"

// ---- Stablo elemenata: obilazak bez renderera --------------------------------------------

type ReactEl = { type: unknown; props: Record<string, unknown> }

function isElement(node: unknown): node is ReactEl {
  return typeof node === "object" && node !== null && "props" in (node as Record<string, unknown>)
}

function childrenOf(node: unknown): unknown[] {
  if (!isElement(node)) return []
  const c = node.props.children
  if (c === null || c === undefined) return []
  return Array.isArray(c) ? c : [c]
}

function* walk(node: unknown): Generator<unknown> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n)
    return
  }
  if (node === null || node === undefined || node === false || node === true) return
  yield node
  for (const c of childrenOf(node)) yield* walk(c)
}

function findByTestId(root: unknown, testId: string): ReactEl | undefined {
  for (const node of walk(root)) {
    if (isElement(node) && node.props["data-testid"] === testId) return node
  }
  return undefined
}

/** Sav tekst (string/number listovi) unutar podstabla datog čvora, spojen. */
function textOf(node: unknown): string {
  let out = ""
  for (const n of walk(node)) {
    if (typeof n === "string" || typeof n === "number") out += String(n)
  }
  return out
}

// ---- Mock Supabase query buildera, sa dnevnikom poziva -----------------------------------

type Row = Record<string, unknown>
type Call = { table: string; method: string; args: unknown[] }

function makeSupabaseMock(cfg: {
  postavke?: Row | null
  korisnici?: Row[]
  klijenti?: Row[]
  korisnik_klijent?: Row[]
  kontakt_osobe?: Row[]
  lokacije?: Row[]
}) {
  const calls: Call[] = []
  const tableRows: Record<string, Row[]> = {
    korisnici: cfg.korisnici ?? [],
    klijenti: cfg.klijenti ?? [],
    korisnik_klijent: cfg.korisnik_klijent ?? [],
    kontakt_osobe: cfg.kontakt_osobe ?? [],
    lokacije: cfg.lokacije ?? [],
  }

  function builder(table: string) {
    let countExact = false
    let ranged: { from: number; to: number } | null = null

    const chain = {
      select(cols: string, opts?: { count?: string }) {
        calls.push({ table, method: "select", args: [cols, opts] })
        countExact = opts?.count === "exact"
        return chain
      },
      eq(col: string, val: unknown) {
        calls.push({ table, method: "eq", args: [col, val] })
        return chain
      },
      order(col: string) {
        calls.push({ table, method: "order", args: [col] })
        return chain
      },
      range(from: number, to: number) {
        calls.push({ table, method: "range", args: [from, to] })
        ranged = { from, to }
        return chain
      },
      maybeSingle: async () => ({ data: cfg.postavke ?? null, error: null }),
      // Chain je thenable — `await` radi bilo gdje se lanac završi (sa ili bez .range()),
      // baš zato da mutant koji ukloni .range() i dalje "radi" (ali ga dnevnik poziva uhvati).
      then(resolve: (v: { data: Row[]; count: number | null; error: null }) => void) {
        const rows = tableRows[table] ?? []
        const data = ranged ? rows.slice(ranged.from, ranged.to + 1) : rows
        resolve({ data, count: countExact ? rows.length : null, error: null })
      },
    }
    return chain
  }

  return {
    supabase: { from: (table: string) => builder(table) },
    calls,
    pozivi: (table: string, method: string) => calls.filter((c) => c.table === table && c.method === method),
  }
}

const LOK_A = { id: "locA", naziv: "Lokacija A", klijent_id: "k1" }
const LOK_B = { id: "locB", naziv: "Lokacija B", klijent_id: "k1" }

beforeEach(() => {
  createServerSupabaseClientMock.mockReset()
})

describe("KoStaPrimaTab — wiring (mutation-killing)", () => {
  it("baznо: red se renderuje sa testid-jem i nazivom firme", async () => {
    const { supabase } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
      klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
      kontakt_osobe: [],
      lokacije: [],
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    const root = await KoStaPrimaTab()

    const red = findByTestId(root, "ksp-red-k1")
    expect(red).toBeDefined()
    expect(textOf(red)).toContain("Firma Jedna")
  })

  it("MUTANT #6 (najgori — bug koji je ova grana popravila): brojAdresaFirme mora doći iz `grupa.firma`, NE iz `grupa.sve`", async () => {
    // k1 ima kontakt vezan SAMO za locA (nema firma-široku adresu). locB nema ništa.
    // Ispravno: brojAdresaFirme=0 (firma prazna) → locB se prijavljuje kao nepokrivena.
    // Mutant koji koristi grupa.sve (sadrži i lokacijske adrese) bi vidio sve.size=1>0 i
    // PRIJAVIO „sve pokriveno" — tačno kvar zbog kojeg ovaj cijeli posao postoji.
    const { supabase } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
      klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
      lokacije: [LOK_A, LOK_B],
      kontakt_osobe: [
        { klijent_id: "k1", email: "kontakt.locA@firma.ba", podsjetnik_primalac: true, lokacija_id: "locA" },
      ],
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    const root = await KoStaPrimaTab()

    const upozorenje = findByTestId(root, "ksp-nepokrivene-k1")
    expect(upozorenje).toBeDefined()
    const tekst = textOf(upozorenje)
    expect(tekst).toContain("Lokacija B")
    expect(tekst).not.toContain("Lokacija A")
  })

  it("MUTANT gejt uklonjen na pozivnom mjestu: kad trebaUpozorenje vrati false (saljiFirmi isključen), upozorenje se NE prikazuje uprkos rupi", async () => {
    // Ista rupa kao gore (locB nepokrivena), ali k1 ima saljiFirmi=false → firma uopšte ne
    // prima (razlog "firma"), pa je upozorenje o lokaciji šum/duplikat i ne smije se pojaviti.
    const { supabase } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
      klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: false, podsjetnik_emails: [] }],
      lokacije: [LOK_A, LOK_B],
      kontakt_osobe: [
        { klijent_id: "k1", email: "kontakt.locA@firma.ba", podsjetnik_primalac: true, lokacija_id: "locA" },
      ],
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    const root = await KoStaPrimaTab()

    expect(findByTestId(root, "ksp-nepokrivene-k1")).toBeUndefined()
    // Kontrolna provjera da smo pogodili pravu granu: razlog mora biti "firma".
    expect(textOf(findByTestId(root, "ksp-razlog-k1"))).toContain("razlogFirma")
  })

  it("MUTANT gejt na pogrešnom predikatu (firmaPrima umjesto pravog predikata): automatika isključena ne smije sakriti upozorenje", async () => {
    // podsjetnici_aktivni=false → firmaPrima=false (razlog "automatika"), ALI
    // trebaUpozorenje namjerno IGNORIŠE automatiku (isto kao brojAdresaKandidata — važi i za
    // "Pokreni sada"), pa upozorenje MORA ostati vidljivo uprkos firmaPrima===false.
    // Mutant koji gejtuje na `firmaPrima` bi ga ovdje pogrešno sakrio.
    const { supabase } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: false },
      klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
      lokacije: [LOK_A, LOK_B],
      kontakt_osobe: [
        { klijent_id: "k1", email: "kontakt.locA@firma.ba", podsjetnik_primalac: true, lokacija_id: "locA" },
      ],
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    const root = await KoStaPrimaTab()

    expect(textOf(findByTestId(root, "ksp-prima-k1"))).toContain("ne") // firmaPrima===false
    expect(textOf(findByTestId(root, "ksp-razlog-k1"))).toContain("razlogAutomatika")
    const upozorenje = findByTestId(root, "ksp-nepokrivene-k1")
    expect(upozorenje).toBeDefined() // upozorenje i dalje prisutno
    expect(textOf(upozorenje)).toContain("Lokacija B")
  })

  it("MUTANT fallback `|| l.id` uklonjen: prazan naziv lokacije se prikazuje kao id, ne kao prazan string", async () => {
    // trebaUpozorenje treba brojAdresa>0 da bi uopšte prikazao upozorenje — zato locB ima
    // svoj kontakt (firma NIJE prazna adresa-wise), a lokPrazna (prazan naziv) nema ništa i
    // firma nema firma-široku adresu, pa ostaje nepokrivena i mora se pojaviti u tekstu.
    const lokPrazna = { id: "loc-prazna-id", naziv: "", klijent_id: "k1" }
    const { supabase } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
      klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
      lokacije: [lokPrazna, LOK_B],
      kontakt_osobe: [
        { klijent_id: "k1", email: "kontakt.locB@firma.ba", podsjetnik_primalac: true, lokacija_id: "locB" },
      ],
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    const root = await KoStaPrimaTab()

    const tekst = textOf(findByTestId(root, "ksp-nepokrivene-k1"))
    expect(tekst).toContain("loc-prazna-id")
    expect(tekst).not.toContain("Lokacija B")
  })

  it("MUTANT .range()/count:\"exact\" uklonjeni sa kontakt_osobe: dnevnik poziva dokazuje da su STVARNO pozvani (ne samo da podaci štimuju)", async () => {
    const { supabase, pozivi } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
      klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
      kontakt_osobe: [],
      lokacije: [],
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    await KoStaPrimaTab()

    const rangePozivi = pozivi("kontakt_osobe", "range")
    expect(rangePozivi).toHaveLength(1)
    expect(rangePozivi[0]!.args).toEqual([0, 4999])

    const selectPozivi = pozivi("kontakt_osobe", "select")
    expect(selectPozivi).toHaveLength(1)
    expect(selectPozivi[0]!.args[1]).toEqual({ count: "exact" })
  })
})
