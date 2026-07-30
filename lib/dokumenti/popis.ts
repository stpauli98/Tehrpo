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
 * Sve `storage_path` vrijednosti iz `dokumenti`, paginirano KEYSET-om (kursor po vrijednosti
 * kolone), ne OFFSET-om.
 *
 * Cijela sigurnost metenja stoji na tome da je ovaj popis POTPUN: svaka putanja koja fali ovdje
 * izgleda kao osirotjeli fajl i biva obrisana. `LIMIT/OFFSET` to ne može dati, iz tri razloga:
 *
 * 1. Bez `ORDER BY` Postgres ne obavezuje ni na kakav poredak između dva upita, pa red može
 *    ispasti iz rezultata između stranice N i N+1 (HOT update, autovacuum, promjena plana).
 * 2. „Stani kad stranica vrati manje od `STRANICA_DB`" je tačno samo dok je `STRANICA_DB` STROGO
 *    ispod PostgREST-ovog `db-max-rows`. Ako je server cap ikad manji ili jednak, prva stranica
 *    vrati manje redova, petlja stane, i sve iza tog reza je nevidljivo — bez greške.
 * 3. OFFSET se pomjera pod nogama. Konkurentni DELETE unutar VEĆ PROČITANOG prefiksa pomjeri sve
 *    preostale redove naniže, pa `offset` preskoči tačno onoliko ŽIVIH redova koliko je obrisano
 *    ispred njih. Nijedan zbir na kraju to ne hvata: obrisani redovi izlaze i iz brojača i iz
 *    popisa, pa se `count` i dužina popisa i dalje poklope — provjera prođe nad NEPOTPUNIM
 *    popisom. (2500 redova; stranica 1 pročita rangove 0–999; 100 redova iz tog prefiksa se
 *    obriše; stranica 2 na offsetu 1000 čita nekadašnje rangove 1100–2099, a 100 živih redova
 *    koji su skliznuli u 900–999 ne pročita niko. 2400 = 2400, provjera ćuti, 100 živih fajlova
 *    izgleda osirotjelo.) Ograda po udjelu tu ne pomaže — 100/2400 je ~4%.
 *
 * Keyset je imun na sve tri po konstrukciji: svaka stranica traži `storage_path > zadnja`, pa
 * pozicija reda ne zavisi ni od čega osim od njegove vlastite vrijednosti. Brisanje ili
 * ubacivanje IZA kursora ne pomjera ništa što tek treba pročitati, a petlja staje tek na PRAZNU
 * stranicu — kratka stranica (server cap) samo znači još jedan krug. Zato je i `count`-provjera
 * uklonjena umjesto zadržana: uz keyset više ništa ne bi hvatala, a pod konkurentnim pisanjem bi
 * i dalje mogla proći nad nepotpunim popisom. Ograda koja laže je gora nego nikakva.
 *
 * Šta keyset NE pokriva, i zašto je to u redu:
 *
 * - Red UBAČEN tokom paginacije sa putanjom manjom od kursora se ne pročita. Takav red je upravo
 *   nastao upload-om, pa je i njegov fajl nastao maločas — grace period (24h) ga štiti od
 *   brisanja. Ovo je isti procjep zbog kojeg grace uopšte postoji.
 * - `dokumenti.storage_path` NEMA unique constraint (20260620201156_supporting_tables.sql:12);
 *   jedinstvenost je de-facto, iz UUID-a u putanji. Sa `.gt()` nad nejedinstvenim ključem bi
 *   tačan duplikat na granici stranice bio preskočen. Bezopasno je: potrošač koristi SAMO
 *   vrijednost putanje, a dvije iste putanje znače isti fajl — dovoljno je da ga popis sadrži
 *   jednom da fajl NE bude proglašen osirotjelim. Preskočen duplikat ne može ništa izgubiti.
 *
 * Nema indeksa na `storage_path` (samo `idx_dokumenti_termin`), pa svaka stranica sortira.
 * Tabela je mala i posao je noćni; ako ikad poraste, indeks je popravka, ne promjena logike.
 */
export async function svePutanjeUBazi(sb: Sb): Promise<{ putanje: string[]; error: string | null }> {
  const putanje: string[] = []
  let zadnja = "" // kursor: svaka neprazna putanja je > "" , pa prva stranica kreće od početka
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- keyset paginacija; broj stranica prati veličinu tabele
    const { data, error } = await sb
      .from("dokumenti")
      .select("storage_path")
      .gt("storage_path", zadnja)
      .order("storage_path")
      .limit(STRANICA_DB)
    if (error) return { putanje: [], error: error.message }
    const red = data ?? []
    if (red.length === 0) break // jedini uslov prekida — kratka stranica NIJE kraj
    for (const r of red) putanje.push(r.storage_path)
    zadnja = red[red.length - 1]!.storage_path
  }
  return { putanje, error: null }
}
