import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"

/**
 * Ruta /api/cron/reminders: vremenski budžet (b) i signal neuspjeha (c) iz B3.
 *
 * Odvojeno od app/api/cron/reminders/route.test.ts, koji pokriva gating i redoslijed
 * krugova; ovdje se ne ponavlja ni jedan od tih scenarija. Sva tri kruga su mockovana
 * jer se testira ODLUKA rute (koji rok proslijedi i kojim statusom odgovori), ne
 * ponašanje petlji — to je pokriveno u runPostDue.test.ts / runDigest.test.ts.
 */
const { runRemindersMock, runPostDueMock, runDigestMock, isCronAuthorizedMock, createAdminSupabaseClientMock, envMock } =
  vi.hoisted(() => ({
    runRemindersMock: vi.fn(),
    runPostDueMock: vi.fn(),
    runDigestMock: vi.fn(),
    isCronAuthorizedMock: vi.fn(),
    createAdminSupabaseClientMock: vi.fn(),
    envMock: {
      CRON_SECRET: "test-cron-secret" as string | undefined,
      RESEND_API_KEY: "re_test_key" as string | undefined,
      EMAIL_FROM: undefined as string | undefined,
    },
  }))

vi.mock("@/lib/reminders/runReminders", () => ({ runReminders: (...a: unknown[]) => runRemindersMock(...a) }))
vi.mock("@/lib/reminders/runPostDue", () => ({ runPostDue: (...a: unknown[]) => runPostDueMock(...a) }))
vi.mock("@/lib/reminders/runDigest", () => ({ runDigest: (...a: unknown[]) => runDigestMock(...a) }))
vi.mock("@/lib/reminders/cronAuth", () => ({ isCronAuthorized: (...a: unknown[]) => isCronAuthorizedMock(...a) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => createAdminSupabaseClientMock() }))
vi.mock("@/lib/env", () => ({ env: envMock }))

import { GET, POST, maxDuration } from "@/app/api/cron/reminders/route"

function makeSupabase() {
  const supabase = {
    from(table: string) {
      if (table !== "postavke") throw new Error(`neočekivan from(${table}) u testu`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              // Jučerašnji marker → pre-due se STVARNO pokreće, pa runRemindersMock
              // odlučuje o rezultatu. Sa današnjim markerom bi ruta koristila statički
              // "preskocen" objekat i mock ne bi imao nikakav efekat.
              data: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-19" },
              error: null,
            }),
          }),
        }),
        // Lanac pokriva i oslobodiPreDueKrug (.update().eq().eq().select()) i stariji
        // oblik (.update().eq()) — ovaj test ne zavisi od toga kako se dnevni krug
        // zauzima, samo od budžeta i statusa.
        update: () => {
          const eq = () => ({ eq, select: async () => ({ data: [{ id: 1 }], error: null }), then: undefined })
          return { eq }
        },
      }
    },
    // Atomski claim dnevnog pre-due kruga (claim_pre_due): uvijek "zauzeto", da bi
    // pre-due stvarno pozvao runReminders i mockovani rezultat imao efekta.
    async rpc() {
      return { data: "zauzeto", error: null }
    },
  }
  return supabase as unknown as SupabaseClient<Database>
}

function req(): Request {
  return new Request("http://localhost/api/cron/reminders", {
    method: "GET",
    headers: { Authorization: "Bearer test-cron-secret" },
  })
}

const prazanPreDue = { sent: [], skipped: [], errors: [], deferred: 0 }
const greska = (i: number) => ({ terminId: `t${i}`, danaPrije: 7, message: "Resend: connection refused" })
const poslat = (i: number) => ({ terminId: `t${i}`, danaPrije: 7, to: ["a@x.com"], resendId: `re_${i}`, dryRun: false })

// Beogradski datum 2026-07-20, lokalno 11:00 → sat >= 8 i marker je jučerašnji,
// pa sva tri kruga stvarno idu (gating je pokriven u route.test.ts).
const SADA = new Date("2026-07-20T09:00:00Z")

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(SADA)
  isCronAuthorizedMock.mockReturnValue(true)
  runRemindersMock.mockReset().mockResolvedValue({ ...prazanPreDue })
  runPostDueMock.mockReset().mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0, prekinutoZbogVremena: false })
  runDigestMock.mockReset().mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0, prekinutoZbogVremena: false })
  createAdminSupabaseClientMock.mockReset().mockReturnValue(makeSupabase())
  envMock.CRON_SECRET = "test-cron-secret"
  envMock.RESEND_API_KEY = "re_test_key"
})

afterEach(() => {
  vi.useRealTimers()
})

describe("cron/reminders — vremenski budžet se prosljeđuje krugovima", () => {
  it("post-due i digest dobijaju APSOLUTNE rokove unutar maxDuration, post-due raniji od digesta", async () => {
    const pocetak = Date.now()
    await GET(req())

    const rokPostDue = runPostDueMock.mock.calls[0]![1].deadlineAt as number
    const rokDigest = runDigestMock.mock.calls[0]![1].deadlineAt as number

    expect(typeof rokPostDue).toBe("number")
    expect(typeof rokDigest).toBe("number")
    // Post-due mora stati ranije, inače bi backlog isteklih pojeo cijeli budžet i
    // digest nikad ne bi ni krenuo.
    expect(rokPostDue).toBeLessThan(rokDigest)
    // Oba roka su STROGO prije trenutka u kojem Vercel ubija funkciju — to je cijela
    // poenta: prekid mora biti naš i uredan, ne kill usred slanja.
    expect(rokDigest).toBeLessThan(pocetak + maxDuration * 1000)
    expect(rokPostDue).toBeGreaterThan(pocetak)
  })

  it("dryRun ne poništava budžet (posalji se spaja sa rokom, ne prepisuje ga)", async () => {
    await GET(req())
    const args = runPostDueMock.mock.calls[0]![1] as Record<string, unknown>
    expect(args).toHaveProperty("deadlineAt")
  })

  it("odgoda iz krugova se sabira u dijagnostiku odgovora", async () => {
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 137, prekinutoZbogVremena: true })
    runDigestMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 4, prekinutoZbogVremena: false })

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200) // odgoda NIJE greška — sljedeći prolaz nastavlja
    expect(body.dijagnostika.odgodjeno).toBe(141)
    expect(body.dijagnostika.prekinutoZbogVremena).toBe(true)
  })

  it("stari oblik rezultata (bez deferred) ne pravi NaN u dijagnostici", async () => {
    // Skripte i stariji pozivaoci vraćaju samo sent/skipped/errors.
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })
    runDigestMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await GET(req())
    const body = await res.json()

    expect(body.dijagnostika.odgodjeno).toBe(0)
    expect(body.dijagnostika.prekinutoZbogVremena).toBe(false)
  })
})

describe("cron/reminders — kvar slanja mora biti vidljiv kao 5xx", () => {
  it("sva slanja padnu → 500, a tijelo i dalje nosi pune rezultate", async () => {
    // B3(c): prije popravke je ovo bilo 200 i u Vercel nadzoru se nije razlikovalo
    // od mirnog dana — potpuni ispad Resend-a je bio nevidljiv.
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [greska(1), greska(2), greska(3)], deferred: 0 })

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.dijagnostika).toMatchObject({ poslato: 0, greske: 3, udioGresaka: 1 })
    expect(body.preDue.errors).toHaveLength(3) // rezultati se ne gube time što je run crven
    expect(body).toHaveProperty("postDue")
    expect(body).toHaveProperty("digest")
  })

  it("greške u post-due i digest krugu se broje isto kao pre-due", async () => {
    runPostDueMock.mockResolvedValue({
      sent: [], skipped: [], errors: [{ terminId: "t1", kanal: "interni", message: "resend pao" }],
      deferred: 0, prekinutoZbogVremena: false,
    })
    runDigestMock.mockResolvedValue({
      sent: [], skipped: [], errors: [{ email: "a@x.com", message: "resend pao" }],
      deferred: 0, prekinutoZbogVremena: false,
    })

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.dijagnostika.greske).toBe(2)
  })

  it("tačno na pragu (50% grešaka) → 500", async () => {
    runRemindersMock.mockResolvedValue({ sent: [poslat(1)], skipped: [], errors: [greska(2)], deferred: 0 })

    const res = await GET(req())
    expect(res.status).toBe(500)
    expect((await res.json()).dijagnostika.udioGresaka).toBe(0.5)
  })

  it("pojedinačna greška u zdravom run-u (udio < praga) ostaje 200", async () => {
    // Transientni pad jednog mejla se sam oporavlja (claim ostaje 'u_toku', RPC ga
    // vrati za 15 minuta) i ne smije farbati cijeli cron u crveno.
    runRemindersMock.mockResolvedValue({
      sent: [poslat(1), poslat(2), poslat(3), poslat(4), poslat(5), poslat(6), poslat(7), poslat(8), poslat(9)],
      skipped: [], errors: [greska(10)], deferred: 0,
    })

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.dijagnostika).toMatchObject({ poslato: 9, greske: 1, udioGresaka: 0.1 })
  })

  it("run bez ijednog pokušaja slanja (miran dan) je 200, ne 500", async () => {
    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.dijagnostika).toMatchObject({ poslato: 0, greske: 0, udioGresaka: 0 })
  })

  it("skipovi se NE broje kao greške (dva schedulera koja se preklope su normalno stanje)", async () => {
    runPostDueMock.mockResolvedValue({
      sent: [], errors: [],
      skipped: [
        { terminId: "t1", kanal: "interni", razlog: "claim drži neko drugi" },
        { terminId: "t2", kanal: "interni", razlog: "nema primalaca" },
      ],
      deferred: 0, prekinutoZbogVremena: false,
    })

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.dijagnostika.greske).toBe(0)
  })

  it("ručni POST pri istom kvaru ostaje 200, ali nosi slanjeNeispravno u tijelu", async () => {
    // Dugme „Pokreni sada" u postavkama na !res.ok odbacuje tijelo i prikazuje samo
    // generičku poruku — 500 bi čovjeku oduzeo brojače grešaka. Signal ostaje u tijelu.
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [greska(1), greska(2)], deferred: 0 })

    const res = await POST(new Request("http://localhost/api/cron/reminders", {
      method: "POST",
      headers: { Authorization: "Bearer test-cron-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: false }),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.dijagnostika.slanjeNeispravno).toBe(true)
    expect(body.dijagnostika.greske).toBe(2)
    expect(body.preDue.errors).toHaveLength(2)
  })

  it("isti kvar preko GET-a (Vercel Cron) daje 500 — nadzor vidi crveni run", async () => {
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [greska(1), greska(2)], deferred: 0 })

    const res = await GET(req())

    expect(res.status).toBe(500)
    expect((await res.json()).dijagnostika.slanjeNeispravno).toBe(true)
  })

  it("pad cijelog digest kruga sam po sebi ostaje 200 (pre-due/post-due su već poslali)", async () => {
    runRemindersMock.mockResolvedValue({ sent: [poslat(1)], skipped: [], errors: [], deferred: 0 })
    runDigestMock.mockRejectedValue(new Error("get_istekli_termini ne postoji"))

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.digest).toEqual({ error: expect.stringContaining("get_istekli_termini ne postoji") })
    expect(body.dijagnostika.greske).toBe(0)
  })
})
