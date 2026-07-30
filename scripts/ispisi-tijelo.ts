/**
 * Ispisuje AKTUELNU definiciju objekta iz žive baze (funkcija / view / constraint).
 *
 * Zašto postoji — konkretan incident, 2026-07-30: migracija `20260730160000` je radila
 * `drop + create` nad `get_post_due_termine`, a tijelo je prekopirano iz najnovijeg fajla
 * U SVOJOJ GRANI (`20260728141000`). U međuvremenu je druga grana kroz
 * `20260730120000_vremenska_zona_belgrade.sql` cijeli SQL sloj prebacila sa `current_date`
 * na `(now() at time zone 'Europe/Belgrade')::date`. Rezultat: ispravka zone je tiho
 * poništena baš u funkciji koja odlučuje kada ide alarm o propuštenom roku. Bez greške,
 * bez pada testa — nijedan test ne provjerava zonu u toj funkciji.
 *
 * Pravilo koje ovaj alat omogućava: kad `create or replace` / `drop+create` dira objekat
 * koji nisi ti napravio, tijelo se kopira IZ BAZE, ne iz fajla u grani. Fajl u grani zna
 * samo šta je tvoja grana uradila; baza zna šta su uradile sve.
 *
 * Upotreba:
 *   pnpm db:tijelo get_post_due_termine --demo
 *   pnpm db:tijelo termini_view --prod
 *   pnpm db:tijelo --like mejl --demo      # pretraga po dijelu imena
 *
 * Isključivo čita (`transaction read only`), pa `--prod` ne traži POTVRDI_PROD.
 */
import { Client } from "pg"
import { zahtijevajCilj, prepoznajCilj } from "@/lib/supabase/refs"

function usage(poruka: string): never {
  console.error(`❌ ${poruka}

Upotreba:
  pnpm db:tijelo <ime_objekta> --demo|--prod
  pnpm db:tijelo --like <dio_imena> --demo|--prod`)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const demo = args.includes("--demo")
  const prod = args.includes("--prod")
  const likeIdx = args.indexOf("--like")
  const pozicioni = args.filter((a) => !a.startsWith("--"))
  const pretraga = likeIdx !== -1
  const ime = pretraga ? args[likeIdx + 1] : pozicioni[0]

  if (demo && prod) usage("--demo i --prod se međusobno isključuju.")
  if (!demo && !prod) usage("Nedostaje --demo ili --prod. Cilj se mora navesti eksplicitno.")
  if (!ime) usage("Ime objekta je obavezno.")

  const cilj = prod ? "prod" : "demo"
  const url = prod ? process.env.DATABASE_URL : process.env.DATABASE_URL_DEMO
  if (!url) usage(`${prod ? "DATABASE_URL" : "DATABASE_URL_DEMO"} nije postavljen.`)
  zahtijevajCilj(url, cilj, `db:tijelo --${cilj}`)

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    // Nijedan upis nije moguć ni greškom — sesija je read-only.
    await client.query("set session characteristics as transaction read only")
    console.log(`▶ izvor: ${prepoznajCilj(url).toUpperCase()}\n`)

    const uslov = pretraga ? "p.proname like '%' || $1 || '%'" : "p.proname = $1"
    const funkcije = await client.query<{ ime: string; def: string }>(
      `select p.proname as ime, pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and ${uslov}
       order by p.proname, pg_get_function_identity_arguments(p.oid)`,
      [ime],
    )
    for (const f of funkcije.rows) {
      console.log(`── FUNKCIJA ${f.ime} ${"─".repeat(Math.max(0, 60 - f.ime.length))}`)
      console.log(f.def.trimEnd())
      console.log()
    }

    const uslovV = pretraga ? "c.relname like '%' || $1 || '%'" : "c.relname = $1"
    const viewovi = await client.query<{ ime: string; def: string; invoker: boolean }>(
      // Postgres čuva reloption doslovno kako je napisan (`security_invoker=on`), NE
      // normalizuje ga u `true`. Poređenje samo sa 'true' zato lažno prijavi da view
      // zaobilazi RLS — provjereno na DEMO i PROD, gdje su sva tri view-a ispravna.
      `select c.relname as ime,
              pg_get_viewdef(c.oid, true) as def,
              coalesce((select lower(option_value) in ('on','true')
                        from pg_options_to_table(c.reloptions)
                        where option_name = 'security_invoker'), false) as invoker
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('v','m') and ${uslovV}
       order by c.relname`,
      [ime],
    )
    for (const v of viewovi.rows) {
      console.log(`── VIEW ${v.ime} ${"─".repeat(Math.max(0, 64 - v.ime.length))}`)
      // security_invoker=on je obavezan: bez njega view zaobilazi RLS bazne tabele.
      console.log(`-- security_invoker = ${v.invoker ? "on ✅" : "OFF ⚠ (view zaobilazi RLS!)"}`)
      console.log(`create or replace view ${v.ime}\nwith (security_invoker = on) as\n${v.def.trimEnd()}`)
      console.log()
    }

    if (funkcije.rowCount === 0 && viewovi.rowCount === 0) {
      console.log(`Nema funkcije ni view-a po kriteriju "${ime}" u šemi public.`)
      console.log(`Za tabele koristi \`pnpm db:types\` ili information_schema.columns.`)
    } else {
      console.log(
        `⚠ Kopiraj tijelo ODAVDE u novu migraciju, ne iz starijeg fajla u grani —\n` +
          `  fajl zna samo šta je tvoja grana uradila, baza zna šta su uradile sve.`,
      )
    }
  } finally {
    await client.end()
  }
}

main().catch((e: unknown) => {
  console.error("❌", e instanceof Error ? e.message : e)
  process.exit(1)
})
