import { describe, it, expect } from "vitest"
import { postojiRed } from "./db-postoji"

type Odgovor = {
  data: { id: string } | null
  error: { code?: string | null; message?: string | null } | null
}
const upit = (o: Odgovor) => Promise.resolve(o)

describe("postojiRed", () => {
  it("red nađen → postoji, bez greške", async () => {
    expect(await postojiRed(upit({ data: { id: "abc" }, error: null }))).toEqual({
      postoji: true,
      greska: null,
    })
  })

  it("nema reda (RLS ga ne vidi ili je već obrisan) → ne postoji, bez greške", async () => {
    expect(await postojiRed(upit({ data: null, error: null }))).toEqual({
      postoji: false,
      greska: null,
    })
  })

  /**
   * Ključna razlika: pad upita NIJE „nema reda". Bez ove grane bi mrežni/PostgREST otkaz
   * dao `data === null` i korisniku bi se reklo da zapis ne postoji — a ništa nije ni
   * pokušano. Ista logika kao S1 u app/(dashboard)/termini/actions.ts.
   */
  it("greška upita → greška se PROSLJEĐUJE, ne prevodi se u „ne postoji“", async () => {
    const error = { code: "PGRST301", message: "JWT expired" }
    expect(await postojiRed(upit({ data: null, error }))).toEqual({ postoji: false, greska: error })
  })

  it("greška uz vraćen red → i dalje greška (rezultat se ne smije koristiti)", async () => {
    const error = { code: "57014", message: "canceling statement due to statement timeout" }
    expect(await postojiRed(upit({ data: { id: "abc" }, error }))).toEqual({
      postoji: false,
      greska: error,
    })
  })
})
