import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { runPostDue } from "./runPostDue"
import type { SendArgs, SendResult } from "@/lib/email/resend"

type PostDueRow = {
  termin_id: string; klijent_id: string; klijent_naziv: string; vrsta_naziv: string
  rok_dospijeca: string; datum_zakazan: string | null; ciklus_rok: string
  dana_do_ciklusa: number; dana_do_roka: number; lokacija_naziv: string | null
  treba_interni: boolean; treba_firma: boolean
}

const ROW: PostDueRow = {
  termin_id: "t1", klijent_id: "k1", klijent_naziv: "CARMEUSE", vrsta_naziv: "Obilazak",
  rok_dospijeca: "2026-07-13", datum_zakazan: null, ciklus_rok: "2026-07-13",
  dana_do_ciklusa: -6, dana_do_roka: -6, lokacija_naziv: null,
  treba_interni: true, treba_firma: false,
}

function makeFake(opts: {
  rows?: PostDueRow[]
  claimIds?: (string | null)[]      // redom, po pozivu claim_post_due
  claimError?: string
  saljiKlijentima?: boolean
  korisnici?: { id: string; email: string; uloga: string; aktivan: boolean; prima_podsjetnike: boolean }[]
  kk?: { korisnik_id: string; klijent_id: string }[]
  klijenti?: { id: string; salji_podsjetnik_klijentu: boolean; podsjetnik_emails?: string[] }[]
  kontakti?: { klijent_id: string; email: string | null; podsjetnik_primalac: boolean }[]
  postavkeThrows?: boolean
  postavkeError?: string
  updateError?: string
}) {
  const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = []
  const mejlLogTipovi: string[] = []
  const rpcPozivi: string[] = []
  const claims = [...(opts.claimIds ?? ["c1", "c2", "c3", "c4"])]
  const fake = {
    from(table: string) {
      if (table === "postavke") {
        if (opts.postavkeThrows) {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => { throw new Error("postavke nedostupne") } }) }) }
        }
        if (opts.postavkeError) {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: opts.postavkeError } }) }) }) }
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
            eq: async (_col: string, id: unknown) => {
              updates.push({ id, patch })
              return opts.updateError ? { error: { message: opts.updateError } } : { error: null }
            },
          }),
        }
      }
      throw new Error(`neočekivan from(${table})`)
    },
    async rpc(name: string, params?: Record<string, unknown>) {
      rpcPozivi.push(name)
      if (name === "get_post_due_termine") return { data: opts.rows ?? [], error: null }
      if (name === "claim_post_due") {
        if (opts.claimError) return { data: null, error: { message: opts.claimError } }
        return { data: claims.shift() ?? null, error: null }
      }
      if (name === "zabiljezi_mejl_log") {
        mejlLogTipovi.push(String(params?.p_tip))
        return { data: null, error: null }
      }
      return { data: null, error: null }
    },
  }
  return { supabase: fake as unknown as SupabaseClient<Database>, updates, mejlLogTipovi, rpcPozivi }
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
    expect(updates).toHaveLength(1)
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

  it("baca kad postavke vrate grešku (bez throw-a) — stvarno ponašanje Supabase klijenta", async () => {
    // Supabase-js NE baca na grešku čitanja, vraća { data: null, error }. Fake iz prethodnog
    // testa (throw unutar maybeSingle) ne odslikava to — ovaj test cilja pravu putanju iz
    // recepta: post?.salji_klijentima ?? false bi progutao grešku i trajno ugasio firmin kanal.
    const { supabase } = makeFake({ rows: [ROW], postavkeError: "transientni kvar konekcije" })
    await expect(runPostDue(supabase, { send: okSend, delayMs: 0 })).rejects.toThrow(/postavki/)
  })

  it("firmin mejl ide bez ICS priloga i sa BCC adresama", async () => {
    const row = { ...ROW, treba_interni: false, treba_firma: true }
    const { supabase, mejlLogTipovi } = makeFake({
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
    expect(mejlLogTipovi).toEqual(["podsjetnik_rok_istekao_firma"])
  })

  it("interni kanal ima ICS prilog i tačan mejl_tip", async () => {
    const { supabase, mejlLogTipovi } = makeFake({ rows: [ROW], korisnici: [ADMIN] })
    let args: SendArgs | null = null
    await runPostDue(supabase, {
      send: async (a) => { args = a; return { id: "re_ics", dryRun: false } },
      delayMs: 0,
    })
    expect(args!.attachments).toHaveLength(1)
    expect(args!.attachments![0]!.content.toString("utf-8")).toContain("BEGIN:VCALENDAR")
    expect(mejlLogTipovi).toEqual(["podsjetnik_rok_istekao_interni"])
  })

  it("dry-run: ne uzima claim, ledger ostaje netaknut, rezultat nosi dryRun: true", async () => {
    const { supabase, updates, rpcPozivi } = makeFake({ rows: [ROW], korisnici: [ADMIN] })
    const res = await runPostDue(supabase, {
      send: async () => ({ id: "re_dry", dryRun: true }),
      dryRun: true,
      delayMs: 0,
    })
    expect(res.sent).toHaveLength(1)
    expect(res.sent[0]!.dryRun).toBe(true)
    // Dokaz regresije iz recenzije: dry run NE smije uzeti claim_post_due — inače
    // red ostaje 'u_toku' 15 minuta i blokira stvarnu obavijest za taj ciklus.
    expect(rpcPozivi).not.toContain("claim_post_due")
    expect(updates).toHaveLength(0)
  })

  it("datum_zakazan različit od roka: oba datuma se pojavljuju u poslatom HTML-u", async () => {
    const row = { ...ROW, datum_zakazan: "2026-07-15", ciklus_rok: "2026-07-15" }
    const { supabase } = makeFake({ rows: [row], korisnici: [ADMIN] })
    let args: SendArgs | null = null
    await runPostDue(supabase, {
      send: async (a) => { args = a; return { id: "re_4", dryRun: false } },
      delayMs: 0,
    })
    // rok_dospijeca=2026-07-13, datum_zakazan=2026-07-15 — mejl mora prikazati OBA (sr format DD.MM.YYYY.)
    expect(args!.html).toContain("13.07.2026.")
    expect(args!.html).toContain("15.07.2026.")
  })

  it("claim_post_due koji vrati grešku: ništa se ne šalje, greška se prijavljuje", async () => {
    let poslato = 0
    const { supabase, updates } = makeFake({ rows: [ROW], korisnici: [ADMIN], claimError: "rpc nedostupan" })
    const res = await runPostDue(supabase, {
      send: async () => { poslato++; return { id: "x", dryRun: false } },
      delayMs: 0,
    })
    expect(poslato).toBe(0)
    expect(res.sent).toHaveLength(0)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.message).toContain("rpc nedostupan")
    expect(updates).toHaveLength(0)
  })

  it("pad označavanja NAKON uspješnog slanja se prijavljuje kao greška, ne kao 'sent'", async () => {
    // Mejl je stvarno poslat (send je pozvan i vratio uspjeh), ali upis ishoda u ledger
    // padne. Red ostaje 'u_toku' i RPC bi ga ponovo otvorio za 15 min → rizik duplikata.
    // To mora biti vidljivo pozivaocu kroz errors, ne samo kroz console.error.
    let poslato = 0
    const { supabase, updates } = makeFake({ rows: [ROW], korisnici: [ADMIN], updateError: "upis nije uspio" })
    const res = await runPostDue(supabase, {
      send: async () => { poslato++; return { id: "re_5", dryRun: false } },
      delayMs: 0,
    })
    expect(poslato).toBe(1)
    expect(res.sent).toHaveLength(0)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.message).toContain("upis nije uspio")
    expect(updates).toHaveLength(1)
  })

  it("prezakazan termin: kašnjenje se mjeri prema roku, ne prema zakazanom datumu", async () => {
    // WAIKIKI / Ispitivanje hidranata (PROD, 30.07.2026): rok 27.06., zakazano 29.07.
    // Ciklus (= datum_zakazan) služi SAMO za odluku kada ponovo slati; broj u predmetu
    // i bedžu mora biti kašnjenje prema roku — inače mejl protivrječi sam sebi
    // ("kasni 1 dan" u naslovu, "Rok dospijeća: 27.06." u tijelu) i ekranu /pregled.
    const captured: SendArgs[] = []
    const prezakazan: PostDueRow = {
      ...ROW,
      rok_dospijeca: "2026-06-27", datum_zakazan: "2026-07-29",
      ciklus_rok: "2026-07-29", dana_do_ciklusa: -1, dana_do_roka: -33,
    }
    const { supabase } = makeFake({ rows: [prezakazan], korisnici: [ADMIN] })
    const res = await runPostDue(supabase, {
      send: async (a) => { captured.push(a); return { id: "re_1", dryRun: false } },
      delayMs: 0,
    })
    expect(res.sent).toHaveLength(1)
    expect(captured[0]!.subject).toContain("kasni 33 dana")
    expect(captured[0]!.subject).not.toContain("kasni 1 dan")
    // Oba datuma ostaju u tijelu: rok je rok, zakazano je zakazano.
    expect(captured[0]!.html).toContain("27.06.2026")
    expect(captured[0]!.html).toContain("29.07.2026")
  })
})
