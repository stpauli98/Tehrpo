import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { runDigest } from "./runDigest"
import type { SendArgs, SendResult } from "@/lib/email/resend"

type IstekliRow = {
  termin_id: string; klijent_id: string; klijent_naziv: string; vrsta_naziv: string
  rok_dospijeca: string; datum_zakazan: string | null; ciklus_rok: string
  dana_do_ciklusa: number; lokacija_naziv: string | null
}

const ROW: IstekliRow = {
  termin_id: "t1", klijent_id: "k1", klijent_naziv: "CARMEUSE", vrsta_naziv: "Obilazak",
  rok_dospijeca: "2026-06-08", datum_zakazan: null, ciklus_rok: "2026-06-08",
  dana_do_ciklusa: -42, lokacija_naziv: null,
}

const ADMIN = { id: "u1", email: "admin@x.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }
const PONEDJELJAK = new Date("2026-07-20T08:00:00Z")

function makeFake(opts: {
  rows?: IstekliRow[]
  claimIds?: (string | null)[]
  postojeciZapisi?: { primalac_email: string; datum: string; stanje: string; claimed_at: string }[]
  korisnici?: typeof ADMIN[]
  claimError?: string
  updateError?: string
}) {
  const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = []
  const claims = [...(opts.claimIds ?? ["c1", "c2", "c3"])]
  const rpcPozivi: string[] = []
  const fake = {
    from(table: string) {
      if (table === "postavke") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { dana_prije: [30, 14, 7], salji_klijentima: false }, error: null }) }) }) }
      }
      if (table === "korisnici") return { select: async () => ({ data: opts.korisnici ?? [ADMIN], error: null }) }
      if (table === "korisnik_klijent") return { select: async () => ({ data: [], error: null }) }
      if (table === "klijenti") return { select: async () => ({ data: [], error: null }) }
      if (table === "kontakt_osobe") return { select: async () => ({ data: [], error: null }) }
      if (table === "digest_slanja") {
        return {
          select: () => ({ gte: async () => ({ data: opts.postojeciZapisi ?? [], error: null }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: unknown) => {
              updates.push({ id, patch })
              if (opts.updateError) return { error: { message: opts.updateError } }
              return { error: null }
            },
          }),
        }
      }
      throw new Error(`neočekivan from(${table})`)
    },
    async rpc(name: string) {
      rpcPozivi.push(name)
      if (name === "get_istekli_termini") return { data: opts.rows ?? [], error: null }
      if (name === "claim_digest") {
        if (opts.claimError) return { data: null, error: { message: opts.claimError } }
        return { data: claims.shift() ?? null, error: null }
      }
      return { data: null, error: null }
    },
  }
  return { supabase: fake as unknown as SupabaseClient<Database>, updates, rpcPozivi }
}

const okSend = async (_a: SendArgs): Promise<SendResult> => ({ id: "re_1", dryRun: false })

describe("runDigest", () => {
  it("ponedjeljkom šalje jedan mejl po primaocu i označava red", async () => {
    const { supabase, updates } = makeFake({ rows: [ROW] })
    const res = await runDigest(supabase, { send: okSend, now: PONEDJELJAK, delayMs: 0 })
    expect(res.sent).toHaveLength(1)
    expect(res.sent[0]!.email).toBe("admin@x.com")
    expect(res.sent[0]!.brojStavki).toBe(1)
    expect(updates).toHaveLength(1)
    expect(updates[0]!.patch.stanje).toBe("poslato")
    expect(updates[0]!.patch.termin_ids).toEqual(["t1"])
    // Reclaim zaglavljenog reda u claim_digest prepisuje samo claimed_at — resend_id i
    // poslat_at ostaju od ranijeg (neuspjelog) pokušaja ako ih ovaj update ne prepiše i on.
    expect(updates[0]!.patch.resend_id).toBe("re_1")
    expect(updates[0]!.patch.poslat_at).toEqual(expect.any(String))
  })

  it("utorkom bez starijeg digesta ne šalje ništa", async () => {
    let poslato = 0
    const { supabase } = makeFake({ rows: [ROW] })
    const res = await runDigest(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      now: new Date("2026-07-21T08:00:00Z"), delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.sent).toHaveLength(0)
  })

  it("prazan digest se ne šalje i ne upisuje", async () => {
    const { supabase, updates, rpcPozivi } = makeFake({ rows: [] })
    const res = await runDigest(supabase, { send: okSend, now: PONEDJELJAK, delayMs: 0 })
    expect(res.sent).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(rpcPozivi).not.toContain("claim_digest")
  })

  it("claim koji vrati null preskače primaoca bez slanja", async () => {
    let poslato = 0
    const { supabase, updates } = makeFake({ rows: [ROW], claimIds: [null] })
    const res = await runDigest(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      now: PONEDJELJAK, delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.skipped).toHaveLength(1)
    expect(updates).toHaveLength(0)
  })

  it("pad slanja ostavlja red u u_toku i prijavljuje grešku", async () => {
    const { supabase, updates } = makeFake({ rows: [ROW] })
    const res = await runDigest(supabase, {
      send: async () => { throw new Error("resend pao") },
      now: PONEDJELJAK, delayMs: 0,
    })
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.message).toContain("resend pao")
    expect(updates).toHaveLength(0)
  })

  it("mejl poslat ali upis ishoda padne: prijavljuje grešku sa resend_id, ne uspjeh", async () => {
    const { supabase, updates } = makeFake({ rows: [ROW], updateError: "upis pukao" })
    const res = await runDigest(supabase, { send: okSend, now: PONEDJELJAK, delayMs: 0 })
    expect(res.sent).toHaveLength(0)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.message).toContain("re_1")
    // Upis je pokušan (i pao) — claim ostaje 'u_toku' u bazi jer update nije prošao,
    // što je tačno scenario dupliranog digesta za 15 minuta.
    expect(updates).toHaveLength(1)
  })

  it("dry run ne uzima claim i ne dira ledger", async () => {
    const { supabase, updates, rpcPozivi } = makeFake({ rows: [ROW] })
    const res = await runDigest(supabase, {
      send: async () => ({ id: "dry-run", dryRun: true }),
      now: PONEDJELJAK, delayMs: 0, dryRun: true,
    })
    expect(rpcPozivi).not.toContain("claim_digest")
    expect(updates).toHaveLength(0)
    expect(res.sent[0]!.dryRun).toBe(true)
  })

  it("primalac koji je danas već dobio digest se preskače", async () => {
    let poslato = 0
    const { supabase } = makeFake({
      rows: [ROW],
      postojeciZapisi: [{ primalac_email: "admin@x.com", datum: "2026-07-20", stanje: "poslato", claimed_at: "2026-07-20T07:00:00Z" }],
    })
    const res = await runDigest(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      now: PONEDJELJAK, delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.skipped).toHaveLength(1)
  })

  it("greška iz claim_digest se prijavljuje i ništa se ne šalje", async () => {
    let poslato = 0
    const { supabase } = makeFake({ rows: [ROW], claimError: "claim pukao" })
    const res = await runDigest(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      now: PONEDJELJAK, delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.errors).toHaveLength(1)
  })
})
