/**
 * Popisivanje ulaza za GC osirotjelih dokumenata — JEDNA kopija koju dijele
 * `scripts/gc-orphan-dokumenti.ts` (ručni, dry-run po defaultu) i
 * `app/api/cron/ciscenje-storagea/route.ts` (noćni cron).
 *
 * Ranije su postojale dvije skoro-identične kopije i već su se razišle (jedna je grace
 * računala od `updated_at ?? created_at`, druga samo od `created_at`). Pošto obje hrane
 * ISTU destruktivnu odluku, razlika u ulazu je razlika u tome šta se briše — zato jedna kopija.
 */
import type { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { StorageObjekat } from "@/lib/dokumenti-gc"

type Sb = ReturnType<typeof createAdminSupabaseClient>

export const DOKUMENTI_BUCKET = "tehpro-dokumenti"

const STRANICA_STORAGE = 100
const STRANICA_DB = 1000

/**
 * Rekurzivno izlistaj sve FAJLOVE ispod prefiksa. Folderi imaju `id === null`.
 *
 * `updatedAt` pada na `updated_at ?? created_at ?? sada` — `updated_at` je uvijek >= `created_at`,
 * pa fajl ispada MLAĐI i time duže zaštićen grace periodom. Fallback na „sada" znači da objekat
 * bez ijednog timestampa važi kao upravo nastao, tj. zaštićen. Oba fallback-a griješe u smjeru
 * čuvanja fajla.
 */
export async function listajFajlove(
  sb: Sb,
  prefix = "",
  bucket: string = DOKUMENTI_BUCKET,
): Promise<StorageObjekat[]> {
  const rezultat: StorageObjekat[] = []
  let offset = 0
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- paginacija po offsetu; broj stranica je mali
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: STRANICA_STORAGE, offset })
    if (error) throw new Error(`list "${prefix}": ${error.message}`)
    const stavke = data ?? []
    for (const s of stavke) {
      const puniPut = prefix ? `${prefix}/${s.name}` : s.name
      if (s.id === null) {
        // eslint-disable-next-line no-await-in-loop -- rekurzija po folderima; dubina je mala
        const ugnijezdeni = await listajFajlove(sb, puniPut, bucket)
        rezultat.push(...ugnijezdeni)
      } else {
        rezultat.push({
          path: puniPut,
          updatedAt: s.updated_at ?? s.created_at ?? new Date().toISOString(),
        })
      }
    }
    if (stavke.length < STRANICA_STORAGE) break
    offset += STRANICA_STORAGE
  }
  return rezultat
}

/**
 * Sve `storage_path` vrijednosti iz `dokumenti`, paginirano.
 *
 * Cijela sigurnost metenja stoji na tome da je ovaj popis POTPUN: svaka putanja koja fali
 * ovdje izgleda kao osirotjeli fajl i biva obrisana. Paginacija sama po sebi to NE garantuje:
 *
 * - `LIMIT/OFFSET` bez `ORDER BY` Postgres ne obavezuje ni na kakav poredak između dva upita,
 *   pa red može ispasti iz rezultata između stranice N i N+1 (HOT update, autovacuum, promjena
 *   plana). Zato `.order("storage_path")` — stabilan poredak po jedinstvenoj koloni.
 * - „Stani kad stranica vrati manje od `STRANICA_DB`" je tačno samo dok je `STRANICA_DB` STROGO
 *   ispod PostgREST-ovog `db-max-rows`. Ako je server cap ikad manji ili jednak, prva stranica
 *   vrati manje redova, petlja stane, i sve iza tog reza je nevidljivo — bez greške.
 *
 * Zato se na kraju broj skupljenih putanja poredi sa `count: "exact"`. Manjak koji se ne može
 * objasniti se vraća kao EKSPLICITNA greška, jer pozivalac na grešku prekida prije brisanja —
 * tiho odsijecanje pretvoreno u glasan otkaz. Istovremeni INSERT/DELETE u `dokumenti` tokom
 * paginacije takođe može oboriti ovu provjeru; to je lažni alarm koji košta jedan preskočen
 * noćni prolaz, što je jeftinije od jednog pogrešnog brisanja.
 */
export async function svePutanjeUBazi(sb: Sb): Promise<{ putanje: string[]; error: string | null }> {
  const putanje: string[] = []
  let offset = 0
  let ukupno: number | null = null
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- paginacija po offsetu; broj stranica prati veličinu tabele
    const { data, error, count } = await sb
      .from("dokumenti")
      .select("storage_path", { count: "exact" })
      .order("storage_path") // stabilna paginacija
      .range(offset, offset + STRANICA_DB - 1)
    if (error) return { putanje: [], error: error.message }
    if (count !== null && count !== undefined) ukupno = count
    const red = data ?? []
    for (const r of red) putanje.push(r.storage_path)
    if (red.length < STRANICA_DB) break
    offset += STRANICA_DB
  }
  if (ukupno !== null && putanje.length !== ukupno) {
    return { putanje: [], error: `nepotpun popis dokumenti: ${putanje.length}/${ukupno}` }
  }
  return { putanje, error: null }
}
