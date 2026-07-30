import { describe, it, expect } from "vitest"
import { svePutanjeUBazi } from "./popis"

type Odgovor = { data: { storage_path: string }[] | null; error: { message: string } | null; count: number | null }

/**
 * Minimalni lažni Supabase klijent: bilježi `range()` pozive i vraća unaprijed pripremljene
 * stranice. Dovoljno da se provjeri ŠTA `svePutanjeUBazi` radi sa nepotpunim odgovorom —
 * bez ijednog dodira baze.
 */
function stubSb(stranice: Odgovor[]) {
  const pozivi: { od: number; do: number; order: string[] }[] = []
  const order: string[] = []
  let i = 0
  const upit = {
    order(kolona: string) {
      order.push(kolona)
      return upit
    },
    range(od: number, doo: number) {
      pozivi.push({ od, do: doo, order: [...order] })
      const o = stranice[i] ?? { data: [], error: null, count: null }
      i += 1
      return Promise.resolve(o)
    },
  }
  const sb = {
    from() {
      return { select: () => upit }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- namjerni stub; oblik je uzak i provjeren ovdje
  return { sb: sb as any, pozivi }
}

const red = (p: string) => ({ storage_path: p })

describe("svePutanjeUBazi", () => {
  it("jedna stranica, count se poklapa → potpun popis", async () => {
    const { sb } = stubSb([{ data: [red("a"), red("b")], error: null, count: 2 }])
    expect(await svePutanjeUBazi(sb)).toEqual({ putanje: ["a", "b"], error: null })
  })

  it("prazna tabela → prazan popis bez greške (ne pravi lažni manjak)", async () => {
    const { sb } = stubSb([{ data: [], error: null, count: 0 }])
    expect(await svePutanjeUBazi(sb)).toEqual({ putanje: [], error: null })
  })

  it("PostgREST greška → greška, prazan popis", async () => {
    const { sb } = stubSb([{ data: null, error: { message: "boom" }, count: null }])
    expect(await svePutanjeUBazi(sb)).toEqual({ putanje: [], error: "boom" })
  })

  /**
   * C1(a): ako je `db-max-rows` na projektu ispod naše stranice, prva stranica vrati manje
   * redova nego što je traženo, petlja stane — i bez ove provjere bi popis tiho bio nepotpun,
   * a svaki nepročitan red bi njegov fajl učinio „osirotjelim" i obrisao ga.
   */
  it("server cap odsjekao stranicu (500 od 3000) → EKSPLICITNA greška, ne krnji popis", async () => {
    const data = Array.from({ length: 500 }, (_, i) => red(`p${i}`))
    const { sb } = stubSb([{ data, error: null, count: 3000 }])
    const r = await svePutanjeUBazi(sb)
    expect(r.putanje).toEqual([])
    expect(r.error).toBe("nepotpun popis dokumenti: 500/3000")
  })

  /** C1(b): red ispao između stranica (nestabilan poredak / konkurentni DELETE) → isto pravilo. */
  it("manjak od jednog reda → greška", async () => {
    const { sb } = stubSb([{ data: [red("a"), red("b")], error: null, count: 3 }])
    expect((await svePutanjeUBazi(sb)).error).toBe("nepotpun popis dokumenti: 2/3")
  })

  it("paginira dalje dok je stranica puna i slaže sve stranice", async () => {
    const puna = Array.from({ length: 1000 }, (_, i) => red(`p${i}`))
    const { sb, pozivi } = stubSb([
      { data: puna, error: null, count: 1002 },
      { data: [red("z0"), red("z1")], error: null, count: 1002 },
    ])
    const r = await svePutanjeUBazi(sb)
    expect(r.error).toBeNull()
    expect(r.putanje).toHaveLength(1002)
    expect(pozivi.map((p) => [p.od, p.do])).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  /** C1(b): bez ORDER BY Postgres ne obavezuje poredak između dva LIMIT/OFFSET upita. */
  it("uvijek sortira po storage_path prije range()", async () => {
    const { sb, pozivi } = stubSb([{ data: [red("a")], error: null, count: 1 }])
    await svePutanjeUBazi(sb)
    expect(pozivi[0]?.order).toEqual(["storage_path"])
  })
})
