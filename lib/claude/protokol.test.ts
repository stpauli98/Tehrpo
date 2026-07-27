import { describe, it, expect } from "vitest"
import { z } from "zod"
import { MAX_PORUKA_ZNAKOVA } from "./protokol"

/**
 * Granica dužine poruke je ugovor između servera (zod `max` u `app/api/chat/route.ts`)
 * i klijenta (`maxLength` + brojač u `ChatInput`). Test pribija semantiku granice:
 * `max` je UKLJUČIV, pa `maxLength={MAX_PORUKA_ZNAKOVA}` na textarea odgovara tačno
 * onome što server prihvata — nijedna dozvoljena poruka se ne odsijeca, nijedna
 * odsječena ne pada na (nevidljivi) 400.
 */
describe("MAX_PORUKA_ZNAKOVA", () => {
  const schema = z.string().min(1).max(MAX_PORUKA_ZNAKOVA)

  it("je pozitivan cijeli broj", () => {
    expect(Number.isInteger(MAX_PORUKA_ZNAKOVA)).toBe(true)
    expect(MAX_PORUKA_ZNAKOVA).toBeGreaterThan(0)
  })

  it("prihvata poruku tačno na granici", () => {
    expect(schema.safeParse("a".repeat(MAX_PORUKA_ZNAKOVA)).success).toBe(true)
  })

  it("odbija poruku dužu od granice za jedan znak", () => {
    expect(schema.safeParse("a".repeat(MAX_PORUKA_ZNAKOVA + 1)).success).toBe(false)
  })

  it("odbija praznu poruku", () => {
    expect(schema.safeParse("").success).toBe(false)
  })
})
