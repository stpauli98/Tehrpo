import { describe, it, expect, vi, afterEach } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { zabiljeziOtkucaj, ishodIzOdgovora } from "./otkucaj"

type Poziv = { fn: string; args: Record<string, unknown> }

function klijent(opts: { error?: string; baci?: boolean } = {}) {
  const pozivi: Poziv[] = []
  const supabase = {
    async rpc(fn: string, args: Record<string, unknown>) {
      pozivi.push({ fn, args })
      if (opts.baci) throw new Error("mreža pukla")
      return { error: opts.error ? { message: opts.error } : null }
    },
  }
  return { supabase: supabase as unknown as SupabaseClient<Database>, pozivi }
}

afterEach(() => vi.restoreAllMocks())

describe("ishodIzOdgovora", () => {
  it("200 sa običnim tijelom = ok", () => {
    expect(ishodIzOdgovora(200, { ok: true })).toBe("ok")
    expect(ishodIzOdgovora(200, null)).toBe("ok")
  })
  it("`skipped` = preskoceno (prekidač, izvan sata, već slato danas)", () => {
    expect(ishodIzOdgovora(200, { ok: true, skipped: "podsjetnici_iskljuceni" })).toBe("preskoceno")
    expect(ishodIzOdgovora(200, { ok: true, skipped: "izvan_sata" })).toBe("preskoceno")
  })
  it("500 = greska (B3 ga vraća kad udio grešaka slanja pređe prag)", () => {
    expect(ishodIzOdgovora(500, { error: "RESEND_API_KEY nije postavljen" })).toBe("greska")
  })
  it("`ok:false` ili `error` u tijelu = greska i na statusu 200", () => {
    expect(ishodIzOdgovora(200, { ok: false })).toBe("greska")
    expect(ishodIzOdgovora(200, { error: "prekid: prevelik udio" })).toBe("greska")
  })
  it("greška ima prednost nad skip-om", () => {
    expect(ishodIzOdgovora(500, { skipped: "izvan_sata" })).toBe("greska")
  })
})

describe("zabiljeziOtkucaj", () => {
  it("šalje posao, ishod i detalje u RPC", async () => {
    const { supabase, pozivi } = klijent()
    await zabiljeziOtkucaj(supabase, "podsjetnici", "ok", { poslato: 3, greske: 0 })
    expect(pozivi).toEqual([
      {
        fn: "zabiljezi_cron_otkucaj",
        args: { p_posao: "podsjetnici", p_ishod: "ok", p_detalji: { poslato: 3, greske: 0 }, p_greska: null },
      },
    ])
  })

  it("prazna poruka greške se normalizuje na null", async () => {
    const { supabase, pozivi } = klijent()
    await zabiljeziOtkucaj(supabase, "ciscenje-audita", "greska", {}, "")
    expect(pozivi[0]!.args.p_greska).toBeNull()
  })

  it("nadzor NE obara posao koji nadzire: greška RPC-a se samo loguje", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { supabase } = klijent({ error: "permission denied" })
    await expect(zabiljeziOtkucaj(supabase, "podsjetnici", "ok")).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledOnce()
  })

  it("ni bačena greška (nema funkcije u bazi, mreža) ne izlazi iz upisa", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { supabase } = klijent({ baci: true })
    await expect(zabiljeziOtkucaj(supabase, "ciscenje-storagea", "greska", {}, "x")).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledOnce()
  })
})
