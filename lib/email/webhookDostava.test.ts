import { describe, it, expect } from "vitest"
import { mapirajDostavu, pogodjeneAdrese } from "./webhookDostava"

describe("pogodjeneAdrese", () => {
  it("niz adresa iz `data.to` prolazi normalizovan", () => {
    expect(pogodjeneAdrese([" Admin@Tehpro.LOCAL ", "b@x.com"])).toEqual(["admin@tehpro.local", "b@x.com"])
  })
  it("jedna adresa kao goli string se prihvata", () => {
    expect(pogodjeneAdrese("admin@tehpro.local")).toEqual(["admin@tehpro.local"])
  })
  it("bez podatka → prazan niz (dostavaObim to čita kao potpun neuspjeh)", () => {
    expect(pogodjeneAdrese(undefined)).toEqual([])
    expect(pogodjeneAdrese(null)).toEqual([])
    expect(pogodjeneAdrese([])).toEqual([])
  })
  it("smeće u nizu se odbacuje, ne ruši obradu", () => {
    expect(pogodjeneAdrese(["", "   ", 42 as unknown as string, "ok@x.com"])).toEqual(["ok@x.com"])
  })
  it("duplikati se sažimaju", () => {
    expect(pogodjeneAdrese(["a@x.com", "A@X.com"])).toEqual(["a@x.com"])
  })
})

describe("mapirajDostavu", () => {
  it("mapira poznate event-tipove", () => {
    expect(mapirajDostavu("email.delivered")).toBe("delivered")
    expect(mapirajDostavu("email.opened")).toBe("opened")
    expect(mapirajDostavu("email.failed")).toBe("delivery_failed")
    expect(mapirajDostavu("email.bounced")).toBe("bounced")
    expect(mapirajDostavu("email.complained")).toBe("complained")
  })
  it("vraća undefined za tranzijentne/ignorisane", () => {
    for (const t of ["email.sent", "email.scheduled", "email.clicked", "email.delivery_delayed", "domain.created", "contact.updated", "smeće"]) {
      expect(mapirajDostavu(t)).toBeUndefined()
    }
  })
})
