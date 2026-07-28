import { describe, it, expect, vi, beforeEach } from "vitest"
import { posaljiIzabiljezi } from "./posaljiIzabiljezi"
import type { SendArgs, SendResult } from "./resend"

// Fake supabase koji hvata rpc pozive.
function fakeSupabase() {
  const calls: { fn: string; args: unknown }[] = []
  return {
    calls,
    rpc: vi.fn(async (fn: string, args: unknown) => { calls.push({ fn, args }); return { error: null } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}
const base: SendArgs & { tip: "podsjetnik_interni" } = {
  to: ["a@x.com"], bcc: ["b@x.com"], subject: "S", html: "<p>", tip: "podsjetnik_interni",
}

beforeEach(() => vi.restoreAllMocks())

describe("posaljiIzabiljezi", () => {
  it("uspjeh (non-dry): jedan rpc zabiljezi_mejl_log sa status=poslato; vraća res", async () => {
    const sb = fakeSupabase()
    const send = vi.fn(async (): Promise<SendResult> => ({ id: "abc", dryRun: false }))
    const res = await posaljiIzabiljezi(sb, { ...base, klijentId: "k1" }, send)
    expect(res).toEqual({ id: "abc", dryRun: false })
    expect(sb.calls).toHaveLength(1)
    const a = sb.calls[0].args as Record<string, unknown>
    expect(a.p_status).toBe("poslato")
    expect(a.p_resend_id).toBe("abc")
    expect(a.p_klijent_id).toBe("k1")
    expect(a.p_primaoci).toEqual(["a@x.com", "b@x.com"])
  })

  it("dry-run: nula rpc poziva; vraća res", async () => {
    const sb = fakeSupabase()
    const send = vi.fn(async (): Promise<SendResult> => ({ id: "dry-run", dryRun: true }))
    const res = await posaljiIzabiljezi(sb, base, send)
    expect(res.dryRun).toBe(true)
    expect(sb.calls).toHaveLength(0)
  })

  // Demo režim mora BITI zabilježen (tab prikazuje kako bi izgledalo), za razliku od
  // običnog dry-runa koji ostaje tih — inače bi svaki unit test punio dnevnik.
  it("demo: rpc sa status=demo, iste primaoce i naslov kao stvarno slanje", async () => {
    const sb = fakeSupabase()
    const send = vi.fn(async (): Promise<SendResult> => ({ id: "demo", dryRun: true, demo: true }))
    const res = await posaljiIzabiljezi(sb, { ...base, klijentId: "k1" }, send)
    expect(res.demo).toBe(true)
    expect(sb.calls).toHaveLength(1)
    const a = sb.calls[0].args as Record<string, unknown>
    expect(a.p_status).toBe("demo")
    expect(a.p_resend_id).toBe("demo")
    expect(a.p_greska).toBeNull()
    expect(a.p_klijent_id).toBe("k1")
    expect(a.p_primaoci).toEqual(["a@x.com", "b@x.com"])
    expect(a.p_subject).toBe("S")
  })

  it("neuspjeh: rpc sa greska_slanja; funkcija re-throw-uje", async () => {
    const sb = fakeSupabase()
    const send = vi.fn(async (): Promise<SendResult> => { throw new Error("resend pao") })
    await expect(posaljiIzabiljezi(sb, base, send)).rejects.toThrow("resend pao")
    expect(sb.calls).toHaveLength(1)
    const a = sb.calls[0].args as Record<string, unknown>
    expect(a.p_status).toBe("greska_slanja")
    expect(a.p_greska).toBe("resend pao")
    expect(a.p_resend_id).toBeNull()
  })

  it("best-effort: rpc greška ne ruši uspjeh (loguje se)", async () => {
    const sb = fakeSupabase()
    sb.rpc = vi.fn(async () => ({ error: { message: "db pao" } }))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const send = vi.fn(async (): Promise<SendResult> => ({ id: "abc", dryRun: false }))
    const res = await posaljiIzabiljezi(sb, base, send)
    expect(res.id).toBe("abc")
    expect(spy).toHaveBeenCalled()
  })
})
