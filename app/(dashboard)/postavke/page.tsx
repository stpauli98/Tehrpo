import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { getCachedVrste } from "@/lib/cache"
import { ReminderForm } from "@/components/domain/ReminderForm"
import { PodsjetniciKontrole } from "@/components/domain/PodsjetniciKontrole"
import { VrijemeSlanjaForm } from "@/components/domain/VrijemeSlanjaForm"
import { SaljiKlijentimaToggle } from "@/components/domain/SaljiKlijentimaToggle"
import { NovaVrstaButton } from "@/components/domain/NovaVrstaButton"
import { VrstePregledaTabela } from "@/components/domain/VrstePregledaTabela"
import { KorisniciTab } from "@/components/domain/KorisniciTab"
import { CollapsibleSection } from "@/components/domain/CollapsibleSection"

export default async function PostavkePage() {
  const t = await getTranslations("postavke")
  const korisnik = await getTrenutniKorisnik()
  const jeAdminKor = korisnik?.uloga === "admin"
  const supabase = await createServerSupabaseClient()
  const [postRes, vrsteData] = await Promise.all([
    // select("*") umjesto eksplicitnih kolona: tolerantno na fazu prije cloud migracije
    // koja dodaje podsjetnici_aktivni — eksplicitan select bi cijeli upit oborio i
    // povukao za sobom postojeći dana_prije ako ta kolona (još) ne postoji na cloud DEMO.
    supabase.from("postavke").select("*").eq("id", 1).maybeSingle(),
    getCachedVrste(),
  ])
  const danaPrije = postRes.data?.dana_prije ?? [30, 14, 7, 1]
  const vrste = (vrsteData ?? []).map((v) => ({
    id: v.id,
    naziv: v.naziv,
    interval: v.podrazumevani_interval_mjeseci,
    zakonski_osnov: v.zakonski_osnov,
    aktivna: v.aktivna,
    vodi_dokumentaciju: v.vodi_dokumentaciju,
  }))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("naslov")}</h1>

      {jeAdminKor && (
        <CollapsibleSection
          title={t("reminders.naslov")}
          description={t("reminders.opis")}
        >
          <div className="space-y-6">
            <ReminderForm danaPrije={danaPrije} />
            <PodsjetniciKontrole aktivni={postRes.data?.podsjetnici_aktivni ?? true} />
            <VrijemeSlanjaForm vrijemeSat={postRes.data?.vrijeme_slanja_sat ?? 8} />
            <SaljiKlijentimaToggle salji={postRes.data?.salji_klijentima ?? false} />
          </div>
        </CollapsibleSection>
      )}

      {jeAdminKor && (
        <CollapsibleSection
          title={t("vrste.naslov")}
          description={t("vrste.opis")}
          action={<NovaVrstaButton />}
        >
          <VrstePregledaTabela vrste={vrste} />
        </CollapsibleSection>
      )}

      {jeAdminKor && <KorisniciTab />}
    </div>
  )
}
