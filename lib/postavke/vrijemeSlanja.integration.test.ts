import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Client } from "pg"
import { NAJKASNIJI_DOSTIZAN_SAT, SAT_UJUTRO, SAT_POSLIJEPODNE } from "@/lib/reminders/rasporedSlanja"

const URL = process.env.TEST_DATABASE_URL

describe.skipIf(!URL)("postavke.vrijeme_slanja_sat — dostižan opseg (integracija)", () => {
  let db: Client
  beforeAll(async () => {
    db = new Client({ connectionString: URL })
    await db.connect()
  })
  afterAll(async () => {
    if (db) await db.end()
  })

  // Sve u transakciji koja se rollback-uje — postavke su singleton red id=1.
  async function uTransakciji(fn: () => Promise<void>) {
    await db.query("begin")
    try {
      await fn()
    } finally {
      await db.query("rollback")
    }
  }

  const postavi = (sat: number) =>
    db.query("update postavke set vrijeme_slanja_sat = $1 where id = 1", [sat])

  it("prima obje vrijednosti koje forma upisuje", async () => {
    await uTransakciji(async () => {
      await expect(postavi(SAT_UJUTRO)).resolves.toBeDefined()
      await expect(postavi(SAT_POSLIJEPODNE)).resolves.toBeDefined()
    })
  })

  it("prima granicu dostižnog opsega", async () => {
    await uTransakciji(async () => {
      await expect(postavi(0)).resolves.toBeDefined()
      await expect(postavi(NAJKASNIJI_DOSTIZAN_SAT)).resolves.toBeDefined()
    })
  })

  it("odbija prvu vrijednost iznad granice", async () => {
    await uTransakciji(async () => {
      await expect(postavi(NAJKASNIJI_DOSTIZAN_SAT + 1)).rejects.toThrow(/chk_postavke_vrijeme_slanja_sat/)
    })
  })

  it("odbija vrijednost koja je zatečena na DEMO-u prije migracije", async () => {
    await uTransakciji(async () => {
      await expect(postavi(23)).rejects.toThrow(/chk_postavke_vrijeme_slanja_sat/)
    })
  })

  it("odbija negativnu vrijednost", async () => {
    await uTransakciji(async () => {
      await expect(postavi(-1)).rejects.toThrow(/chk_postavke_vrijeme_slanja_sat/)
    })
  })

  it("poslije migracije nijedan red nije izvan opsega", async () => {
    const r = await db.query(
      "select count(*)::int as n from postavke where vrijeme_slanja_sat not between 0 and $1",
      [NAJKASNIJI_DOSTIZAN_SAT],
    )
    expect(r.rows[0].n).toBe(0)
  })
})
