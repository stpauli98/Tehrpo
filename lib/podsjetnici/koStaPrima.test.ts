import { describe, it, expect } from "vitest"
import sr from "@/messages/sr.json"
import en from "@/messages/en.json"
import de from "@/messages/de.json"

describe("katalozi — opis automatskog slanja", () => {
  const katalozi = { sr, en, de }

  it("ne tvrdi zastarjelo vrijeme slanja (cron je 09:00 i 13:00 UTC)", () => {
    for (const [jezik, k] of Object.entries(katalozi)) {
      const opis = k.postavke.podsjetniciKontrole.opis
      expect(opis, jezik).not.toMatch(/06:00|6:00/)
    }
  })

  it("kaže da obavijest o zakazivanju ima svoj prekidač", () => {
    // Nalaz #3: podsjetnici_aktivni NE gasi zabiljezi_zakazano_obavijest (gejtuje ga
    // samo zakazano_obavijest_aktivna). Opis to mora reći, jer se inače čita kao master.
    expect(sr.postavke.podsjetniciKontrole.opis).toContain("zakazivanju")
    expect(en.postavke.podsjetniciKontrole.opis.toLowerCase()).toContain("scheduling")
    expect(de.postavke.podsjetniciKontrole.opis.toLowerCase()).toContain("terminierung")
  })
})
