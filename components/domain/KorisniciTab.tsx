import { getTranslations } from "next-intl/server"
import { Users } from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { NoviKorisnikButton } from "./NoviKorisnikButton"
import { KorisniciTabela } from "./KorisniciTabela"
import { CollapsibleSection } from "./CollapsibleSection"

export async function KorisniciTab() {
  const t = await getTranslations("postavke.korisnici")
  const supabase = await createServerSupabaseClient()
  const [ja, korisniciRes, klijentiRes, dodjeleRes] = await Promise.all([
    getTrenutniKorisnik(),
    supabase
      .from("korisnici")
      .select(
        "id, ime, email, uloga, aktivan, prima_podsjetnike, smije_brisati_svoje, smije_brisati_tudje, smije_brisati_klijente, smije_zatvoriti_bez_nalaza",
      )
      .order("ime"),
    supabase.from("klijenti").select("id, naziv").order("naziv"),
    supabase.from("korisnik_klijent").select("korisnik_id, klijent_id"),
  ])
  const dodjele = dodjeleRes.data ?? []
  const korisnici = (korisniciRes.data ?? []).map((k) => ({
    id: k.id,
    ime: k.ime,
    email: k.email ?? "",
    uloga: k.uloga,
    aktivan: k.aktivan,
    prima_podsjetnike: k.prima_podsjetnike,
    smije_brisati_svoje: k.smije_brisati_svoje,
    smije_brisati_tudje: k.smije_brisati_tudje,
    smije_brisati_klijente: k.smije_brisati_klijente,
    smije_zatvoriti_bez_nalaza: k.smije_zatvoriti_bez_nalaza,
    izabrani: dodjele.filter((d) => d.korisnik_id === k.id).map((d) => d.klijent_id),
  }))

  return (
    <CollapsibleSection
      title={t("naslov")}
      icon={<Users className="h-[18px] w-[18px]" />}
      action={<NoviKorisnikButton />}
    >
      <KorisniciTabela korisnici={korisnici} klijenti={klijentiRes.data ?? []} jaId={ja?.id} />
    </CollapsibleSection>
  )
}
