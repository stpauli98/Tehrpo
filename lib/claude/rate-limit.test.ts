import { describe, it, expect } from "vitest"
import {
  rateLimitWindows,
  prekoracenLimit,
  RATE_LIMIT_PER_MIN,
  RATE_LIMIT_PER_DAY,
} from "./rate-limit"

describe("rate-limit prozori", () => {
  it("minuteAgo = -60s, dayAgo = -24h od nowMs", () => {
    const now = Date.parse("2026-07-12T12:00:00.000Z")
    const { minuteAgo, dayAgo } = rateLimitWindows(now)
    expect(minuteAgo).toBe("2026-07-12T11:59:00.000Z")
    expect(dayAgo).toBe("2026-07-11T12:00:00.000Z")
  })
})

describe("prekoracenLimit", () => {
  it("ispod oba limita → false", () => {
    expect(prekoracenLimit(RATE_LIMIT_PER_MIN - 1, RATE_LIMIT_PER_DAY - 1)).toBe(false)
  })
  it("na/iznad minutnog → true", () => {
    expect(prekoracenLimit(RATE_LIMIT_PER_MIN, 0)).toBe(true)
  })
  it("na/iznad dnevnog → true", () => {
    expect(prekoracenLimit(0, RATE_LIMIT_PER_DAY)).toBe(true)
  })
})
