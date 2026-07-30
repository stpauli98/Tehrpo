import { describe, it, expect } from "vitest"
import { svePutanjeUBazi } from "./popis"

/**
 * Lažna `dokumenti` tabela: stvarno primjenjuje `.gt()` i `.limit()` nad živim nizom redova,
 * pa se keyset petlja testira kao petlja — ne kao niz unaprijed pripremljenih odgovora.
 * Niz `redovi` se čita pri SVAKOM upitu, pa test može pisati u njega usred paginacije.
 *
 * `serverCap` glumi PostgREST `db-max-rows`: vraća najviše toliko redova bez obzira na `.limit()`.
 * `maxPoziva` je zaštita testa od beskonačne petlje — ako kursor ne napreduje (ili `.gt()`
 * nestane), ista stranica se vrti u krug, pa stub pukne sa jasnom porukom umjesto da test visi.
 */
function stubTabela(
  redovi: string[],
  opcije: { serverCap?: number; maxPoziva?: number; poslijeStranice?: (i: number) => void } = {},
) {
  const cap = opcije.serverCap ?? Infinity
  const maxPoziva = opcije.maxPoziva ?? 20
  const pozivi: { gt: string | null; limit: number; vraceno: number }[] = []

  const napraviUpit = () => {
    let gt: string | null = null
    const u = {
      gt(_kolona: string, vrijednost: string) {
        gt = vrijednost
        return u
      },
      order() {
        return u
      },
      limit(n: number) {
        if (pozivi.length >= maxPoziva) {
          throw new Error(
            `stub: ${maxPoziva} poziva bez kraja — kursor ne napreduje (zadnji .gt() = ${JSON.stringify(gt)})`,
          )
        }
        const sortirani = [...redovi].sort()
        const poslije = gt === null ? sortirani : sortirani.filter((p) => p > gt!)
        const data = poslije.slice(0, Math.min(n, cap)).map((storage_path) => ({ storage_path }))
        pozivi.push({ gt, limit: n, vraceno: data.length })
        opcije.poslijeStranice?.(pozivi.length - 1)
        return Promise.resolve({ data, error: null })
      },
    }
    return u
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- namjerni stub; oblik je uzak i provjeren ovdje
  const sb = { from: () => ({ select: () => napraviUpit() }) } as any
  return { sb, pozivi }
}

/** Stub koji uvijek vraća istu grešku. */
function stubGreska(message: string) {
  const u = {
    gt: () => u,
    order: () => u,
    limit: () => Promise.resolve({ data: null, error: { message } }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- namjerni stub
  return { from: () => ({ select: () => u }) } as any
}

const putanje = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i).padStart(5, "0")}.pdf`)

describe("svePutanjeUBazi", () => {
  it("jedna stranica → potpun popis", async () => {
    const { sb } = stubTabela(["b.pdf", "a.pdf", "c.pdf"])
    expect(await svePutanjeUBazi(sb)).toEqual({ putanje: ["a.pdf", "b.pdf", "c.pdf"], error: null })
  })

  it("prazna tabela → prazan popis bez greške", async () => {
    const { sb } = stubTabela([])
    expect(await svePutanjeUBazi(sb)).toEqual({ putanje: [], error: null })
  })

  it("PostgREST greška → greška, prazan popis (pozivalac prekida prije brisanja)", async () => {
    expect(await svePutanjeUBazi(stubGreska("boom"))).toEqual({ putanje: [], error: "boom" })
  })

  it("više stranica → svi redovi; kursor kreće od zadnje pročitane putanje", async () => {
    const svi = putanje(2500)
    const { sb, pozivi } = stubTabela(svi)
    const r = await svePutanjeUBazi(sb)
    expect(r.error).toBeNull()
    expect(r.putanje).toEqual(svi)
    // 1000 + 1000 + 500 + prazna stranica (jedini uslov prekida)
    expect(pozivi.map((p) => p.vraceno)).toEqual([1000, 1000, 500, 0])
    expect(pozivi.map((p) => p.gt)).toEqual(["", svi[999], svi[1999], svi[2499]])
  })

  /**
   * C1(2): `db-max-rows` ispod tražene stranice. Sa OFFSET-om je kratka stranica značila kraj
   * i sve iza reza bi tiho nestalo iz popisa; keyset staje tek na PRAZNU stranicu, pa server
   * cap znači samo više krugova.
   */
  it("server cap (500) ispod tražene stranice (1000) → i dalje pročita SVE redove", async () => {
    const svi = putanje(2500)
    const { sb, pozivi } = stubTabela(svi, { serverCap: 500 })
    const r = await svePutanjeUBazi(sb)
    expect(r.putanje).toEqual(svi)
    expect(pozivi.map((p) => p.vraceno)).toEqual([500, 500, 500, 500, 500, 0])
  })

  /**
   * C1(3): oblik kvara koji je „zbir na kraju" propuštao. Brisanje UNUTAR već pročitanog
   * prefiksa pomjeri OFFSET naniže i preskoči tačno toliko živih redova, a `count` i dužina
   * popisa se svejedno poklope — provjera prođe nad nepotpunim popisom. Keyset traži
   * `> zadnja`, pa pozicija reda ne zavisi ni od čega osim od njegove vlastite vrijednosti.
   */
  it("konkurentni DELETE unutar pročitanog prefiksa → nijedan živi red se ne preskoči", async () => {
    const tabela = putanje(2500)
    const obrisani = tabela.slice(100, 200) // 100 redova IZ prve, već pročitane stranice
    const { sb } = stubTabela(tabela, {
      poslijeStranice: (i) => {
        if (i === 0) for (const p of obrisani) tabela.splice(tabela.indexOf(p), 1)
      },
    })

    const r = await svePutanjeUBazi(sb)

    expect(r.error).toBeNull()
    // Svaki red koji je bio živ CIJELO vrijeme mora biti u popisu — posebno oni odmah iza
    // granice prve stranice (rangovi 1000–1099), koje bi OFFSET verzija preskočila jer bi
    // ih brisanje 100 redova ispred njih pomjerilo ispod offseta 1000.
    const zivi = putanje(2500).filter((p) => !obrisani.includes(p))
    for (const p of zivi) expect(r.putanje).toContain(p)
    expect(r.putanje.filter((p) => p >= "p01000.pdf" && p < "p01100.pdf")).toHaveLength(100)
    // Obrisani redovi su pročitani PRIJE brisanja, pa ostaju u popisu; to samo znači da će
    // njihovi fajlovi ovaj put biti sačuvani — griješi se u smjeru čuvanja.
    expect(r.putanje).toEqual(putanje(2500))
  })

  it("uvijek traži strogo veće od kursora (`.gt`), nikad ne ponavlja prvu stranicu", async () => {
    const { sb, pozivi } = stubTabela(putanje(1500))
    await svePutanjeUBazi(sb)
    expect(pozivi.map((p) => p.gt)).toEqual(["", "p00999.pdf", "p01499.pdf"])
  })

  /**
   * `storage_path` nema unique constraint (jedinstvenost je de-facto, iz UUID-a u putanji).
   * Duplikat tačno na granici stranice se sa `.gt()` preskače — bezopasno: popis se koristi
   * samo kao SKUP putanja, a ista putanja znači isti fajl, pa je dovoljno da se pojavi jednom
   * da fajl ne bude proglašen osirotjelim.
   */
  it("duplikat putanje na granici stranice → preskočen, ali putanja OSTAJE u popisu", async () => {
    const { sb } = stubTabela(["a.pdf", "b.pdf", "b.pdf", "c.pdf"], { serverCap: 2 })
    const r = await svePutanjeUBazi(sb)
    expect(r.error).toBeNull()
    expect(new Set(r.putanje)).toEqual(new Set(["a.pdf", "b.pdf", "c.pdf"]))
  })
})
