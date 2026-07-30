import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isCronAuthorized } from "@/lib/reminders/cronAuth"
import { odluciSta, type StorageStavka } from "@/lib/dokumenti/sweep"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const BUCKET = "tehpro-dokumenti"

// Upload prvo piše fajl pa onda red u `dokumenti`. Fajl uhvaćen u tom procjepu izgleda
// osirotjelo. 24h je isti prag koji već koristi lib/dokumenti-gc.ts.
const GRACE_MS = 24 * 60 * 60 * 1000

/** Rekurzivno pokupi sve objekte u bucketu (folderi nemaju `id`, fajlovi ga imaju), sa datumom kreiranja. */
async function sveObjekte(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  prefiks = "",
): Promise<StorageStavka[]> {
  const out: StorageStavka[] = []
  let offset = 0
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- paginacija po offsetu; broj stranica je mali (bucket nije velik)
    const { data, error } = await supabase.storage.from(BUCKET).list(prefiks, { limit: 100, offset })
    if (error) throw new Error(`list(${prefiks}): ${error.message}`)
    if (!data.length) break
    for (const it of data) {
      const put = prefiks ? `${prefiks}/${it.name}` : it.name
      if (it.id === null) {
        // eslint-disable-next-line no-await-in-loop -- rekurzija po folderima; dubina je mala (termini/<id>/, klijenti/<id>/)
        out.push(...(await sveObjekte(supabase, put)))
      } else {
        out.push({ path: put, kreiran: it.created_at ?? new Date().toISOString() })
      }
    }
    if (data.length < 100) break
    offset += 100
  }
  return out
}

/**
 * Sve `storage_path` vrijednosti iz `dokumenti`, paginirano.
 * Bez ovoga bi PostgREST-ov podrazumijevani max-rows (obično 1000) tiho odsjekao rezultat:
 * upit ne bi vratio grešku ni prazan niz, samo NEPOTPUN — a redovi iza te granice bi izgledali
 * kao osirotjeli i njihovi fajlovi bi bili obrisani iako imaju validan red. Paginacija čini
 * odsijecanje nemogućim; jedini način da `putanjeUBazi` bude nepotpun ostaje eksplicitna greška,
 * koju grana ispod prekida prije brisanja.
 */
async function svePutanjeUBazi(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
): Promise<{ putanje: string[]; error: string | null }> {
  const putanje: string[] = []
  const STRANICA = 1000
  let offset = 0
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- paginacija po offsetu; broj stranica prati veličinu tabele
    const { data, error } = await supabase
      .from("dokumenti")
      .select("storage_path")
      .range(offset, offset + STRANICA - 1)
    if (error) return { putanje: [], error: error.message }
    const red = data ?? []
    for (const r of red) putanje.push(r.storage_path)
    if (red.length < STRANICA) break
    offset += STRANICA
  }
  return { putanje, error: null }
}

async function handle(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const supabase = createAdminSupabaseClient()
  try {
    const objekti = await sveObjekte(supabase)
    const { putanje, error } = await svePutanjeUBazi(supabase)
    if (error) return NextResponse.json({ ok: false, error }, { status: 500 })

    // Sve odluke (prekid na praznu bazu, grace period, set-difference) su u čistoj
    // odluciSta — ruta samo prikuplja I/O i izvršava presudu.
    const odluka = odluciSta(objekti, putanje, Date.now(), GRACE_MS)
    if (odluka.akcija === "prekid") {
      return NextResponse.json({ ok: false, error: odluka.razlog }, { status: 500 })
    }

    const zaBrisanje = odluka.putanje
    if (!zaBrisanje.length) return NextResponse.json({ ok: true, obrisano: 0 })

    // Brisanje u grupama od 100, kao postojeći scripts/gc-orphan-dokumenti.ts.
    let obrisano = 0
    for (let i = 0; i < zaBrisanje.length; i += 100) {
      const grupa = zaBrisanje.slice(i, i + 100)
      // eslint-disable-next-line no-await-in-loop -- sekvencijalne grupe; broj grupa je mali
      const { error: greska } = await supabase.storage.from(BUCKET).remove(grupa)
      if (greska) return NextResponse.json({ ok: false, error: greska.message }, { status: 500 })
      obrisano += grupa.length
    }
    return NextResponse.json({ ok: true, obrisano })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
