import { describe, it, expect } from "vitest"
import { localizeHref } from "./routes"

describe("localizeHref", () => {
  it("sr je identitet", () => {
    expect(localizeHref("/klijenti/123", "sr")).toBe("/klijenti/123")
  })
  it("prevodi segment za en", () => {
    expect(localizeHref("/klijenti/123", "en")).toBe("/clients/123")
    expect(localizeHref("/plan-aktivnosti", "en")).toBe("/activity-plan")
  })
  it("prevodi za de i čuva query", () => {
    expect(localizeHref("/pregled?x=1", "de")).toBe("/uebersicht?x=1")
  })
  it("nepoznat segment prolazi netaknut", () => {
    expect(localizeHref("/api/chat", "en")).toBe("/api/chat")
  })
})
