import { describe, it, expect } from "vitest"
import { mapirajDostavu } from "./webhookDostava"

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
