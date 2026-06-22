import { describe, it, expect } from "vitest"
import { mockChatEvents } from "./mock"

describe("mockChatEvents", () => {
  it("uvijek završava 'done' i sadrži bar jedan 'text'", () => {
    const ev = mockChatEvents("koji termini kasne?")
    expect(ev.at(-1)).toEqual({ type: "done" })
    expect(ev.some((e) => e.type === "text")).toBe(true)
  })

  it("za upit o zapisniku emituje 'tool' i 'proposal'", () => {
    const ev = mockChatEvents("napravi zapisnik za prvi termin")
    expect(ev.some((e) => e.type === "tool")).toBe(true)
    const prop = ev.find((e) => e.type === "proposal")
    expect(prop && prop.type === "proposal" && prop.data.terminId).toBeTruthy()
  })

  it("za ostale upite emituje 'tool' (pretraga)", () => {
    const ev = mockChatEvents("prikaži firme")
    expect(ev.some((e) => e.type === "tool")).toBe(true)
  })
})
