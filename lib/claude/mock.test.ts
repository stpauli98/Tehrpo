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

  it("sr (default) tekst sadrži 'pregled' (e2e assertion se ne mijenja)", () => {
    const ev = mockChatEvents("koji termini kasne?")
    const txt = ev.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.text : "")).join("")
    expect(txt).toContain("pregled")
  })

  it("en: tekst i tool labela su na engleskom, ne na bosanskom", () => {
    const ev = mockChatEvents("koji termini kasne?", "en")
    const tool = ev.find((e) => e.type === "tool")
    expect(tool && tool.type === "tool" ? tool.label : "").toBe("Searching appointments…")
    const txt = ev.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.text : "")).join("")
    expect(txt).toContain("overview")
    expect(txt).not.toContain("pregled")
  })

  it("de: tekst i tool labela su na njemačkom", () => {
    const ev = mockChatEvents("koji termini kasne?", "de")
    const tool = ev.find((e) => e.type === "tool")
    expect(tool && tool.type === "tool" ? tool.label : "").toBe("Termine werden durchsucht…")
    const txt = ev.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.text : "")).join("")
    expect(txt).toContain("Überblick")
  })

  it("en: zapisnik proposal nalaz/zakljucak su na engleskom; klijent/vrsta ostaju netaknuti", () => {
    const ev = mockChatEvents("napravi zapisnik za prvi termin", "en")
    const prop = ev.find((e) => e.type === "proposal")
    expect(prop && prop.type === "proposal" ? prop.data.nalaz : "").toBe("Mock findings for testing purposes.")
    expect(prop && prop.type === "proposal" ? prop.data.zakljucak : "").toBe("Mock conclusion.")
    expect(prop && prop.type === "proposal" ? prop.data.klijent : "").toBe("Demo klijent")
    expect(prop && prop.type === "proposal" ? prop.data.vrsta : "").toBe("Demo provjera")
  })
})
