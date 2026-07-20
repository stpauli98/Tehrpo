import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { runPostDue } from "./runPostDue"
import type { SendArgs, SendResult } from "@/lib/email/resend"

type PostDueRow = {
  termin_id: string; klijent_id: string; klijent_naziv: string; vrsta_naziv: string
  rok_dospijeca: string; datum_zakazan: string | null; ciklus_rok: string
  dana_do_ciklusa: number; lokacija_naziv: string | null
  treba_interni: boolean; treba_firma: boolean
}

const ROW: PostDueRow = {
  termin_id: "t1", klijent_id: "k1", klijent_naziv: "CARMEUSE", vrsta_naziv: "Obilazak",
  rok_dospijeca: "2026-07-13", datum_zakazan: null, ciklus_rok: "2026-07-13",
  dana_do_ciklusa: -6, lokacija_naziv: null, treba_interni: true, treba_firma: false,
}

function makeFake(opts: {
  rows?: PostDueRow[]
  claimIds?: (string | null)[]      // redom, po pozivu claim_post_due
  saljiKlijentima?: boolean
  korisnici?: { id: string; email: string; uloga: string; aktivan: boolean; prima_podsjetnike: boolean }[]
  kk?: { korisnik_id: string; klijent_id: string }[]
  klijenti?: { id: string; salji_podsjetnik_klijentu: boolean; podsjetnik_emails?: string[] }[]
  kontakti?: { klijent_id: string; email: string | null; podsjetnik_primalac: boolean }[]
  postavkeThrows?: boolean
}) {
  const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = []
  const claims = [...(opts.claimIds ?? ["c1", "c2", "c3", "c4"])]
  const fake = {
    from(table: string) {
      if (table === "postavke") {
        if (opts.postavkeThrows) {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => { throw new Error("postavke nedostupne") } }) }) }
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { dana_prije: [30, 14, 7], salji_klijentima: opts.saljiKlijentima ?? false }, error: null }) }) }) }
      }
      if (table === "korisnici") return { select: async () => ({ data: opts.korisnici ?? [], error: null }) }
      if (table === "korisnik_klijent") return { select: async () => ({ data: opts.kk ?? [], error: null }) }
      if (table === "klijenti") return { select: async () => ({ data: opts.klijenti ?? [], error: null }) }
      if (table === "kontakt_osobe") return { select: async () => ({ data: opts.kontakti ?? [], error: null }) }
      if (table === "post_due_obavijesti") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: unknown) => { updates.push({ id, patch }); return { error: null } },
          }),
        }
      }
      throw new Error(`neočekivan from(${table})`)
    },
    async rpc(name: string) {
      if (name === "get_post_due_termine") return { data: opts.rows ?? [], error: null }
      if (name === "claim_post_due") return { data: claims.shift() ?? null, error: null }
      return { data: null, error: null }
    },
  }
  return { supabase: fake as unknown as SupabaseClient<Database>, updates }
}

const ADMIN = { id: "u1", email: "admin@x.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }
const okSend = async (_a: SendArgs): Promise<SendResult> => ({ id: "re_1", dryRun: false })

describe("runPostDue", () => {
  it("šalje interni mejl i označava red kao poslato", async () => {
    const { supabase, updates } = makeFake({ rows: [ROW], korisnici: [ADMIN] })
    const res = await runPostDue(supabase, { send: okSend, delayMs: 0 })
    expect(res.sent).toHaveLength(1)
    expect(res.sent[0]!.kanal).toBe("interni")
    expect(updates).toHaveLength(1)
    expect(updates[0]!.patch.stanje).toBe("poslato")
    expect(updates[0]!.patch.resend_id).toBe("re_1")
  })

  it("claim koji vrati null preskače kanal bez slanja", async () => {
    let poslato = 0
    const { supabase, updates } = makeFake({ rows: [ROW], korisnici: [ADMIN], claimIds: [null] })
    const res = await runPostDue(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.sent).toHaveLength(0)
    expect(res.skipped).toHaveLength(1)
    expect(updates).toHaveLength(0)
  })

  it("kanal bez primalaca dobija preskoceno sa razlogom, bez slanja", async () => {
    let poslato = 0
    const { supabase, updates } = makeFake({ rows: [ROW], korisnici: [] })
    const res = await runPostDue(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.skipped).toHaveLength(1)
    expect(updates[0]!.patch.stanje).toBe("preskoceno")
    expect(updates[0]!.patch.razlog).toBe("nema_primalaca")
  })

  it("pad slanja ostavlja red u u_toku i prijavljuje grešku", async () => {
    const { supabase, updates } = makeFake({ rows: [ROW], korisnici: [ADMIN] })
    const res = await runPostDue(supabase, {
      send: async () => { throw new Error("resend pao") },
      delayMs: 0,
    })
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.message).toContain("resend pao")
    expect(updates).toHaveLength(0)
  })

  it("greška na jednom kanalu ne sprječava drugi", async () => {
    const row = { ...ROW, treba_firma: true }
    const { supabase } = makeFake({
      rows: [row], korisnici: [ADMIN], saljiKlijentima: true,
      klijenti: [{ id: "k1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["firma@x.com"] }],
    })
    let poziv = 0
    const res = await runPostDue(supabase, {
      send: async () => { poziv++; if (poziv === 1) throw new Error("prvi pao"); return { id: "re_2", dryRun: false } },
      delayMs: 0,
    })
    expect(res.errors).toHaveLength(1)
    expect(res.sent).toHaveLength(1)
  })

  it("baca kad se postavke ne mogu pročitati, umjesto da upiše preskoceno", async () => {
    const { supabase } = makeFake({ rows: [ROW], postavkeThrows: true })
    await expect(runPostDue(supabase, { send: okSend, delayMs: 0 })).rejects.toThrow()
  })

  it("firmin mejl ide bez ICS priloga i sa BCC adresama", async () => {
    const row = { ...ROW, treba_interni: false, treba_firma: true }
    const { supabase } = makeFake({
      rows: [row], korisnici: [ADMIN], saljiKlijentima: true,
      klijenti: [{ id: "k1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["firma@x.com"] }],
    })
    let args: SendArgs | null = null
    await runPostDue(supabase, {
      send: async (a) => { args = a; return { id: "re_3", dryRun: false } },
      delayMs: 0,
    })
    expect(args!.attachments).toBeUndefined()
    expect(args!.bcc).toEqual(["firma@x.com"])
  })
})
