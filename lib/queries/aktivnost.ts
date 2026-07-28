import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { AktivnostFilteriUlaz } from "@/lib/aktivnost/filteri"

/** Koliko redova stane u jednu porciju „Učitaj još". */
export const PO_PORCIJI = 50

export interface AktivnostRed {
  id: number
  vrijeme: string
  korisnik_id: string | null
  korisnik_ime: string | null
  korisnik_email: string | null
  akcija: string
  entitet: string | null
  entitet_id: string | null
  staro: unknown
  novo: unknown
  detalji: unknown
  cilj_ime: string | null
  cilj_klijent: string | null
}

/**
 * Diskriminisani rezultat čitanja (S1): pozivalac mora razlikovati „upit je uspio
 * i vratio 0 redova" (empty state) od „upit je pao" (GreskaUcitavanja). Poruka
 * greške se NE prosljeđuje u UI — sirovi `PostgrestError` je zabranjen po S1;
 * detalj ostaje u server logu.
 */
export type AktivnostRezultat =
  | { ok: true; redovi: AktivnostRed[]; imaJos: boolean }
  | { ok: false }

/**
 * Jedna porcija aktivnosti, keyset paginacija.
 *
 * Traži se PO_PORCIJI + 1 red: ako ih stigne toliko, znači da ima još, a 51. se
 * odbacuje. Time nema `count(*) over ()` — on je prolazio kroz cijeli filtrirani
 * skup pri svakoj stranici i bio je jedan od uzroka statement_timeouta.
 */
export async function dohvatiAktivnostStranu(
  f: AktivnostFilteriUlaz,
): Promise<AktivnostRezultat> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_aktivnost_strana", {
    p_od: f.od ?? undefined,
    p_do: f.do ?? undefined,
    p_korisnik: f.korisnik ?? undefined,
    p_akcija: f.akcija ?? undefined,
    p_entitet: undefined,
    p_pretraga: f.pretraga ?? undefined,
    p_prije_vrijeme: f.kursor?.vrijeme ?? undefined,
    p_prije_id: f.kursor?.id ?? undefined,
    p_limit: PO_PORCIJI + 1,
  })
  if (error) {
    console.error("get_aktivnost_strana:", error.message)
    return { ok: false }
  }
  const svi = data ?? []
  const imaJos = svi.length > PO_PORCIJI
  return { ok: true, redovi: imaJos ? svi.slice(0, PO_PORCIJI) : svi, imaJos }
}
