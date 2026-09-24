import { describe, it, expect, vi, beforeEach } from "vitest"
import poruke from "@/messages/sr.json"

/**
 * B4 — konkurentnost nad JEDNIM terminom.
 *
 * Sve tri akcije su bile read-modify-write bez ijednog uslova u samom UPDATE-u, pa je
 * dovoljno da dva čovjeka rade u istoj sekundi (ili da jedan ima otvoren stari ekran):
 *   - „Spremi izmjene" prepiše zatvaranje koje je kolega upravo upisao → status
 *     'zakazano' SA datum_izvrsenja i sa već napravljenim sljedećim ciklusom;
 *   - „Označi izvršeno" iz zastarjelog ekrana prepiše tuđi datum izvršenja (a
 *     tg_termini_korekcija_datuma to propagira i na dijete → pomjeren zakonski rok);
 *   - „Otkaži" pretvori IZVRŠEN termin u otkazan.
 * U sva tri slučaja je akcija vraćala ok:true i korisnik je vjerovao da je sačuvano.
 *
 * Fake klijent ispod modeliranje radi nad JEDNIM redom i STVARNO primjenjuje filtere
 * (eq/neq/is) — inače test ne bi mogao razlikovati guard od njegovog izostanka.
 */

type Red = Record<string, unknown>

const stanje: { red: Red | null; poslijeCitanja?: () => void } = { red: null }

function odgovaraFilterima(red: Red, filteri: Array<[string, string, unknown]>): boolean {
  return filteri.every(([op, kolona, vrijednost]) => {
    const stvarna = red[kolona] ?? null
    if (op === "eq") return stvarna === vrijednost
    if (op === "neq") return stvarna !== vrijednost
    if (op === "is") return stvarna === vrijednost
    throw new Error(`nepoznat filter ${op}`)
  })
}

function upit(vrsta: "select" | "update", patch?: Red) {
  const filteri: Array<[string, string, unknown]> = []
  const pogodak = (): Red | null => {
    const red = stanje.red
    if (!red || !odgovaraFilterima(red, filteri)) return null
    return red
  }
  const chain = {
    eq(kolona: string, vrijednost: unknown) {
      filteri.push(["eq", kolona, vrijednost])
      return chain
    },
    neq(kolona: string, vrijednost: unknown) {
      filteri.push(["neq", kolona, vrijednost])
      return chain
    },
    is(kolona: string, vrijednost: unknown) {
      filteri.push(["is", kolona, vrijednost])
      return chain
    },
    limit() {
      return Promise.resolve({ data: pogodak() ? [pogodak()] : [], error: null })
    },
    async maybeSingle() {
      const red = pogodak()
      // Hook: „drugi korisnik" upisuje SVOJU izmjenu tačno između čitanja i upisa —
      // prozor u kojem read-modify-write gubi tuđe podatke.
      const kopija = red ? { ...red } : null
      stanje.poslijeCitanja?.()
      stanje.poslijeCitanja = undefined
      return { data: kopija, error: null }
    },
    async select() {
      if (vrsta === "select") {
        const red = pogodak()
        return { data: red ? [red] : [], error: null }
      }
      const red = pogodak()
      if (!red) return { data: [], error: null }
      Object.assign(red, patch, { updated_at: new Date(Date.now() + 1000).toISOString() })
      return { data: [{ id: red.id }], error: null }
    },
  }
  return chain
}

const supabaseFake = {
  from(tabela: string) {
    if (tabela !== "termini") throw new Error(`neočekivan from(${tabela}) u testu`)
    return {
      select: () => upit("select"),
      update: (patch: Red) => upit("update", patch),
    }
  },
  rpc: async () => ({ data: [], error: null }),
}

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => supabaseFake,
}))
vi.mock("@/lib/auth/current-user", () => ({
  getTrenutniKorisnik: async () => ({ id: "u1", ime: "Admin", uloga: "admin", dozvole: {} }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/reminders/zakazanoNakonRoka", () => ({
  posaljiZakazanoNakonRoka: async () => ({ razlog: "ok" }),
}))

const { updateTermin, markIzvrseno, otkaziTermin } = await import("./actions")

const ID = "33333333-3333-4333-8333-333333333333"
const KLIJENT = "11111111-1111-4111-8111-111111111111"
const IZMIJENIO_DRUGI = poruke.termini.actions.izmijenioDrugi
const NIJE_DOSTUPAN = poruke.termini.actions.terminNijeDostupan

function postaviRed(izmjene: Red = {}) {
  stanje.red = {
    id: ID,
    klijent_id: KLIJENT,
    status: "planirano",
    rok_dospijeca: "2026-12-01",
    datum_zakazan: null,
    datum_izvrsenja: null,
    zaduzeni: null,
    napomena: null,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...izmjene,
  }
}

function fd(polja: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(polja)) f.append(k, v)
  return f
}

beforeEach(() => {
  stanje.red = null
  stanje.poslijeCitanja = undefined
})

describe("updateTermin — guard na verziju reda", () => {
  it("normalan upis (niko ne dira red u međuvremenu) prolazi i sinhronizuje status", async () => {
    postaviRed()
    const r = await updateTermin({ ok: true }, fd({ id: ID, datum_zakazan: "2026-08-20" }))
    expect(r).toEqual({ ok: true })
    expect(stanje.red).toMatchObject({ status: "zakazano", datum_zakazan: "2026-08-20" })
  })

  it("kolega označi izvršeno između čitanja i upisa → ok:false uz poruku, red netaknut", async () => {
    postaviRed()
    stanje.poslijeCitanja = () => {
      // Ono što radi markIzvrseno u drugoj sesiji (uz trigger koji podiže updated_at).
      Object.assign(stanje.red!, {
        status: "izvrseno",
        datum_izvrsenja: "2026-08-01",
        updated_at: "2026-08-01T10:00:05.000Z",
      })
    }

    const r = await updateTermin({ ok: true }, fd({ id: ID, datum_zakazan: "2026-08-20" }))

    expect(r).toEqual({ ok: false, message: IZMIJENIO_DRUGI })
    // Bez guarda bi ovdje stajalo status='zakazano' SA datum_izvrsenja — stanje koje po
    // modelu ne postoji i koje novi CHECK (chk_termini_datum_samo_izvrseno) odbija.
    expect(stanje.red).toMatchObject({
      status: "izvrseno",
      datum_izvrsenja: "2026-08-01",
      datum_zakazan: null,
    })
  })

  it("red je u međuvremenu obrisan (ili je van dosega RLS-a) → jasna poruka, ne lažni ok", async () => {
    stanje.red = null
    const r = await updateTermin({ ok: true }, fd({ id: ID, napomena: "x" }))
    expect(r).toEqual({ ok: false, message: NIJE_DOSTUPAN })
  })
})

describe("markIzvrseno — guard na već zatvoren termin", () => {
  it("kolega je već zatvorio termin sa DRUGIM datumom → odbija se, datum se ne prepisuje", async () => {
    postaviRed({ status: "izvrseno", datum_izvrsenja: "2026-07-20" })

    const r = await markIzvrseno({ ok: true }, fd({ id: ID, datum_izvrsenja: "2026-07-25" }))

    expect(r).toEqual({ ok: false, message: IZMIJENIO_DRUGI })
    expect(stanje.red).toMatchObject({ datum_izvrsenja: "2026-07-20" })
  })

  it("ponovljeni submit sa ISTIM datumom je idempotentan (ok:true, bez lažne greške)", async () => {
    postaviRed({ status: "izvrseno", datum_izvrsenja: "2026-07-20" })
    const r = await markIzvrseno({ ok: true }, fd({ id: ID, datum_izvrsenja: "2026-07-20" }))
    expect(r).toEqual({ ok: true })
  })

  it("otvoren termin se normalno zatvara", async () => {
    postaviRed({ status: "zakazano", datum_zakazan: "2026-07-19" })
    const r = await markIzvrseno({ ok: true }, fd({ id: ID, datum_izvrsenja: "2026-07-20" }))
    expect(r).toEqual({ ok: true })
    expect(stanje.red).toMatchObject({ status: "izvrseno", datum_izvrsenja: "2026-07-20" })
  })
})

describe("otkaziTermin — izvršen termin se ne otkazuje", () => {
  it("zastarjeli ekran pokušava otkazati IZVRŠEN termin → odbija se, status ostaje izvrseno", async () => {
    postaviRed({ status: "izvrseno", datum_izvrsenja: "2026-07-20" })

    const r = await otkaziTermin({ ok: true }, fd({ id: ID }))

    expect(r).toEqual({ ok: false, message: IZMIJENIO_DRUGI })
    expect(stanje.red).toMatchObject({ status: "izvrseno", datum_izvrsenja: "2026-07-20" })
  })

  it("planiran termin se normalno otkazuje", async () => {
    postaviRed()
    const r = await otkaziTermin({ ok: true }, fd({ id: ID }))
    expect(r).toEqual({ ok: true })
    expect(stanje.red).toMatchObject({ status: "otkazano" })
  })

  it("dvoklik na otkazivanje ostaje uspješan (idempotentno)", async () => {
    postaviRed({ status: "otkazano" })
    const r = await otkaziTermin({ ok: true }, fd({ id: ID }))
    expect(r).toEqual({ ok: true })
  })
})
