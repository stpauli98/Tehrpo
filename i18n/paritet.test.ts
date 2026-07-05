import { describe, it, expect } from "vitest"
import sr from "@/messages/sr.json"
import en from "@/messages/en.json"
import de from "@/messages/de.json"

function keys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix]
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
}

describe("paritet kataloga", () => {
  const srK = keys(sr).sort()
  it("en ima identične ključeve kao sr", () => expect(keys(en).sort()).toEqual(srK))
  it("de ima identične ključeve kao sr", () => expect(keys(de).sort()).toEqual(srK))
})
