import { cache } from "react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { Uloga } from "@/lib/auth/roles"
import type { Dozvole } from "@/lib/auth/dozvole"

export type TrenutniKorisnik = { id: string; ime: string; uloga: Uloga; dozvole: Dozvole }

/** Vraća profil prijavljenog korisnika ili null. Jedan DB round-trip. */
export const getTrenutniKorisnik = cache(
  async function getTrenutniKorisnikImpl(): Promise<TrenutniKorisnik | null> {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return null
    const { data } = await supabase
      .from("korisnici")
      .select(
        "id, ime, uloga, smije_brisati_svoje, smije_brisati_tudje, smije_brisati_klijente, smije_zatvoriti_bez_nalaza",
      )
      .eq("id", auth.user.id)
      .maybeSingle()
    if (!data) return null
    return {
      id: data.id,
      ime: data.ime,
      uloga: data.uloga as Uloga,
      // Sirove kolone — `efektivneDozvole` primjenjuje ulogu (admin sve, pregled ništa).
      dozvole: {
        smije_brisati_svoje: data.smije_brisati_svoje,
        smije_brisati_tudje: data.smije_brisati_tudje,
        smije_brisati_klijente: data.smije_brisati_klijente,
        smije_zatvoriti_bez_nalaza: data.smije_zatvoriti_bez_nalaza,
      },
    }
  },
)
