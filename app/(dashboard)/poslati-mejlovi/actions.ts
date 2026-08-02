"use server"

import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { mozeUrediti } from "@/lib/auth/roles"
import type { AkcijaRezultat } from "@/lib/akcija-toast"

/**
 * Označava mejl kao pregledan (čisti crveni bedž u navigaciji).
 *
 * Imperativna varijanta akcije (ne `(_prev, formData)`) — nema polja, poziva se
 * direktno iz `OznaciPregledanimButton`, a poruku uspjeha daje pozivalac kroz
 * `toastRezultat` (S2: `message` postoji samo na `ok:false`).
 *
 * Uloga se provjerava NA SERVERU (02.08.2026.): `OznaciPregledanimButton` sakriva dugme
 * ulozi `pregled`, ali server akcija je javni endpoint — sakriveno dugme nije ovlaštenje.
 * Do ove izmjene je `pregled` mogao direktnim pozivom pisati u `mejl_log`
 * (`pregledano_at`/`pregledano_od`), jer je RPC `oznaci_mejl_pregledan` SECURITY DEFINER
 * i traži samo `je_admin() or ima_pristup_klijentu(...)` — ni jedno ni drugo ne isključuje
 * read-only ulogu. Migracija `20260802134500_oznaci_mejl_pregledan_bez_pregleda.sql` istu ogradu
 * postavlja i u bazi (RPC je `not je_pregled()` gate), pa app-strana nije jedina brana.
 *
 * POZNATO OGRANIČENJE (odluka O4, nepromijenjeno): RPC tiho preskoči red kad pozivalac
 * nema pristup KLIJENTU i vrati uspjeh bez `error` — app strana taj slučaj ne može
 * razlikovati od pravog uspjeha.
 */
export async function oznaciPregledanim(id: string): Promise<AkcijaRezultat> {
  const ja = await getTrenutniKorisnik()
  if (!ja || !mozeUrediti(ja.uloga)) {
    const t = await getTranslations("poslatiMejlovi")
    return { ok: false, message: t("oznacavanjeNijeDozvoljeno") }
  }

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
