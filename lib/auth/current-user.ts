import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { Uloga } from "@/lib/auth/roles"

export type TrenutniKorisnik = { id: string; ime: string; uloga: Uloga }

/** Vraća profil prijavljenog korisnika ili null. Jedan DB round-trip. */
export async function getTrenutniKorisnik(): Promise<TrenutniKorisnik | null> {
  const supabase = await createServerSupabaseClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null
  const { data } = await supabase
    .from("korisnici")
    .select("id, ime, uloga")
    .eq("id", auth.user.id)
    .maybeSingle()
  if (!data) return null
  return { id: data.id, ime: data.ime, uloga: data.uloga as Uloga }
}
