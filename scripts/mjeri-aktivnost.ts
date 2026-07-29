// Pusti obje migracije u transakciji na DEMO, izmjeri novu RPC kao pravi admin
// (role=authenticated + JWT claims, isti put kao aplikacija), pa rollback.
// Dokazuje i brzinu i sigurnosni guard prije nego što išta ode na cloud.
import { readFileSync } from "node:fs"
import { Client } from "pg"

const DEMO_REF = "mtwwotmwrasozmcgqwhc"
const MIGRACIJE = [
  "supabase/migrations/20260728120100_audit_pretraga_kolone.sql",
  "supabase/migrations/20260728121000_get_aktivnost_strana.sql",
]

async function main() {
  const url = process.env.DATABASE_URL_DEMO
  if (!url) throw new Error("DATABASE_URL_DEMO nije postavljen")
  if (!url.includes(DEMO_REF)) throw new Error(`Nije DEMO (${DEMO_REF}) — prekid`)

  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    await c.query("begin")
    for (const f of MIGRACIJE) await c.query(readFileSync(f, "utf8"))
    console.log("migracije primijenjene (u transakciji)")

    const admin = await c.query(`select id from korisnici where uloga = 'admin' and aktivan limit 1`)
    const operater = await c.query(`select id from korisnici where uloga = 'operater' and aktivan limit 1`)

    const kaoKorisnik = async (uid: string) => {
      await c.query(`set local role authenticated`)
      await c.query(`select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: uid, role: "authenticated" })])
      await c.query(`set local statement_timeout = '30s'`)
    }
    const kaoPostgres = async () => { await c.query(`reset role`) }

    await kaoKorisnik(admin.rows[0].id)

    // MJERI SERVERSKO VRIJEME, NE WALL-CLOCK. Baza je u eu-west-1, a mrežni
    // round-trip s ove mašine je 70–175 ms sam po sebi (izmjereno golim `select 1`),
    // pa bi wall-clock mjerio internet vezu umjesto upita. `Execution Time` iz
    // EXPLAIN ANALYZE je serverski i nezavisan od mreže — to je jedini brojač
    // koji ovdje išta znači.
    const mjeri = async (naziv: string, sql: string, params: unknown[] = []) => {
      const wall = Date.now()
      const plan = await c.query(`explain (analyze, buffers) ${sql}`, params)
      const tekst = plan.rows.map((x) => x["QUERY PLAN"]).join("\n")
      const ms = Number(tekst.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? NaN)
      if (Number.isNaN(ms)) throw new Error(`Ne mogu pročitati Execution Time za: ${naziv}`)
      console.log(`${naziv.padEnd(34)} server=${ms.toFixed(1).padStart(8)} ms  (wall=${Date.now() - wall} ms)`)
      return { ms, r: await c.query(sql, params) }
    }

    const PRAG_MS = 50
    const mjerenja: { naziv: string; ms: number }[] = []

    const prva = await mjeri("prva porcija",
      `select * from get_aktivnost_strana(null,null,null,null,null,null,null,null,51)`)
    mjerenja.push({ naziv: "prva porcija", ms: prva.ms })
    const zadnji = prva.r.rows[prva.r.rows.length - 1]

    const druga = await mjeri("druga porcija (keyset)",
      `select * from get_aktivnost_strana(null,null,null,null,null,null,$1,$2,51)`,
      [zadnji.vrijeme, zadnji.id])
    mjerenja.push({ naziv: "druga porcija (keyset)", ms: druga.ms })

    const pretraga = await mjeri("pretraga 'termin'",
      `select * from get_aktivnost_strana(null,null,null,null,null,'termin',null,null,51)`)
    mjerenja.push({ naziv: "pretraga 'termin'", ms: pretraga.ms })

    const filter = await mjeri("filter akcija=UPDATE",
      `select * from get_aktivnost_strana(null,null,null,'UPDATE',null,null,null,null,51)`)
    mjerenja.push({ naziv: "filter akcija=UPDATE", ms: filter.ms })

    const preko = mjerenja.filter((m) => m.ms > PRAG_MS)
    if (preko.length > 0) {
      console.log(`\nPRAG PROBIJEN (${PRAG_MS} ms serverski): ` +
        preko.map((m) => `${m.naziv}=${m.ms.toFixed(1)} ms`).join(", "))
      process.exitCode = 1
    } else {
      console.log(`\nSva mjerenja ispod ${PRAG_MS} ms serverski. Stara get_aktivnost je na istoj bazi trajala 9.434 ms.`)
    }

    // Guard: operater ne smije dobiti nijedan red.
    await kaoPostgres()
    await c.query("savepoint s_op")
    await kaoKorisnik(operater.rows[0].id)
    try {
      await c.query(`select * from get_aktivnost_strana(null,null,null,null,null,null,null,null,51)`)
      console.log("GUARD PAO: operater je dobio redove!")
      process.exitCode = 1
    } catch (e) {
      const err = e as { code?: string; message: string }
      console.log(`guard OK: operater odbijen (${err.code ?? "?"}) ${err.message}`)
    }
    await c.query("rollback to savepoint s_op")
  } finally {
    await c.query("rollback").catch(() => {})
    await c.end()
  }
}

main().catch((e) => { console.error("PAD:", e.message); process.exit(1) })
