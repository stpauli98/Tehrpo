import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isCronAuthorized } from "@/lib/reminders/cronAuth"
import { osirotjeliObjekti } from "@/lib/dokumenti/sweep"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const BUCKET = "tehpro-dokumenti"

/** Rekurzivno pokupi sve putanje objekata u bucketu (folderi nemaju `id`, fajlovi ga imaju). */
async function sveObjekte(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  prefiks = "",
): Promise<string[]> {
  const out: string[] = []
  let offset = 0
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- paginacija po offsetu; broj stranica je mali (bucket nije velik)
    const { data, error } = await supabase.storage.from(BUCKET).list(prefiks, { limit: 100, offset })
    if (error) throw new Error(`list(${prefiks}): ${error.message}`)
    if (!data.length) break
    for (const it of data) {
      const put = prefiks ? `${prefiks}/${it.name}` : it.name
      // eslint-disable-next-line no-await-in-loop -- rekurzija po folderima; dubina je mala (termini/<id>/, klijenti/<id>/)
      if (it.id === null) out.push(...(await sveObjekte(supabase, put)))
      else out.push(put)
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

    const zaBrisanje = osirotjeliObjekti(objekti, putanje)
    if (!zaBrisanje.length) return NextResponse.json({ ok: true, obrisano: 0 })

    const { error: greska } = await supabase.storage.from(BUCKET).remove(zaBrisanje)
    if (greska) return NextResponse.json({ ok: false, error: greska.message }, { status: 500 })
    return NextResponse.json({ ok: true, obrisano: zaBrisanje.length })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
