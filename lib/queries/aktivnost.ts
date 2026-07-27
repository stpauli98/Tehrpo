import { createServerSupabaseClient } from "@/lib/supabase/server"

export interface AktivnostFilter {
  od?: string
  do?: string
  korisnik?: string
  akcija?: string
  entitet?: string
  pretraga?: string
  limit?: number
  offset?: number
}

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
  ukupno: number
}

/**
 * Diskriminisani rezultat čitanja (S1): pozivalac mora razlikovati „upit je uspio
 * i vratio 0 redova" (empty state) od „upit je pao" (GreskaUcitavanja). Poruka
 * greške se NE prosljeđuje u UI — sirovi `PostgrestError` je zabranjen po S1;
 * detalj ostaje u server logu.
 */
export type AktivnostRezultat =
  | { ok: true; redovi: AktivnostRed[]; ukupno: number }
  | { ok: false }

export async function dohvatiAktivnost(f: AktivnostFilter): Promise<AktivnostRezultat> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_aktivnost", {
    p_od: f.od ?? undefined,
    p_do: f.do ?? undefined,
    p_korisnik: f.korisnik ?? undefined,
    p_akcija: f.akcija ?? undefined,
    p_entitet: f.entitet ?? undefined,
    p_pretraga: f.pretraga ?? undefined,
    p_limit: f.limit ?? 50,
    p_offset: f.offset ?? 0,
  })
  if (error) {
    console.error("get_aktivnost:", error.message)
    return { ok: false }
  }
  const redovi = (data ?? []) as AktivnostRed[]
  return { ok: true, redovi, ukupno: redovi[0]?.ukupno ?? 0 }
}
