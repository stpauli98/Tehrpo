/**
 * Gasi podsjetnike korisnicima čija adresa nije dostavljiva (rezervisani, nerutabilni
 * domeni — `.local`, `.localhost`, `.invalid`, `.home.arpa`).
 *
 * Zašto postoji: takva adresa tvrdo bounce-uje, a kako je jedan `mejl_log` red JEDAN
 * Resend send na više primalaca, taj jedan bounce boji cijeli red u „Odbijeno" iako su
 * ostali primaoci mejl dobili. PROD, 30.07.2026: `admin@tehpro.local` (aktivan,
 * prima_podsjetnike) ulazio je u svaki interni podsjetnik.
 *
 * Kriterij NIJE ovdje prepisan nego se uvozi iz `lib/reminders/recipients.ts`
 * (`jeDostavljiva`) — isti kod koji motor koristi pri slanju. SQL `like '%.local'` bi se
 * vremenom razišao sa aplikacijom; ovako je razilaženje nemoguće.
 *
 * Mijenja ISKLJUČIVO `korisnici.prima_podsjetnike`. Nalog ostaje aktivan i može se
 * prijaviti — namjerno najmanji mogući zahvat.
 *
 * Okruženje se bira EKSPLICITNO (obrazac iz scripts/apply-cloud-migration.ts):
 *   pnpm ugasi:nerutabilne --demo
 *   POTVRDI_PROD=da pnpm ugasi:nerutabilne --prod
 *
 * Bez `--primijeni` skripta samo ISPISUJE šta bi promijenila (suho pokretanje).
 */
import { Client } from "pg"
import { zahtijevajCilj, prepoznajCilj } from "@/lib/supabase/refs"
import { jeDostavljiva } from "@/lib/reminders/recipients"

type Red = { id: string; ime: string | null; email: string; aktivan: boolean }

function usage(poruka: string): never {
  console.error(`❌ ${poruka}

Upotreba:
  pnpm ugasi:nerutabilne --demo [--primijeni]
  POTVRDI_PROD=da pnpm ugasi:nerutabilne --prod [--primijeni]`)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const demo = args.includes("--demo")
  const prod = args.includes("--prod")
  const primijeni = args.includes("--primijeni")

  if (demo && prod) usage("--demo i --prod se međusobno isključuju.")
  if (!demo && !prod) usage("Nedostaje --demo ili --prod. Cilj se mora navesti eksplicitno.")

  const cilj = prod ? "prod" : "demo"
  const url = prod ? process.env.DATABASE_URL : process.env.DATABASE_URL_DEMO
  if (!url) usage(`${prod ? "DATABASE_URL" : "DATABASE_URL_DEMO"} nije postavljen.`)

  // Guard: connection string mora stvarno voditi na traženo okruženje.
  zahtijevajCilj(url, cilj, `ugasi:nerutabilne --${cilj}`)
  if (prod && process.env.POTVRDI_PROD !== "da") {
    usage("Izmjena na PRODUKCIJI traži POTVRDI_PROD=da u okruženju.")
  }

  console.log(`▶ cilj: ${prepoznajCilj(url).toUpperCase()} · režim: ${primijeni ? "PRIMJENA" : "suho (bez upisa)"}`)

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query<Red>(
      `select id, ime, email, aktivan from korisnici where prima_podsjetnike order by email`,
    )
    const sporni = rows.filter((r) => !jeDostavljiva(r.email))

    if (sporni.length === 0) {
      console.log(`✅ Nijedan primalac nema nedostavljivu adresu (provjereno ${rows.length}).`)
      return
    }

    console.log(`\nNedostavljive adrese među primaocima podsjetnika (${sporni.length}):`)
    for (const r of sporni) {
      console.log(`  • ${r.email}${r.ime ? ` (${r.ime})` : ""} · aktivan=${r.aktivan}`)
    }

    if (!primijeni) {
      console.log(`\nSuho pokretanje — ništa nije upisano. Dodaj --primijeni za stvarnu izmjenu.`)
      return
    }

    const { rowCount } = await client.query(
      `update korisnici set prima_podsjetnike = false where id = any($1::uuid[])`,
      [sporni.map((r) => r.id)],
    )
    console.log(`\n✅ Ugašeni podsjetnici za ${rowCount} korisnik(a). Nalozi ostaju aktivni.`)
  } finally {
    await client.end()
  }
}

main().catch((e: unknown) => {
  console.error("❌", e instanceof Error ? e.message : e)
  process.exit(1)
})
