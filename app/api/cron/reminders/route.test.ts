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

function makeSupabase(opts: { postavke?: Postavke; onUpdate?: () => void; updateError?: string }) {
  const updateCalls: Array<{ patch: Record<string, unknown> }> = []
  const supabase = {
    from(table: string) {
      if (table !== "postavke") throw new Error(`neočekivan from(${table}) u testu`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.postavke ?? null, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            updateCalls.push({ patch })
            opts.onUpdate?.()
            return opts.updateError ? { error: { message: opts.updateError } } : { error: null }
          },
        }),
      }
    },
  }
  return { supabase: supabase as unknown as SupabaseClient<Database>, updateCalls }
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

// Ljeti CEST (UTC+2): 2026-07-08T07:00:00Z → lokalno 09:00, datum 2026-07-08 (isto kao gating.test.ts).
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

  it("3. marker je današnji lokalni datum → runReminders NE, runPostDue DA, marker se ne prepisuje", async () => {
    const { supabase, updateCalls } = makeSupabase({
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
    expect(body.preDue).toEqual({ sent: [], skipped: [], errors: [], deferred: 0, preskocen: "vec_slato_danas" })
  })

  it("4. marker nije današnji → oba se pozivaju, marker se upisuje PRIJE runPostDue", async () => {
    const callOrder: string[] = []
    const { supabase, updateCalls } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
      onUpdate: () => callOrder.push("marker"),
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockImplementation(async () => {
      callOrder.push("postDue")
      return { sent: [], skipped: [], errors: [] }
    })

    const res = await GET(req("GET"))

    expect(res.status).toBe(200)
    expect(runRemindersMock).toHaveBeenCalledTimes(1)
    expect(runPostDueMock).toHaveBeenCalledTimes(1)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]!.patch).toEqual({ zadnje_slanje_datum: "2026-07-08" })
    // Dokaz REDOSLIJEDA, ne samo da su se oba desila: marker mora biti upisan prije post-due poziva.
    expect(callOrder).toEqual(["marker", "postDue"])
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
    const { supabase, updateCalls } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toMatch(/RESEND_API_KEY/)
    expect(runRemindersMock).not.toHaveBeenCalled()
    expect(runPostDueMock).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(0) // 500 je PRIJE try bloka (prije marker upisa i pre/post-due poziva)
  })

  it("7. POST (ručno) sa markerom == danas → gating blok se NE izvršava, runReminders SE poziva", async () => {
    // Isti postavke red kao scenario 3, gdje bi GET preskočio pre-due zbog markera —
    // ovdje dokazujemo da POST tu granu uopšte ne dodiruje (gating blok je `if (req.method === "GET")`).
    const { supabase, updateCalls } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-08" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await POST(req("POST"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(runRemindersMock).toHaveBeenCalledTimes(1)
    expect(runPostDueMock).toHaveBeenCalledTimes(1)
    // Diskriminator skip-grane: samo preskočen pre-due (GET+marker) ima `preskocen`.
    expect(body.preDue.preskocen).toBeUndefined()
    expect(updateCalls).toHaveLength(0) // POST nikad ne upisuje dnevni marker
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

  it("9. greška upisa markera (updateError) se loguje preko console.error, ali odgovor i dalje uspije", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { supabase, updateCalls } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
      updateError: "upis nije uspio",
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })

    const res = await GET(req("GET"))

    expect(res.status).toBe(200) // greška upisa markera ne smije srušiti response
    expect(updateCalls).toHaveLength(1) // upis je pokušan
    expect(runPostDueMock).toHaveBeenCalledTimes(1) // i dalje nastavlja na post-due
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("upis markera zadnje_slanje_datum nije uspio"),
      "upis nije uspio",
    )
  })

  it("10. runPostDue baci grešku → 500, ALI marker je svejedno upisan (svrha redoslijeda marker→post-due)", async () => {
    const { supabase, updateCalls } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-07" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    runRemindersMock.mockResolvedValue({ sent: [], skipped: [], errors: [], deferred: 0 })
    runPostDueMock.mockRejectedValue(new Error("post-due je pukao"))

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain("post-due je pukao")
    // Ovo je cijela svrha upisa markera PRIJE runPostDue poziva (vidi komentar u route.ts):
    // pad u post-due putanji ne smije poništiti da je pre-due danas već uspješno odrađen.
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]!.patch).toEqual({ zadnje_slanje_datum: "2026-07-08" })
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
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z")) // 11:00 Beč → sat >= 8

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

  it("GET sa današnjim markerom preskače pre-due, ali i dalje pokreće post-due i digest", async () => {
    const { supabase } = makeSupabase({
      postavke: { podsjetnici_aktivni: true, vrijeme_slanja_sat: 8, zadnje_slanje_datum: "2026-07-20" },
    })
    createAdminSupabaseClientMock.mockReturnValue(supabase)
    isCronAuthorizedMock.mockReturnValue(true)
    runPostDueMock.mockResolvedValue({ sent: [], skipped: [], errors: [] })
    vi.setSystemTime(new Date("2026-07-20T09:00:00Z")) // bečki datum = 2026-07-20

    const res = await GET(req("GET"))
    const body = await res.json()

    expect(body.preDue.preskocen).toBe("vec_slato_danas")
    expect(runRemindersMock).not.toHaveBeenCalled()
    expect(runPostDueMock).toHaveBeenCalledTimes(1)
    expect(runDigestMock).toHaveBeenCalledTimes(1)
  })
})
