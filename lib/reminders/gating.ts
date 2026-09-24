import type { SupabaseClient } from "@supabase/supabase-js"
import { APP_TIME_ZONE } from "@/lib/date"
import type { Database } from "@/db/types"

// Da li je automatsko (cron) slanje podsjetnika uključeno za ovu instancu.
// Nedostajući red/kolona = uključeno: sigurnosna tolerancija za trenutak
// između deploy-a koda i primjene migracije (spec §Ponašanje).
export function podsjetniciAktivni(
  row: { podsjetnici_aktivni: boolean } | null | undefined,
): boolean {
  return row?.podsjetnici_aktivni ?? true
}

/**
 * Lokalni sat (0–23) i ISO datum (YYYY-MM-DD) za dati trenutak u datoj zoni
 * (podrazumijevano APP_TIME_ZONE, Europe/Belgrade).
 * `now` i `timeZone` se ubacuju (bez Date.now()) → čisto i testabilno.
 */
export function lokalniSatIDatum(
  now: Date,
  timeZone = APP_TIME_ZONE,
): { sat: number; datum: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(now)
  const get = (t: string) => parts.find((x) => x.type === t)!.value
  const sat = Number(get("hour")) % 24 // 24 → 0 (ponoć u nekim okruženjima)
  return { sat, datum: `${get("year")}-${get("month")}-${get("day")}` }
}

/**
 * Treba li automatski (cron) run slati SADA: lokalni sat je dostigao izabrani
 * i danas (po lokalnom datumu u APP_TIME_ZONE) još nije slato.
 *
 * PAŽNJA: ovo je samo JEFTIN PREDFILTAR nad već pročitanim redom `postavke` —
 * odluka nije njegova. Autoritativan je `zauzmiPreDueKrug` (atomski claim u bazi):
 * između ovog čitanja i kraja kruga (~50 s pri punom cap-u) drugi poziv iste rute
 * vidi isti stari marker i ova funkcija bi mu rekla „šalji". Vidi B4 komentar niže.
 */
export function trebaSlatiSada(
  vrijemeSat: number,
  zadnjeSlanjeDatum: string | null,
  now: Date,
  timeZone = APP_TIME_ZONE,
): boolean {
  const { sat, datum } = lokalniSatIDatum(now, timeZone)
  return sat >= vrijemeSat && zadnjeSlanjeDatum !== datum
}

/** Zašto je pre-due krug preskočen (ide u odgovor rute, ne u `skipped` niz). */
export type PreDuePreskocen = "vec_slato_danas" | "marker_greska"

export type ClaimIshod =
  | { ishod: "zauzeto" }
  | { ishod: "vec_zauzeto" }
  | { ishod: "greska"; poruka: string }

/**
 * db/types.ts se generiše IZ baze, pa još ne zna za `claim_pre_due` (funkcija
 * dolazi migracijom 20260802111500 uz ovaj deploy). Umjesto `any` — uska,
 * eksplicitno otkucana tačka poziva; kad se tipovi regenerišu, kast se briše bez
 * ijedne druge izmjene.
 */
type ClaimKlijent = {
  rpc: (
    fn: "claim_pre_due",
    args: { p_datum: string },
  ) => PromiseLike<{ data: string | null; error: { message: string } | null }>
}

/**
 * B4 — ATOMSKI CLAIM dnevnog pre-due kruga.
 *
 * Ranije: marker `postavke.zadnje_slanje_datum` se ČITAO na početku zahtjeva, a
 * UPISIVAO tek poslije cijelog kruga. Svako preklapanje dva poziva u tom prozoru
 * (Vercel retry, dva regiona, ručno „Pokreni sada") pokrene isti krug ponovo, a
 * runReminders šalje mejl PRIJE upisa u `podsjetnici` — unique tamo hvata duplikat
 * tek kad je drugi mejl već otišao.
 *
 * Sada: jedan `insert ... on conflict do update ... where ... returning` u bazi.
 * Drugi poziv čeka na row lock i, kad prvi commit-uje, vidi svoj datum → prazan
 * rezultat → preskače pre-due. Dokazano dvjema psql sesijama (druga vraća NULL).
 */
export async function zauzmiPreDueKrug(
  supabase: SupabaseClient<Database>,
  datum: string,
): Promise<ClaimIshod> {
  const { data, error } = await (supabase as unknown as ClaimKlijent).rpc("claim_pre_due", {
    p_datum: datum,
  })
  if (error) return { ishod: "greska", poruka: error.message }
  return data ? { ishod: "zauzeto" } : { ishod: "vec_zauzeto" }
}

/**
 * Vraća dan u opticaj kad pre-due padne PRIJE prvog poslanog mejla (runReminders
 * baca samo iz `loadRecipientIndex`/`get_due_podsjetnici`; per-red greške hvata
 * iznutra). Bez ovoga bi jedan pad RPC-a pojeo cijeli dnevni krug do sutra.
 * Uslov `zadnje_slanje_datum = datum` znači da oslobađamo ISKLJUČIVO vlastiti
 * claim — tuđi (noviji) marker se ne dira.
 */
export async function oslobodiPreDueKrug(
  supabase: SupabaseClient<Database>,
  datum: string,
): Promise<{ oslobodjen: boolean; poruka?: string }> {
  const { data, error } = await supabase
    .from("postavke")
    .update({ zadnje_slanje_datum: null })
    .eq("id", 1)
    .eq("zadnje_slanje_datum", datum)
    .select("id")
  if (error) return { oslobodjen: false, poruka: error.message }
  return { oslobodjen: (data ?? []).length > 0 }
}
