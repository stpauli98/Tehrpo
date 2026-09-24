import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"

// Modul zavisi od šest vanjskih stvari: runReminders, runPostDue, runDigest,
// createAdminSupabaseClient, isCronAuthorized i env. Sve se mockuju da test ne dodiruje ni
// mrežu ni bazu — gating (lokalniSatIDatum/trebaSlatiSada/podsjetniciAktivni) ostaje REALAN
// jer je čista funkcija vremena (već pokrivena u gating.test.ts) i kontroliše se preko
// vi.setSystemTime.
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

vi.mock("@/lib/reminders/runReminders", () => ({
  runReminders: (...args: unknown[]) => runRemindersMock(...args),
}))
vi.mock("@/lib/reminders/runPostDue", () => ({
  runPostDue: (...args: unknown[]) => runPostDueMock(...args),
}))
vi.mock("@/lib/reminders/runDigest", () => ({
  runDigest: (...args: unknown[]) => runDigestMock(...args),
}))
vi.mock("@/lib/reminders/cronAuth", () => ({
  isCronAuthorized: (...args: unknown[]) => isCronAuthorizedMock(...args),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => createAdminSupabaseClientMock(),
}))
vi.mock("@/lib/env", () => ({ env: envMock }))

// route.ts uvozi handle preko GET/POST (isti handler za oba).
import { GET, POST } from "./route"

type Postavke = {
  podsjetnici_aktivni?: boolean
  vrijeme_slanja_sat?: number
  zadnje_slanje_datum?: string | null
} | null

/**
 * Fake `postavke` + fake `claim_pre_due` (B4).
 *
 * Dnevni marker se od B4 zauzima ATOMSKI, RPC-om — ne čitanjem na početku i upisom na
 * kraju kruga. Mock zato oponaša STVARNU semantiku funkcije nad istim redom koji vraća
 * select: claim uspije samo ako `zadnje_slanje_datum` NIJE traženi datum, i tada ga
 * postavi. Bez toga bi test mogao tvrditi bilo šta o preskakanju kruga.
 *
 * `oslobodiPreDueKrug` (povrat claim-a kad pre-due padne) ide kroz običan update sa dva
 * filtera — `update().eq("id",1).eq("zadnje_slanje_datum", datum).select("id")` — pa
 * lanac mora podržati i taj oblik i vratiti pogođene redove.
 */
function makeSupabase(opts: {
  postavke?: Postavke
  onClaim?: () => void
  claimError?: string
  updateError?: string
}) {
  const stanje: Record<string, unknown> = { ...(opts.postavke ?? {}) }
  const imaRed = opts.postavke !== null && opts.postavke !== undefined
  const updateCalls: Array<{ patch: Record<string, unknown> }> = []
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  // O1 — otkucaj („srce") ide kroz isti klijent, ali NIJE dio toka odlučivanja: drži se
  // odvojeno da tvrdnje o `claim_pre_due` ostanu tačne bez obzira na telemetriju.
  const otkucaji: Array<Record<string, unknown>> = []
  const supabase = {
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "zabiljezi_cron_otkucaj") {
        otkucaji.push(args)
        return { data: null, error: null }
      }
      rpcCalls.push({ fn, args })
      opts.onClaim?.()
      if (fn !== "claim_pre_due") throw new Error(`neočekivan rpc(${fn}) u testu`)
      if (opts.claimError) return { data: null, error: { message: opts.claimError } }
      const datum = args.p_datum as string
      if (stanje.zadnje_slanje_datum === datum) return { data: null, error: null }
      stanje.zadnje_slanje_datum = datum
      return { data: datum, error: null }
    },
    from(table: string) {
      if (table !== "postavke") throw new Error(`neočekivan from(${table}) u testu`)
      const primijeni = (patch: Record<string, unknown>) => {
        updateCalls.push({ patch })
        if (opts.updateError) return { data: null, error: { message: opts.updateError } }
        Object.assign(stanje, patch)
        return { data: [{ id: 1 }], error: null }
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: imaRed ? stanje : null, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            // drugi filter (`zadnje_slanje_datum = datum`) → pogađa samo vlastiti claim
            eq: (_kolona: string, vrijednost: unknown) => ({
              select: async () =>
                stanje.zadnje_slanje_datum === vrijednost
                  ? primijeni(patch)
                  : { data: [], error: null },
            }),
          }),
        }),
      }
    },
  }
  return { supabase: supabase as unknown as SupabaseClient<Database>, updateCalls, rpcCalls, otkucaji, stanje }
}

function req(method: "GET" | "POST", opts?: { withAuth?: boolean; body?: unknown }): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (opts?.withAuth !== false) headers.Authorization = "Bearer test-cron-secret"
  return new Request("http://localhost/api/cron/reminders", {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

// Europe/Belgrade, ljeti CEST (UTC+2): 2026-07-08T07:00:00Z → lokalno 09:00, datum 2026-07-08 (isto kao gating.test.ts).
const IZNAD_SATA = new Date("2026-07-08T07:00:00Z")
// Lokalno 06:00 — ispod praga 8.
const ISPOD_SATA = new Date("2026-07-08T04:00:00Z")

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(IZNAD_SATA)
  isCronAuthorizedMock.mockReturnValue(true)
  runRemindersMock.mockReset()
  runPostDueMock.mockReset()
  runDigestMock.mockReset()
  runDigestMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })
  createAdminSupabaseClientMock.mockReset()
  envMock.CRON_SECRET = "test-cron-secret"
  envMock.RESEND_API_KEY = "re_test_key"
})

afterEach(() => {
  vi.useRealTimers()
})

describe("GET /api/cron/reminders", () => {
  it("1. podsjetnici_aktivni=false → 200 skip, RESEND_API_KEY se ne dodiruje, ništa se ne poziva", async () => {
    envMock.RESEND_API_KEY = undefined // da dokažemo da provjera ključa nije ni dosegnuta (inače 500)
    const { supabase } = makeSupabase({ postavke: { podsjetnici_aktivni: false, vrijeme_slanja_sat: 8 } })
    createAdminSupabaseClientMock.mockReturnValue(supabase)

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, skipped: "podsjetnici_iskljuceni" })
    expect(runRemindersMock).not.toHaveBeenCalled()
    expect(runPostDueMock).not.toHaveBeenCalled()
  })

  it("2. lokalni sat < vrijeme_slanja_sat → 200 skip, ništa se ne poziva", async () => {
    vi.setSystemTime(ISPOD_SATA)
    envMock.RESEND_API_KEY = undefined
    const { supabase } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: null },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, skipped: "izvan_sata" })
    expect(runRemindersMock).not.toHaveBeenCalled()
    expect(runPostDueMock).not.toHaveBeenCalled()
  })

  it("3. marker je današnji lokalni datum → runReminders NE, runPostDue DA, claim se ne ni pokušava", async () => {
    const { supabase, updateCalls, rpcCalls } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-08" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(runRemindersMock).not.toHaveBeenCalled()
    expect(runPostDueMock).toHaveBeenCalledTimes(1)
    expect(updateCalls).toHaveLength(0) // marker se NE prepisuje
    expect(rpcCalls).toHaveLength(0) // jeftin predfiltar je već odlučio — RPC nije potreban
    expect(body.preDue).toEqual({ sent: [], skipped: [], errors: [], deferred: 0, preskocen: "vec_slato_danas" })
  })

  it("4. marker nije današnji → claim se uzima PRIJE runReminders, pa tek onda post-due", async () => {
    const callOrder: string[] = []
    const { supabase, rpcCalls, stanje } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
      onClaim: () => callOrder.push("claim"),
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockImplementation(async () => {
      callOrder.push("preDue")
      return { sent: [], skipped: [], errors: [], deferred: 0 }
    })
    runPostDueMock.mockImplementation(async () => {
      callOrder.push("postDue")
      return { sent: [], skipped: [], errors: [] }
    })

    const res = await GET(req("GET"))

    expect(res.status).toBe(200)
    expect(runRemindersMock).toHaveBeenCalledTimes(1)
    expect(runPostDueMock).toHaveBeenCalledTimes(1)
    expect(rpcCalls).toEqual([{ fn: "claim_pre_due", args: { p_datum: "2026-07-08" } }])
    expect(stanje.zadnje_slanje_datum).toBe("2026-07-08")
    // Dokaz REDOSLIJEDA: dan se zauzima PRIJE nego što ijedan mejl krene — paralelni
    // poziv u tom prozoru mora naći zauzeto, a ne slati isti krug drugi put.
    expect(callOrder).toEqual(["claim", "preDue", "postDue"])
  })

  it("4b. claim vrati prazno (drugi run je već uzeo dan) → pre-due se preskače, post-due ide dalje", async () => {
    // Predfiltar ovdje NE pomaže: `zadnje_slanje_datum` je jučerašnji jer je paralelni
    // run još u toku i marker upisuje tek kroz svoj claim. Upravo je to prozor u kojem
    // je stara ruta pokretala isti krug drugi put.
    const { supabase, rpcCalls } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
    })
    // Paralelni run „stigne prvi": marker skoči na današnji tik prije našeg claim-a.
    const supa = supabase as unknown as { rpc: (fn: string, a: Record<string, unknown>) => Promise<unknown> }
    const original = supa.rpc.bind(supa)
    supa.rpc = async (fn, a) => {
      await original(fn, { ...a, p_datum: "2026-07-08" }) // tuđi claim
      return original(fn, a) // naš — mora naći zauzeto
    }
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(runRemindersMock).not.toHaveBeenCalled()
    expect(body.preDue.preskocen).toBe("vec_slato_danas")
    expect(runPostDueMock).toHaveBeenCalledTimes(1)
    expect(rpcCalls.length).toBeGreaterThan(0)
  })

  it("4c. DVA preklopljena poziva nad ISTIM redom → runReminders se pokreće TAČNO JEDNOM", async () => {
    // Srž B4: pre-due krug traje do ~50 s, a marker se ranije upisivao TEK na kraju.
    // Dva poziva u tom prozoru (Vercel retry, drugi region, „Pokreni sada" povrh cron-a)
    // oba su vidjela jučerašnji marker i oba su slala isti krug — mejl ide prije upisa u
    // `podsjetnici`, pa unique tamo hvata duplikat kad je već otišao klijentu.
    const { supabase, rpcCalls, stanje } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    // Spor krug: drugi zahtjev stiže dok prvi još radi.
    runRemindersMock.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ sent: [], skipped: [], errors: [], deferred: 0 }), 50)),
    )
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const oba = Promise.all([GET(req("GET")), GET(req("GET"))])
    await vi.advanceTimersByTimeAsync(100)
    const [a, b] = await oba
    const tijela = [await a.json(), await b.json()]

    expect(runRemindersMock).toHaveBeenCalledTimes(1)
    // Dan je zauzet ODMAH (prije prvog mejla), pa ga drugi poziv više ne dobija — bilo
    // preko claim-a, bilo preko predfiltra koji već vidi zauzeto. Ranije su oba slala.
    expect(rpcCalls.length).toBeGreaterThanOrEqual(1)
    expect(tijela.filter((t) => t.preDue.preskocen === "vec_slato_danas")).toHaveLength(1)
    expect(stanje.zadnje_slanje_datum).toBe("2026-07-08")
    expect(runPostDueMock).toHaveBeenCalledTimes(2) // post-due nije vezan za dnevni marker
  })

  it("5. neautorizovan zahtjev → 401, ne otkriva ništa o konfiguraciji", async () => {
    isCronAuthorizedMock.mockReturnValue(false)

    const res = await GET(req("GET", { withAuth: false }))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(Object.keys(body)).toEqual(["error"]) // ništa drugo (npr. razlog, konfig) se ne vraća
    expect(createAdminSupabaseClientMock).not.toHaveBeenCalled()
    expect(runRemindersMock).not.toHaveBeenCalled()
    expect(runPostDueMock).not.toHaveBeenCalled()
  })

  it("6. bez RESEND_API_KEY i bez dryRun, gating prošao → 500 sa jasnom porukom", async () => {
    envMock.RESEND_API_KEY = undefined
    const { supabase, updateCalls, rpcCalls, stanje } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toMatch(/RESEND_API_KEY/)
    expect(runRemindersMock).not.toHaveBeenCalled()
    expect(runPostDueMock).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(0) // 500 je PRIJE try bloka (prije pre/post-due poziva)
    // B4: claim se NE smije uzeti na putu koji ionako ne šalje — inače bi 500 zbog
    // nedostajućeg ključa pojeo dnevni krug i pre-due se do sutra ne bi ni pokušao.
    expect(rpcCalls).toHaveLength(0)
    expect(stanje.zadnje_slanje_datum).toBe("2026-07-07")
  })

  it("7. POST (ručno) sa markerom == danas → sat/prekidač se preskaču, ali dnevni claim NE (B4)", async () => {
    // Promjena ponašanja iz B4: „Pokreni sada" je ranije zaobilazilo marker POTPUNO,
    // pa je klik poslije jutarnjeg cron kruga slao ISTE podsjetnike drugi put
    // (runReminders šalje mejl prije upisa u `podsjetnici` — unique tamo hvata prekasno).
    const { supabase, rpcCalls } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-08" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await POST(req("POST"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(runRemindersMock).not.toHaveBeenCalled() // dan je već odrađen
    expect(body.preDue.preskocen).toBe("vec_slato_danas")
    // POST ne čita `postavke` (predfiltar je GET-only), pa claim MORA biti pokušan.
    expect(rpcCalls).toEqual([{ fn: "claim_pre_due", args: { p_datum: "2026-07-08" } }])
    // Post-due i digest nisu vezani za dnevni marker i idu dalje.
    expect(runPostDueMock).toHaveBeenCalledTimes(1)
  })

  it("7c. POST sa jučerašnjim markerom → claim uspije i pre-due se stvarno pokreće", async () => {
    const { supabase, stanje } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await POST(req("POST"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(runRemindersMock).toHaveBeenCalledTimes(1)
    expect(body.preDue.preskocen).toBeUndefined()
    expect(stanje.zadnje_slanje_datum).toBe("2026-07-08")
  })

  it("7b. POST sa vrijeme_slanja_sat u budućnosti → sat-gate se ne provjerava, runReminders SE poziva", async () => {
    // Isto obrazloženje kao test 7, ali za SAT granu (ne marker): 14 je iznad IZNAD_SATA
    // (lokalno 09:00) i GET bi to skip-ovao kao "izvan_sata". POST gating blok potpuno
    // preskače (if (req.method === "GET")), pa čak ni ne čita vrijeme_slanja_sat —
    // runReminders se svejedno poziva. (14 je najveća vrijednost koju novi
    // `chk_postavke_vrijeme_slanja_sat` check uopšte dopušta — vidi
    // lib/reminders/rasporedSlanja.ts; e2e regresija u
    // tests/e2e/23-podsjetnici-v2.spec.ts više ne upisuje nedostižan sat u bazu jer bi ga
    // taj check odbio — ovaj mockovani test je zato pravo mjesto za tu tvrdnju.)
    const { supabase } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 14, zadnje_slanje_datum: null },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await POST(req("POST"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(runRemindersMock).toHaveBeenCalledTimes(1)
    expect(body.preDue.preskocen).toBeUndefined()
  })

  it("8. RESEND_API_KEY odsutan + eksplicitan dryRun:true (POST) → gating prošao, NE vraća 500", async () => {
    // GET ne može nositi tijelo (fetch/undici baca na Request({method:'GET', body}), pa je POST
    // jedini realni nosilac eksplicitnog dryRun-a — u skladu sa komentarom u route.ts (Vercel Cron
    // šalje GET bez tijela). Za POST gating trivijalno "prolazi" (blok se ne izvršava), a provjera
    // ključa je iza cijelog gating bloka i mora izuzeti dryRun bez obzira na metod.
    envMock.RESEND_API_KEY = undefined
    const { supabase } = makeSupabase({})
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await POST(req("POST", { body: { dryRun: true } }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.error).toBeUndefined()
    expect(runRemindersMock).toHaveBeenCalledTimes(1)
    expect(runPostDueMock).toHaveBeenCalledTimes(1)
  })

  it("9. greška claim-a → pre-due se preskače (fail-closed), post-due i digest nastavljaju, greška se loguje", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { supabase } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
      claimError: "claim_pre_due ne postoji",
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(200) // pad claim-a ne ruši cijeli cron
    // Bez potvrđenog claim-a pre-due se NE pokreće: propušten krug je manja šteta od
    // duplog mejla klijentu (drugi run može biti u toku upravo sada).
    expect(runRemindersMock).not.toHaveBeenCalled()
    expect(body.preDue.preskocen).toBe("marker_greska")
    expect(runPostDueMock).toHaveBeenCalledTimes(1) // ima vlastitu idempotenciju
    expect(runDigestMock).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("claim_pre_due nije uspio"),
      "claim_pre_due ne postoji",
    )
  })

  it("10. runPostDue baci grešku → 500, ALI dan ostaje zauzet (pre-due je odrađen, ne ponavlja se)", async () => {
    const { supabase, stanje } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockRejectedValue(new Error("post-due je pukao"))

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain("post-due je pukao")
    // Claim se vraća SAMO kad padne sam pre-due (prije prvog mejla). Pad post-due puta
    // ne smije poništiti da je pre-due danas već uspješno poslao mejlove.
    expect(stanje.zadnje_slanje_datum).toBe("2026-07-08")
  })

  it("10b. runReminders baci PRIJE prvog mejla → 500 i dan se VRAĆA u opticaj (claim oslobođen)", async () => {
    const { supabase, updateCalls, stanje } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockRejectedValue(new Error("get_due_podsjetnici ne postoji"))

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain("get_due_podsjetnici ne postoji")
    // runReminders baca isključivo prije prvog poslanog mejla (per-red greške hvata
    // iznutra), pa bi zadržan claim značio dan bez ijednog podsjetnika.
    expect(updateCalls).toEqual([{ patch: { zadnje_slanje_datum: null } }])
    expect(stanje.zadnje_slanje_datum).toBeNull()
    expect(runPostDueMock).not.toHaveBeenCalled()
  })

  it("11. sat === vrijeme_slanja_sat (granica) → NE preskače, šalje se", async () => {
    // IZNAD_SATA je lokalno 09:00 (vidi komentar uz konstantu) — postavljamo prag tačno na 9,
    // ne 8 kao u ostalim testovima, da pogodimo granicu sat === vrijemeSat (>=, ne >).
    const { supabase } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 9, zadnje_slanje_datum: null },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.skipped).toBeUndefined() // NIJE "izvan_sata"
    expect(runRemindersMock).toHaveBeenCalledTimes(1)
  })

  it("12. postavke red nedostaje (null) → tretira se kao uključeno, ruta radi umjesto da padne", async () => {
    const { supabase } = makeSupabase({ postavke: null })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.error).toBeUndefined()
    expect(runRemindersMock).toHaveBeenCalledTimes(1)
    expect(runPostDueMock).toHaveBeenCalledTimes(1)
  })

  it("odgovor sadrži sva tri kruga: preDue, postDue i digest", async () => {
    const { supabase } = makeSupabase({ postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: null } })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    isCronAuthorizedMock.mockReturnValue(true)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z")) // 11:00 po Beogradu → sat >= 8

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveProperty("preDue")
    expect(body).toHaveProperty("postDue")
    expect(body).toHaveProperty("digest")
    expect(runDigestMock).toHaveBeenCalledTimes(1)
  })

  it("digest se poziva POSLIJE post-due puta", async () => {
    const redoslijed: string[] = []
    const { supabase } = makeSupabase({ postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: null } })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    isCronAuthorizedMock.mockReturnValue(true)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockImplementation(async () => { redoslijed.push("postDue"); return { sent: [], skipped: [], errors: [] } })
    runDigestMock.mockImplementation(async () => { redoslijed.push("digest"); return { sent: [], skipped: [], errors: [] } })
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z"))

    await GET(req("GET"))

    // Redoslijed nije kozmetika: get_istekli_termini izostavlja termin koji je danas
    // dobio pojedinačnu obavijest, pa post-due mora prvo upisati svoje tragove.
    expect(redoslijed).toEqual(["postDue", "digest"])
  })

  it("runDigest baci grešku → 200, preDue i postDue ostaju netaknuti, digest nosi grešku", async () => {
    // Digest je najmanje kritičan i posljednji od tri kruga: preDue i postDue su u ovom
    // trenutku već poslali prave mejlove i upisali svoje ledgere (npr. DEMO bez digest
    // migracija → get_istekli_termini ne postoji). Pad digesta ne smije obrisati te
    // rezultate iz odgovora niti pretvoriti uspješan cron u 500.
    const { supabase } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: null },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    const preDueRezultat = { sent: [{ email: "a@x.com" }], skipped: [], errors: [], deferred: 0 }
    const postDueRezultat = { sent: [{ email: "b@x.com" }], skipped: [], errors: [] }
    runRemindersMock.mockResolvedValue(preDueRezultat)
    runPostDueMock.mockResolvedValue(postDueRezultat)
    runDigestMock.mockRejectedValue(new Error("get_istekli_termini ne postoji"))
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z"))

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.preDue).toEqual(preDueRezultat)
    expect(body.postDue).toEqual(postDueRezultat)
    expect(body.digest).toEqual({ error: expect.stringContaining("get_istekli_termini ne postoji") })
  })

  it("GET sa današnjim markerom preskače pre-due, ali i dalje pokreće post-due i digest", async () => {
    const { supabase } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-20" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    isCronAuthorizedMock.mockReturnValue(true)
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z")) // beogradski datum = 2026-07-20

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(body.preDue.preskocen).toBe("vec_slato_danas")
    expect(runRemindersMock).not.toHaveBeenCalled()
    expect(runPostDueMock).toHaveBeenCalledTimes(1)
    expect(runDigestMock).toHaveBeenCalledTimes(1)
  })

  // ── O1: otkucaj („srce") ──────────────────────────────────────────────────
  // Bez ovoga mrtav cron i miran dan ostavljaju identičan trag u bazi (nikakav).
  it("otkucaj se upisuje i kad krug NIŠTA ne pošalje (ishod ok)", async () => {
    const { supabase, otkucaji } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: null },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    isCronAuthorizedMock.mockReturnValue(true)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })
    runDigestMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z"))

    await GET(req("GET"))

    expect(otkucaji).toHaveLength(1)
    expect(otkucaji[0]!.p_posao).toBe("podsjetnici")
    expect(otkucaji[0]!.p_ishod).toBe("ok")
    expect(otkucaji[0]!.p_detalji).toMatchObject({ poslato: 0, greske: 0 })
  })

  it("preskočen krug (prekidač isključen) se bilježi kao `preskoceno`, ne kao tišina", async () => {
    const { supabase, otkucaji } = makeSupabase({ postavke: { podsjetnici_aktivni: false } })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    isCronAuthorizedMock.mockReturnValue(true)
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z"))

    await GET(req("GET"))

    expect(otkucaji).toHaveLength(1)
    expect(otkucaji[0]!.p_ishod).toBe("preskoceno")
    expect(otkucaji[0]!.p_detalji).toMatchObject({ razlog: "podsjetnici_iskljuceni" })
  })

  it("pad kruga se bilježi kao `greska` sa porukom", async () => {
    const { supabase, otkucaji } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: null },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    isCronAuthorizedMock.mockReturnValue(true)
    runRemindersMock.mockRejectedValue(new Error("get_due_podsjetnici ne postoji"))
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z"))

    const res = await GET(req("GET"))

    expect(res.status).toBe(500)
    expect(otkucaji).toHaveLength(1)
    expect(otkucaji[0]!.p_ishod).toBe("greska")
    expect(otkucaji[0]!.p_greska).toContain("get_due_podsjetnici")
  })

  it("401 NE piše otkucaj — inače bi bilo ko sa URL-om mogao lažirati „sistem radi”", async () => {
    const { supabase, otkucaji } = makeSupabase({ postavke: { podsjetnici_aktivni: true } })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    isCronAuthorizedMock.mockReturnValue(false)

    const res = await GET(req("GET", { withAuth: false }))

    expect(res.status).toBe(401)
    expect(otkucaji).toHaveLength(0)
  })
})
