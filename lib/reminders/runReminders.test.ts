import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { runReminders } from "./runReminders"
import type { SendArgs, SendResult } from "@/lib/email/resend"

type DueRow = {
  termin_id: string
  dana_prije: number
  dana_do_roka: number
  klijent_id: string
  klijent_naziv: string
  vrsta_naziv: string
  rok_dospijeca: string
  lokacija_naziv: string | null
}

function makeFake(opts: { danaPrije?: number[]; admins?: { email: string }[]; dueRows?: DueRow[]; adminError?: string }) {
  const inserts: Array<Record<string, unknown>> = []
  const fake = {
    from(table: string) {
      if (table === "postavke") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { dana_prije: opts.danaPrije ?? [60, 30, 15, 7] }, error: null }),
            }),
          }),
        }
      }
      if (table === "korisnici") {
        if (opts.adminError) {
          return { select: () => ({ eq: () => ({ eq: async () => ({ data: null, error: { message: opts.adminError } }) }) }) }
        }
        return { select: () => ({ eq: () => ({ eq: async () => ({ data: opts.admins ?? [], error: null }) }) }) }
      }
      if (table === "podsjetnici") {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserts.push(row)
            return { error: null }
          },
        }
      }
      throw new Error(`neočekivan from(${table})`)
    },
    rpc: async () => ({ data: opts.dueRows ?? [], error: null }),
  }
  return { supabase: fake as unknown as SupabaseClient<Database>, inserts }
}

const baseRow: DueRow = {
  termin_id: "t1",
  dana_prije: 60,
  dana_do_roka: 50,
  klijent_id: "k1",
  klijent_naziv: "AS",
  vrsta_naziv: "Hidranti",
  rok_dospijeca: "2026-08-18",
  lokacija_naziv: null,
}

describe("runReminders", () => {
  it("šalje adminima (dedupe, bez klijenta); tekst koristi dana_do_roka; audit po pragu", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => {
      sends.push(a)
      return { id: "r1", dryRun: false }
    }
    const { supabase, inserts } = makeFake({
      admins: [{ email: "admin1@tehpro.com" }, { email: "ADMIN1@tehpro.com" }, { email: "admin2@tehpro.com" }],
      dueRows: [baseRow],
    })
    const res = await runReminders(supabase, { send })
    expect(res.sent).toHaveLength(1)
    expect(sends).toHaveLength(1)
    expect(sends[0]!.to).toEqual(["admin1@tehpro.com", "admin2@tehpro.com"])
    expect(sends[0]!.subject).toContain("za 50 dana") // dana_do_roka, ne prag 60
    expect(inserts[0]).toMatchObject({ termin_id: "t1", dana_prije: 60 }) // idempotencija po pragu
  })

  it("post-due red: subject kaže kašnjenje, audit dana_prije negativan", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => {
      sends.push(a)
      return { id: "r2", dryRun: false }
    }
    const { supabase, inserts } = makeFake({
      admins: [{ email: "admin@tehpro.com" }],
      dueRows: [{ ...baseRow, termin_id: "t2", dana_prije: -3, dana_do_roka: -3, rok_dospijeca: "2026-06-26" }],
    })
    await runReminders(supabase, { send })
    expect(sends[0]!.subject).toContain("kasni 3 dana")
    expect(inserts[0]).toMatchObject({ termin_id: "t2", dana_prije: -3 })
  })

  it("dry-run (ili bez RESEND ključa): šalje ali NE upisuje audit (bez 'poison' idempotencije)", async () => {
    const send = async (): Promise<SendResult> => ({ id: "dry", dryRun: true })
    const { supabase, inserts } = makeFake({ admins: [{ email: "admin@tehpro.com" }], dueRows: [baseRow] })
    const res = await runReminders(supabase, { send })
    expect(res.sent).toHaveLength(1)
    expect(res.sent[0]!.dryRun).toBe(true)
    expect(inserts).toHaveLength(0) // ništa se ne piše u podsjetnici
  })

  it("greška pri čitanju admina → runReminders rejectuje (ne vraća skipped)", async () => {
    const { supabase } = makeFake({ adminError: "connection refused", dueRows: [baseRow] })
    await expect(runReminders(supabase)).rejects.toThrow(
      "Greška pri čitanju primalaca (korisnici): connection refused",
    )
  })

  it("nema internih primalaca → preskoči, ništa se ne šalje", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => {
      sends.push(a)
      return { id: "x", dryRun: true }
    }
    const { supabase, inserts } = makeFake({ admins: [], dueRows: [baseRow] })
    const res = await runReminders(supabase, { send })
    expect(sends).toHaveLength(0)
    expect(inserts).toHaveLength(0)
    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0]!.razlog).toBe("nema primalaca")
  })
})
