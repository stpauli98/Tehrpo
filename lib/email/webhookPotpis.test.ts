import { describe, it, expect } from "vitest"
import { createHmac } from "node:crypto"
import { Resend } from "resend"

const WHSEC = "whsec_" + Buffer.from("tajna-kljuc-1234567890").toString("base64")

function potpisi(whsec: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(whsec.replace(/^whsec_/, ""), "base64")
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`
}
function verify(body: string, headers: { id: string; timestamp: string; signature: string }) {
  return new Resend("re_placeholder").webhooks.verify({ payload: body, headers, webhookSecret: WHSEC })
}

describe("Resend webhooks.verify (ugrađeni verifikator)", () => {
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } })
  const id = "msg_1"
  const ts = () => Math.floor(Date.now() / 1000).toString()

  it("validan potpis prolazi i vraća parsiran event", () => {
    const t = ts()
    const ev = verify(body, { id, timestamp: t, signature: potpisi(WHSEC, id, t, body) }) as { type: string }
    expect(ev.type).toBe("email.delivered")
  })
  it("izmijenjeno tijelo → throw", () => {
    const t = ts()
    const sig = potpisi(WHSEC, id, t, body)
    expect(() => verify(body + "x", { id, timestamp: t, signature: sig })).toThrow()
  })
  it("pogrešna tajna → throw", () => {
    const t = ts()
    const bad = potpisi("whsec_" + Buffer.from("druga-tajna").toString("base64"), id, t, body)
    expect(() => verify(body, { id, timestamp: t, signature: bad })).toThrow()
  })
})
