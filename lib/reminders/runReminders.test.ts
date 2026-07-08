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

type KorRow = { id: string; email: string; uloga: string; aktivan: boolean; prima_podsjetnike: boolean }
type KlRow = { id: string; salji_podsjetnik_klijentu: boolean; podsjetnik_emails: string[] | null }

function makeFake(opts: {
  danaPrije?: number[]
  saljiKlijentima?: boolean
  korisnici?: KorRow[]
  kk?: { korisnik_id: string; klijent_id: string }[]
  klijenti?: KlRow[]
  dueRows?: DueRow[]
  korisniciError?: string
  kkError?: string
  klijentiError?: string
}) {
  const inserts: Array<Record<string, unknown>> = []
  const fake = {
    from(table: string) {
      if (table === "postavke") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { dana_prije: opts.danaPrije ?? [60, 30, 15, 7], salji_klijentima: opts.saljiKlijentima ?? false }, error: null }) }) }) }
      }
      if (table === "korisnici") {
        return { select: async () => (opts.korisniciError ? { data: null, error: { message: opts.korisniciError } } : { data: opts.korisnici ?? [], error: null }) }
      }
      if (table === "korisnik_klijent") {
        return { select: async () => (opts.kkError ? { data: null, error: { message: opts.kkError } } : { data: opts.kk ?? [], error: null }) }
      }
      if (table === "klijenti") {
        return { select: async () => (opts.klijentiError ? { data: null, error: { message: opts.klijentiError } } : { data: opts.klijenti ?? [], error: null }) }
      }
      if (table === "podsjetnici") {
        return { insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null } } }
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
      korisnici: [{ id: "a", email: "admin1@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }],
      dueRows: [baseRow],
    })
    const res = await runReminders(supabase, { send })
    expect(res.sent).toHaveLength(1)
    expect(sends).toHaveLength(1)
    expect(sends[0]!.to).toContain("admin1@tehpro.com")
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
      korisnici: [{ id: "a", email: "admin@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }],
      dueRows: [{ ...baseRow, termin_id: "t2", dana_prije: -3, dana_do_roka: -3, rok_dospijeca: "2026-06-26" }],
    })
    await runReminders(supabase, { send })
    expect(sends[0]!.subject).toContain("kasni 3 dana")
    expect(inserts[0]).toMatchObject({ termin_id: "t2", dana_prije: -3 })
  })

  it("dry-run (ili bez RESEND ključa): šalje ali NE upisuje audit (bez 'poison' idempotencije)", async () => {
    const send = async (): Promise<SendResult> => ({ id: "dry", dryRun: true })
    const { supabase, inserts } = makeFake({ korisnici: [{ id: "a", email: "admin@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }], dueRows: [baseRow] })
    const res = await runReminders(supabase, { send })
    expect(res.sent).toHaveLength(1)
    expect(res.sent[0]!.dryRun).toBe(true)
    expect(inserts).toHaveLength(0) // ništa se ne piše u podsjetnici
  })

  it("greška pri čitanju admina → runReminders rejectuje (ne vraća skipped)", async () => {
    const { supabase } = makeFake({ korisniciError: "connection refused", dueRows: [baseRow] })
    await expect(runReminders(supabase)).rejects.toThrow(
      "Greška pri čitanju primalaca (korisnici): connection refused",
    )
  })

  it("greška pri čitanju dodjela (korisnik_klijent) → runReminders rejectuje", async () => {
    const { supabase } = makeFake({ korisnici: [], kkError: "timeout", dueRows: [baseRow] })
    await expect(runReminders(supabase)).rejects.toThrow(
      "Greška pri čitanju dodjela (korisnik_klijent): timeout",
    )
  })

  it("greška pri čitanju klijenata (Krug 2) → runReminders rejectuje", async () => {
    const { supabase } = makeFake({ korisnici: [], kk: [], klijentiError: "timeout", dueRows: [baseRow] })
    await expect(runReminders(supabase)).rejects.toThrow(
      "Greška pri čitanju klijenata (Krug 2): timeout",
    )
  })

  it("Krug 2: salji_klijentima uključeno → firmine adrese idu u ODVOJEN firmin kanal (bcc), ne u interni to", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => { sends.push(a); return { id: "r", dryRun: false } }
    const { supabase } = makeFake({
      saljiKlijentima: true,
      korisnici: [{ id: "a", email: "admin@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }],
      klijenti: [{ id: "k1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["firma@klijent.com"] }],
      dueRows: [baseRow], // baseRow.klijent_id === "k1"
    })
    await runReminders(supabase, { send, delayMs: 0 })
    expect(sends).toHaveLength(2)
    const interni = sends.find((s) => s.to.includes("admin@tehpro.com"))
    expect(interni).toBeTruthy()
    expect(interni!.to).not.toContain("firma@klijent.com")
    const firmin = sends.find((s) => (s.bcc ?? []).includes("firma@klijent.com"))
    expect(firmin).toBeTruthy()
    // Firmin ICS prilog NE smije sadržati interni /plan-aktivnosti link (login-zid za firmu).
    const firminIcs = firmin!.attachments![0]!.content.toString("utf-8")
    expect(firminIcs).not.toContain("plan-aktivnosti")
    expect(firminIcs).not.toContain("/klijenti/")
  })

  it("šalje DVA kanala kad je firma primalac (interni + firma)", async () => {
    const sent: { to: string[]; bcc?: string[] }[] = []
    const send = async (a: SendArgs): Promise<SendResult> => { sent.push({ to: a.to, bcc: a.bcc }); return { id: "x", dryRun: true } }
    const { supabase } = makeFake({
      saljiKlijentima: true,
      korisnici: [{ id: "a", email: "radnik@tehpro.test", uloga: "operater", aktivan: true, prima_podsjetnike: true }],
      kk: [{ korisnik_id: "a", klijent_id: "k1" }],
      klijenti: [{ id: "k1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["firma@drina.ba"] }],
      dueRows: [baseRow], // baseRow.klijent_id === "k1"
    })
    await runReminders(supabase, { send })
    // interni: radnik u to, firma NIJE u to
    const interni = sent.find((s) => s.to.includes("radnik@tehpro.test"))
    expect(interni).toBeTruthy()
    expect(interni!.to).not.toContain("firma@drina.ba")
    // firmin: firma u bcc
    const firmin = sent.find((s) => (s.bcc ?? []).includes("firma@drina.ba"))
    expect(firmin).toBeTruthy()
  })

  it("firma isključena (per-firma) → samo interni kanal, bez bcc", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => { sends.push(a); return { id: "r", dryRun: false } }
    const { supabase } = makeFake({
      saljiKlijentima: true,
      korisnici: [{ id: "a", email: "admin@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }],
      klijenti: [{ id: "k1", salji_podsjetnik_klijentu: false, podsjetnik_emails: null }],
      dueRows: [baseRow],
    })
    await runReminders(supabase, { send, delayMs: 0 })
    expect(sends).toHaveLength(1)
    expect(sends[0]!.to).toEqual(["admin@tehpro.com"])
    expect(sends[0]!.bcc).toBeUndefined()
  })

  it("Krug 2: globalni prekidač isključen → firmine adrese se NE dodaju čak i ako je klijent uključen", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => { sends.push(a); return { id: "r", dryRun: false } }
    const { supabase } = makeFake({
      saljiKlijentima: false,
      korisnici: [{ id: "a", email: "admin@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }],
      klijenti: [{ id: "k1", salji_podsjetnik_klijentu: true, podsjetnik_emails: ["firma@klijent.com"] }],
      dueRows: [baseRow],
    })
    await runReminders(supabase, { send, delayMs: 0 })
    expect(sends[0]!.to).toEqual(["admin@tehpro.com"])
  })

  it("nema internih primalaca → preskoči, ništa se ne šalje", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => {
      sends.push(a)
      return { id: "x", dryRun: true }
    }
    const { supabase, inserts } = makeFake({ korisnici: [], dueRows: [baseRow] })
    const res = await runReminders(supabase, { send })
    expect(sends).toHaveLength(0)
    expect(inserts).toHaveLength(0)
    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0]!.razlog).toBe("nema primalaca")
  })

  it("throttling cap: šalje najviše maxPerRun, ostatak je deferred", async () => {
    let n = 0
    const send = async (): Promise<SendResult> => {
      n++
      return { id: "s", dryRun: false }
    }
    const rows: DueRow[] = Array.from({ length: 5 }, (_, i) => ({ ...baseRow, termin_id: `t${i}` }))
    const { supabase } = makeFake({ korisnici: [{ id: "a", email: "a@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }], dueRows: rows })
    const res = await runReminders(supabase, { send, maxPerRun: 2, batchSize: 5, delayMs: 0 })
    expect(n).toBe(2)
    expect(res.sent).toHaveLength(2)
    expect(res.deferred).toBe(3)
  })

  it("throttling: u grupama pošalje SVE kad je ispod cap-a", async () => {
    let n = 0
    const send = async (): Promise<SendResult> => {
      n++
      return { id: "s", dryRun: false }
    }
    const rows: DueRow[] = Array.from({ length: 4 }, (_, i) => ({ ...baseRow, termin_id: `t${i}` }))
    const { supabase } = makeFake({ korisnici: [{ id: "a", email: "a@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }], dueRows: rows })
    const res = await runReminders(supabase, { send, maxPerRun: 90, batchSize: 2, delayMs: 0 })
    expect(n).toBe(4)
    expect(res.sent).toHaveLength(4)
    expect(res.deferred).toBe(0)
  })

  it("routing: operater dobija samo svoju firmu (preko korisnik_klijent)", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => { sends.push(a); return { id: "r", dryRun: false } }
    const { supabase } = makeFake({
      korisnici: [
        { id: "a", email: "admin@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true },
        { id: "o", email: "op@tehpro.com", uloga: "operater", aktivan: true, prima_podsjetnike: true },
      ],
      kk: [{ korisnik_id: "o", klijent_id: "k1" }],
      dueRows: [baseRow], // baseRow.klijent_id === "k1"
    })
    await runReminders(supabase, { send, delayMs: 0 })
    expect(sends[0]!.to).toEqual(["op@tehpro.com", "admin@tehpro.com"])
  })

  it("šalje .ics prilog (termin.ics) uz podsjetnik", async () => {
    const sends: SendArgs[] = []
    const send = async (a: SendArgs): Promise<SendResult> => { sends.push(a); return { id: "r", dryRun: false } }
    const { supabase } = makeFake({
      korisnici: [{ id: "a", email: "admin@tehpro.com", uloga: "admin", aktivan: true, prima_podsjetnike: true }],
      dueRows: [baseRow],
    })
    await runReminders(supabase, { send })
    const att = sends[0]!.attachments
    expect(att).toHaveLength(1)
    expect(att![0]!.filename).toBe("termin.ics")
    expect(att![0]!.content.toString("utf-8")).toContain("BEGIN:VCALENDAR")
    expect(att![0]!.content.toString("utf-8")).toContain("SUMMARY:Hidranti — AS")
  })
})
