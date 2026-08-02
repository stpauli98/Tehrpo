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
  termini?: Row[]
}) {
  const calls: Call[] = []
  const tableRows: Record<string, Row[]> = {
    korisnici: cfg.korisnici ?? [],
    klijenti: cfg.klijenti ?? [],
    korisnik_klijent: cfg.korisnik_klijent ?? [],
    kontakt_osobe: cfg.kontakt_osobe ?? [],
    lokacije: cfg.lokacije ?? [],
    // `.eq`/`.is` STVARNO filtriraju (vidi builder ispod) — `cfg.termini` ovdje nosi SIROVE
    // redove (mogu imati i `lokacija_id` postavljen), da mutant koji ukloni/zamijeni filter
    // na termini upitu (M5/M11) propusti pogrešne redove kroz i test to uhvati.
    termini: cfg.termini ?? [],
  }

  function builder(table: string) {
    let countExact = false
    let ranged: { from: number; to: number } | null = null
    const predikati: Array<(r: Row) => boolean> = []

    const chain = {
      select(cols: string, opts?: { count?: string }) {
        calls.push({ table, method: "select", args: [cols, opts] })
        countExact = opts?.count === "exact"
        return chain
      },
      eq(col: string, val: unknown) {
        calls.push({ table, method: "eq", args: [col, val] })
        predikati.push((r) => r[col] === val)
        return chain
      },
      is(col: string, val: unknown) {
        calls.push({ table, method: "is", args: [col, val] })
        // `IS` u SQL/PostgREST tretira nedostajuću kolonu kao NULL (za razliku od `=`,
        // koje na NULL nikad ne pogađa) — otud `?? null`, da mock ostane vjeran stvarnom
        // ponašanju i da mutant is→eq stvarno promijeni rezultat filtriranja.
        predikati.push((r) => (r[col] ?? null) === val)
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
        const sve = tableRows[table] ?? []
        const filtrirano = predikati.length > 0 ? sve.filter((r) => predikati.every((p) => p(r))) : sve
        const data = ranged ? filtrirano.slice(ranged.from, ranged.to + 1) : filtrirano
        resolve({ data, count: countExact ? filtrirano.length : null, error: null })
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

  // ---- termini bez lokacije -----------------------------------------------------------

  it("upozorenje se pojavljuje kad firma ima termine bez lokacije, a nema adresu koja pokriva cijelu firmu", async () => {
    // k1 ima SAMO lokacijski kontakt (locX — namjerno bez odgovarajućeg reda u `lokacije`,
    // da izolujemo tvrdnju od postojeće „nepokrivene lokacije" poruke) → brojAdresaFirme=0,
    // ali adrese.length=1 (pa trebaUpozorenje uopšte razmatra red). Termin bez lokacije za
    // k1 postoji → poruka o terminima bez lokacije mora se pojaviti.
    const { supabase } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
      klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
      lokacije: [],
      kontakt_osobe: [
        { klijent_id: "k1", email: "kontakt.locX@firma.ba", podsjetnik_primalac: true, lokacija_id: "locX" },
      ],
      termini: [{ klijent_id: "k1", lokacija_id: null }],
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    const root = await KoStaPrimaTab()

    const upozorenje = findByTestId(root, "ksp-nepokrivene-k1")
    expect(upozorenje).toBeDefined()
    expect(textOf(upozorenje)).toContain("terminiBezLokacijeNepokriveni")
  })

  it("ne pojavljuje se kad firma ima adresu koja pokriva cijelu firmu, uprkos terminima bez lokacije", async () => {
    // Isti termin bez lokacije kao gore, ali kontakt je sada firma-širok (lokacija_id: null)
    // → brojAdresaFirme=1 pokriva i termine bez lokacije i (nepostojeće) lokacije.
    const { supabase } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
      klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
      lokacije: [],
      kontakt_osobe: [
        { klijent_id: "k1", email: "kontakt.firma@firma.ba", podsjetnik_primalac: true, lokacija_id: null },
      ],
      termini: [{ klijent_id: "k1", lokacija_id: null }],
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    const root = await KoStaPrimaTab()

    expect(findByTestId(root, "ksp-nepokrivene-k1")).toBeUndefined()
  })

  it("odsijecanje novog upita (termini bez lokacije) pali baner o nepotpunim podacima", async () => {
    // Preko RASPON_GORNJA_GRANICA+1 (5000) redova → `count` (puna dužina) veći od `data`
    // (isječeno na .range(0, 4999)) → jeOdsjeceno vraća true baš za ovaj upit.
    const mnogoTermina = Array.from({ length: 5001 }, () => ({ klijent_id: "k1", lokacija_id: null }))
    const { supabase } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
      klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
      kontakt_osobe: [],
      lokacije: [],
      termini: mnogoTermina,
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    const root = await KoStaPrimaTab()

    expect(findByTestId(root, "ksp-nepotpuni-banner")).toBeDefined()
  })

  it("termini upit koristi .is(\"lokacija_id\", null) — poziv se bilježi u dnevniku, i red čiji termin IMA lokaciju ne proizvodi upozorenje o terminima bez lokacije (M11: is→eq)", async () => {
    // k1 ima SAMO lokacijski kontakt (locZ, bez odgovarajuće `lokacije` — izoluje se od
    // „nepokrivene lokacije" poruke) → brojAdresaFirme=0, adrese.length=1 (gejt otvoren).
    // Jedini termin k1 IMA lokaciju (locX) → nakon ispravnog is(lokacija_id, null) filtera
    // taj red uopšte ne ulazi u `terminiBezLokacijeRes`, pa upozorenje ne smije da se pojavi.
    const { supabase, pozivi } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
      klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
      lokacije: [],
      kontakt_osobe: [
        { klijent_id: "k1", email: "kontakt.locZ@firma.ba", podsjetnik_primalac: true, lokacija_id: "locZ" },
      ],
      termini: [{ klijent_id: "k1", lokacija_id: "locX" }],
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    const root = await KoStaPrimaTab()

    const isPozivi = pozivi("termini", "is")
    expect(isPozivi).toHaveLength(1)
    expect(isPozivi[0]!.args).toEqual(["lokacija_id", null])
    expect(findByTestId(root, "ksp-nepokrivene-k1")).toBeUndefined()
  })

  it("klijentiSaTerminimaBezLokacije mora biti per-firma: k2 (termin SA lokacijom) ne smije naslijediti upozorenje k1 (termin BEZ lokacije) (M5/M8/M13)", async () => {
    // Dvije firme, obje sa SAMO lokacijskim kontaktom (brojAdresaFirme=0 za obje, gejt
    // otvoren jer adrese.length=1>0 za svaku). k1 ima termin bez lokacije → mora dobiti
    // upozorenje. k2 ima termin SA lokacijom (locY) → ne smije. Mutant koji ukloni/pokvari
    // filter na termini upitu (M5), hardkoduje imaTerminaBezLokacije na true (M8), ili
    // pretvori `.has(k.id)` u globalni `.size > 0` (M13) — bilo koji od njih bi k2 lažno
    // prijavio kao pogođenog.
    const { supabase } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
      klijenti: [
        { id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] },
        { id: "k2", naziv: "Firma Dva", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] },
      ],
      lokacije: [],
      kontakt_osobe: [
        { klijent_id: "k1", email: "k1@firma.ba", podsjetnik_primalac: true, lokacija_id: "locX" },
        { klijent_id: "k2", email: "k2@firma.ba", podsjetnik_primalac: true, lokacija_id: "locY" },
      ],
      termini: [
        { klijent_id: "k1", lokacija_id: null },
        { klijent_id: "k2", lokacija_id: "locY" },
      ],
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    const root = await KoStaPrimaTab()

    expect(findByTestId(root, "ksp-nepokrivene-k1")).toBeDefined()
    expect(findByTestId(root, "ksp-nepokrivene-k2")).toBeUndefined()
  })

  it("prazan spisak: sve lokacije pokrivene ali termini bez lokacije nisu → 'nepokriveneLokacije' dio se NE prikazuje, samo poruka o terminima (M12)", async () => {
    // LOK_A ima svoj kontakt → pokrivena (nepokrivene=[]). k1 nema firma-široku adresu
    // (kontakt je lokacijski) i ima termin bez lokacije → terminiBezLokacije=true, pa se
    // red i dalje prikazuje (uslov na liniji sa `r.terminiBezLokacije`), ali „Bez primaoca
    // za lokacije:" dio ne smije procuriti u tekst jer je nepokrivene.length === 0.
    const { supabase } = makeSupabaseMock({
      postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
      klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
      lokacije: [LOK_A],
      kontakt_osobe: [
        { klijent_id: "k1", email: "kontakt.locA@firma.ba", podsjetnik_primalac: true, lokacija_id: "locA" },
      ],
      termini: [{ klijent_id: "k1", lokacija_id: null }],
    })
    createServerSupabaseClientMock.mockResolvedValue(supabase)

    const root = await KoStaPrimaTab()

    const upozorenje = findByTestId(root, "ksp-nepokrivene-k1")
    expect(upozorenje).toBeDefined()
    const tekst = textOf(upozorenje)
    expect(tekst).toContain("terminiBezLokacijeNepokriveni")
    expect(tekst).not.toContain("nepokriveneLokacije")
  })

  // ---- PROVJERA PRED SLANJE (B5) -------------------------------------------------------
  // Ekran je jedino mjesto na kojem vlasnik prije prvog stvarnog slanja vidi ko bi šta dobio.
  // Adresa koju motor odbaci (`jeDostavljiva`) do sada je sa ekrana samo NESTAJALA — izgledala
  // je kao da nikad nije ni unesena. Ovi testovi brane da odbacivanje bude vidljivo.

  describe("odbačene adrese su vidljive, ne tiho izostavljene", () => {
    it("admin sa nerutabilnom adresom: banner ga imenuje, a spisak „uvijek primaju“ ga NE sadrži", async () => {
      const { supabase } = makeSupabaseMock({
        postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
        korisnici: [
          { id: "a1", ime: "Test Admin", email: "admin@tehpro.local", uloga: "admin", aktivan: true, prima_podsjetnike: true },
          { id: "a2", ime: "Pravi Admin", email: "sef@tehpro.ba", uloga: "admin", aktivan: true, prima_podsjetnike: true },
        ],
        klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
        kontakt_osobe: [],
        lokacije: [],
      })
      createServerSupabaseClientMock.mockResolvedValue(supabase)

      const root = await KoStaPrimaTab()

      const banner = findByTestId(root, "ksp-stalni-odbaceni-banner")
      expect(banner).toBeDefined()
      expect(textOf(banner)).toContain("admin@tehpro.local")
      const uvijek = textOf(findByTestId(root, "ksp-uvijek-primaju"))
      expect(uvijek).toContain("sef@tehpro.ba")
      expect(uvijek).not.toContain("admin@tehpro.local")
    })

    it("bez ijedne odbačene adrese banner se ne prikazuje (nije stalno upozorenje)", async () => {
      const { supabase } = makeSupabaseMock({
        postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
        korisnici: [
          { id: "a2", ime: "Pravi Admin", email: "sef@tehpro.ba", uloga: "admin", aktivan: true, prima_podsjetnike: true },
        ],
        klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
        kontakt_osobe: [],
        lokacije: [],
      })
      createServerSupabaseClientMock.mockResolvedValue(supabase)

      expect(findByTestId(await KoStaPrimaTab(), "ksp-stalni-odbaceni-banner")).toBeUndefined()
    })

    it("neaktivan admin sa nerutabilnom adresom NE pali banner (motor ga ionako ne bi ni razmatrao)", async () => {
      const { supabase } = makeSupabaseMock({
        postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
        korisnici: [
          { id: "a1", ime: "Test Admin", email: "admin@tehpro.local", uloga: "admin", aktivan: false, prima_podsjetnike: true },
          { id: "a3", ime: "Opt-out", email: "admin@tehpro.test", uloga: "admin", aktivan: true, prima_podsjetnike: false },
        ],
        klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
        kontakt_osobe: [],
        lokacije: [],
      })
      createServerSupabaseClientMock.mockResolvedValue(supabase)

      expect(findByTestId(await KoStaPrimaTab(), "ksp-stalni-odbaceni-banner")).toBeUndefined()
    })

    it("firmina adresa na rezervisanom domenu (example.com) se imenuje u redu firme", async () => {
      // Najopasniji slučaj: red i dalje kaže „prima" (brojAdresa računa EMAIL_RE-validne),
      // a motor ne bi poslao NIŠTA. Bez ove poruke ekran bi tvrdio nešto neistinito.
      const { supabase } = makeSupabaseMock({
        postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
        klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["dokumentacija@example.com"] }],
        kontakt_osobe: [
          { klijent_id: "k1", email: "sef@firma.local", podsjetnik_primalac: true, lokacija_id: null },
          { klijent_id: "k1", email: "uredan@firma.ba", podsjetnik_primalac: true, lokacija_id: null },
        ],
        lokacije: [],
      })
      createServerSupabaseClientMock.mockResolvedValue(supabase)

      const root = await KoStaPrimaTab()

      const red = findByTestId(root, "ksp-odbacene-k1")
      expect(red).toBeDefined()
      const tekst = textOf(red)
      expect(tekst).toContain("dokumentacija@example.com")
      expect(tekst).toContain("sef@firma.local")
      expect(tekst).not.toContain("uredan@firma.ba")
    })

    it("kontakt koji NIJE flagovan kao primalac se ne prijavljuje kao odbačen (nije ni kandidat)", async () => {
      const { supabase } = makeSupabaseMock({
        postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
        klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["uredan@firma.ba"] }],
        kontakt_osobe: [
          { klijent_id: "k1", email: "sef@firma.local", podsjetnik_primalac: false, lokacija_id: null },
        ],
        lokacije: [],
      })
      createServerSupabaseClientMock.mockResolvedValue(supabase)

      expect(findByTestId(await KoStaPrimaTab(), "ksp-odbacene-k1")).toBeUndefined()
    })

    it("gejt: dok firma ionako ne prima (saljiFirmi=false), spisak odbačenih je šum i ne prikazuje se", async () => {
      const { supabase } = makeSupabaseMock({
        postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
        klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: false, podsjetnik_emails: ["dokumentacija@example.com"] }],
        kontakt_osobe: [],
        lokacije: [],
      })
      createServerSupabaseClientMock.mockResolvedValue(supabase)

      const root = await KoStaPrimaTab()
      expect(findByTestId(root, "ksp-odbacene-k1")).toBeUndefined()
      expect(textOf(findByTestId(root, "ksp-razlog-k1"))).toContain("razlogFirma")
    })

    it("odbačena adresa jedne firme ne curi u red druge firme", async () => {
      const { supabase } = makeSupabaseMock({
        postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
        klijenti: [
          { id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["lose@example.com"] },
          { id: "k2", naziv: "Firma Dva", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["dobro@firma.ba"] },
        ],
        kontakt_osobe: [],
        lokacije: [],
      })
      createServerSupabaseClientMock.mockResolvedValue(supabase)

      const root = await KoStaPrimaTab()
      expect(findByTestId(root, "ksp-odbacene-k1")).toBeDefined()
      expect(findByTestId(root, "ksp-odbacene-k2")).toBeUndefined()
    })
  })

  describe("gejt trebaUpozorenje mora važiti i za terminiBezLokacije, ne samo za nepokrivene lokacije (M15)", () => {
    // Sva tri testa: k1 ima termin bez lokacije (bi trebalo terminiBezLokacije=true da nije
    // gejta) — svaki test zatvara gejt jednim drugim razlogom iz precedencije
    // (izracunajIshodReda/trebaUpozorenje): globalno, firma, nemaAdrese. Mutant koji računa
    // terminiBezLokacije mimo `trebaUpozorenje` ternarnog izraza bi ga u sva tri slučaja
    // pogrešno prikazao.

    it("saljiGlobalno (salji_klijentima) = false gasi i poruku o terminima bez lokacije", async () => {
      const { supabase } = makeSupabaseMock({
        postavke: { salji_klijentima: false, podsjetnici_aktivni: true },
        klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
        lokacije: [],
        kontakt_osobe: [
          { klijent_id: "k1", email: "k1@firma.ba", podsjetnik_primalac: true, lokacija_id: "locX" },
        ],
        termini: [{ klijent_id: "k1", lokacija_id: null }],
      })
      createServerSupabaseClientMock.mockResolvedValue(supabase)

      const root = await KoStaPrimaTab()

      expect(findByTestId(root, "ksp-nepokrivene-k1")).toBeUndefined()
    })

    it("saljiFirmi (salji_podsjetnik_klijentu) = false gasi i poruku o terminima bez lokacije", async () => {
      const { supabase } = makeSupabaseMock({
        postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
        klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: false, podsjetnik_emails: [] }],
        lokacije: [],
        kontakt_osobe: [
          { klijent_id: "k1", email: "k1@firma.ba", podsjetnik_primalac: true, lokacija_id: "locX" },
        ],
        termini: [{ klijent_id: "k1", lokacija_id: null }],
      })
      createServerSupabaseClientMock.mockResolvedValue(supabase)

      const root = await KoStaPrimaTab()

      expect(findByTestId(root, "ksp-nepokrivene-k1")).toBeUndefined()
    })

    it("brojAdresa = 0 (bez ijednog kontakta) gasi i poruku o terminima bez lokacije", async () => {
      const { supabase } = makeSupabaseMock({
        postavke: { salji_klijentima: true, podsjetnici_aktivni: true },
        klijenti: [{ id: "k1", naziv: "Firma Jedna", salji_podsjetnik_klijentu: true, podsjetnik_emails: [] }],
        lokacije: [],
        kontakt_osobe: [],
        termini: [{ klijent_id: "k1", lokacija_id: null }],
      })
      createServerSupabaseClientMock.mockResolvedValue(supabase)

      const root = await KoStaPrimaTab()

      expect(findByTestId(root, "ksp-nepokrivene-k1")).toBeUndefined()
    })
  })
})
