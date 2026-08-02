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
  // Bez eksplicitne liste claim-ovi se izdaju neograničeno (c1, c2, …) — testovi sa
  // velikim backlog-om trebaju stotine, a fiksna lista bi im tiho vratila null i
  // pretvorila "poslato" u "claim drži neko drugi".
  const claims = opts.claimIds ? [...opts.claimIds] : null
  let brojacClaimova = 0
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
        brojacClaimova += 1
        return { data: claims ? (claims.shift() ?? null) : `c${brojacClaimova}`, error: null }
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
    // rok_dospijeca=2026-07-13, datum_zakazan=2026-07-15 — mejl mora prikazati OBA (format dd.MM.yyyy)
    expect(args!.html).toContain("13.07.2026")
    expect(args!.html).toContain("15.07.2026")
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

// Backlog: N termina, svaki sa oba kanala → 2N zadataka. Isti oblik kao stvarni
// get_post_due_termine (RPC sortira najhitnije prvo, pa je odsijecanje repa odgoda
// najmanje hitnih).
function backlog(n: number): PostDueRow[] {
  return Array.from({ length: n }, (_, i) => ({
    ...ROW,
    termin_id: `t${i + 1}`,
    klijent_id: "k1",
    dana_do_ciklusa: -(n - i),
    dana_do_roka: -(n - i),
    treba_interni: true,
    treba_firma: false,
  }))
}

describe("runPostDue — ograde protiv prekida na velikom backlog-u", () => {
  it("bez cap-a bi obradio sve; sa cap-om obradi tačno maxPerRun i ostatak prijavi kao deferred", async () => {
    const { supabase } = makeFake({ rows: backlog(200), korisnici: [ADMIN] })
    let poslato = 0
    const res = await runPostDue(supabase, {
      send: async () => { poslato += 1; return { id: `re_${poslato}`, dryRun: false } },
      maxPerRun: 30,
      delayMs: 0,
    })
    expect(poslato).toBe(30)
    expect(res.sent).toHaveLength(30)
    expect(res.deferred).toBe(170)
    expect(res.prekinutoZbogVremena).toBe(false)
  })

  it("odgođeni kanali NEMAJU claim — zato ih sljedeći prolaz preuzme, ništa se ne gubi", async () => {
    // Ovo je razlika između "cap" i "gubitak": claim_post_due se smije pozvati samo
    // za ono što se stvarno obrađuje. Da se claim uzimao unaprijed, odgođeni redovi bi
    // 15 minuta stajali u 'u_toku' i niko im ne bi poslao mejl.
    const { supabase, rpcPozivi } = makeFake({ rows: backlog(100), korisnici: [ADMIN] })
    const res = await runPostDue(supabase, { send: okSend, maxPerRun: 12, delayMs: 0 })
    const brojClaimova = rpcPozivi.filter((n) => n === "claim_post_due").length
    expect(brojClaimova).toBe(12)
    expect(res.deferred).toBe(88)

    // Sljedeći prolaz: RPC i dalje vraća 88 neobrađenih (nema claim-a koji bi ih sakrio).
    const drugi = makeFake({ rows: backlog(100).slice(12), korisnici: [ADMIN] })
    const res2 = await runPostDue(drugi.supabase, { send: okSend, maxPerRun: 12, delayMs: 0 })
    expect(res2.sent).toHaveLength(12)
    expect(res2.deferred).toBe(76)
  })

  it("vremenski budžet: staje prije roka i ne započinje grupu koju ne može završiti", async () => {
    // Simulirani sat: svako slanje traje 500 ms, rok je 3 s od početka. Grupe su po 2,
    // pa stanu tačno dvije grupe (t=1000→2000, t=2000→3000); treća bi počela na t=3000
    // što je već rok → prekid.
    let sat = 1000
    const { supabase, rpcPozivi } = makeFake({ rows: backlog(50), korisnici: [ADMIN] })
    const res = await runPostDue(supabase, {
      send: async () => { sat += 500; return { id: "re_x", dryRun: false } },
      batchSize: 2,
      delayMs: 0,
      deadlineAt: 3000,
      sada: () => sat,
    })
    expect(res.sent).toHaveLength(4)
    expect(res.deferred).toBe(46)
    expect(res.prekinutoZbogVremena).toBe(true)
    // Ključno za idempotenciju: nijedan claim nije uzet za ono što nije poslato.
    expect(rpcPozivi.filter((n) => n === "claim_post_due")).toHaveLength(4)
  })

  it("rok koji je istekao prije početka: ništa se ne šalje, sve je deferred (a ne izgubljeno)", async () => {
    // Realan slučaj: pre-due je pojeo cijeli budžet zahtjeva. Bolje nijedan mejl nego
    // mejl koji Vercel ubije između slanja i upisa ishoda (→ duplikat za 15 minuta).
    let poslato = 0
    const { supabase, rpcPozivi } = makeFake({ rows: backlog(24), korisnici: [ADMIN] })
    const res = await runPostDue(supabase, {
      send: async () => { poslato += 1; return { id: "x", dryRun: false } },
      delayMs: 0,
      deadlineAt: 1000,
      sada: () => 5000,
    })
    expect(poslato).toBe(0)
    expect(res.sent).toHaveLength(0)
    expect(res.deferred).toBe(24)
    expect(res.prekinutoZbogVremena).toBe(true)
    expect(rpcPozivi).not.toContain("claim_post_due")
  })

  it("produkcijski parametri: run staje unutar maxDuration umjesto da ga Vercel ubije", async () => {
    // Stvarna propusnost throttlovane petlje (mjereno nad cloud DEMO bazom):
    // batchSize=2, delayMs=1100 → ~1,36 s po grupi od 2 zadatka. Rok koji ruta daje
    // post-due krugu je pocetak+90 s (120 s maxDuration − 15 s rezerve za odgovor
    // − 15 s rezerve za digest).
    //
    // Simulirani sat je izveden iz broja završenih grupa, pa je stvarno trajanje testa
    // milisekunde, a mjerena veličina je ista kao u produkciji.
    const MS_PO_GRUPI = 1360
    const ROK_POST_DUE_MS = 90_000
    const KILL_MS = 120_000
    const UKUPNO = 400 // 200 isteklih termina × 2 kanala

    let sends = 0
    const sada = () => Math.ceil(sends / 2) * MS_PO_GRUPI

    const { supabase } = makeFake({ rows: backlog(UKUPNO), korisnici: [ADMIN] })
    const res = await runPostDue(supabase, {
      send: async () => { sends += 1; return { id: `re_${sends}`, dryRun: false } },
      maxPerRun: UKUPNO, // cap namjerno ne veže — dokazujemo da GRANICU postavlja vrijeme
      batchSize: 2,
      delayMs: 0,
      deadlineAt: ROK_POST_DUE_MS,
      sada,
    })

    // Bez ograde bi svih 400 zadataka trajalo ~272 s — Vercel bi ubio funkciju usred
    // slanja, a claim-first bi ostavio red 'u_toku' → duplikat za 15 minuta.
    expect((UKUPNO / 2) * MS_PO_GRUPI).toBeGreaterThan(KILL_MS)

    expect(res.prekinutoZbogVremena).toBe(true)
    expect(sada()).toBeLessThan(KILL_MS) // stali smo SAMI, prije kill-a
    expect(res.sent.length).toBeGreaterThan(100) // budžet je iskorišten, nije protraćen
    // Ništa se ne gubi: svaki zadatak je ili poslat ili odgođen za sljedeći prolaz.
    expect(res.sent.length + res.skipped.length + res.errors.length + res.deferred).toBe(UKUPNO)
  })

  it("bez deadlineAt ponašanje je nepromijenjeno (ručno pokretanje iz skripte)", async () => {
    const { supabase } = makeFake({ rows: backlog(5), korisnici: [ADMIN] })
    const res = await runPostDue(supabase, { send: okSend, delayMs: 0 })
    expect(res.sent).toHaveLength(5)
    expect(res.deferred).toBe(0)
    expect(res.prekinutoZbogVremena).toBe(false)
  })
})
