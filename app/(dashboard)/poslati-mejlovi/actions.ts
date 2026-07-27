"use server"

import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { AkcijaRezultat } from "@/lib/akcija-toast"

/**
 * Označava mejl kao pregledan (čisti crveni bedž u navigaciji).
 *
 * Imperativna varijanta akcije (ne `(_prev, formData)`) — nema polja, poziva se
 * direktno iz `OznaciPregledanimButton`, a poruku uspjeha daje pozivalac kroz
 * `toastRezultat` (S2: `message` postoji samo na `ok:false`).
 *
 * POZNATO OGRANIČENJE (odluka O4, bez migracije): RPC `oznaci_mejl_pregledan`
 * tiho preskoči red kad pozivalac nema prava (`20260713120000_mejl_log.sql:134-136`)
 * i vrati uspjeh bez `error` — app strana taj slučaj ne može razlikovati od pravog
 * uspjeha. UI gate u `OznaciPregledanimButton` (uloga + `klijent_id`) čini ga
 * nedostižnim kroz UI; pooštravanje RPC-a je zaseban lockstep DB PR.
 */
export async function oznaciPregledanim(id: string): Promise<AkcijaRezultat> {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc("oznaci_mejl_pregledan", { p_id: id })
  if (error) {
    const t = await getTranslations("poslatiMejlovi")
    return { ok: false, message: t("greskaOznacavanja") }
  }
  revalidatePath("/poslati-mejlovi")
  revalidatePath("/", "layout") // osvježi nav bedž
  return { ok: true }
}
