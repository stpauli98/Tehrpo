import { getTranslations } from "next-intl/server"
import { BellRing, ClipboardList } from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { getCachedVrste } from "@/lib/cache"
import { ReminderForm } from "@/components/domain/ReminderForm"
import { PodsjetniciKontrole } from "@/components/domain/PodsjetniciKontrole"
import { VrijemeSlanjaForm } from "@/components/domain/VrijemeSlanjaForm"
import { SaljiKlijentimaToggle } from "@/components/domain/SaljiKlijentimaToggle"
import { ZakazanoObavijestToggle } from "@/components/domain/ZakazanoObavijestToggle"
import { NovaVrstaButton } from "@/components/domain/NovaVrstaButton"
import { VrstePregledaTabela } from "@/components/domain/VrstePregledaTabela"
import { KorisniciTab } from "@/components/domain/KorisniciTab"
import { KoStaPrimaTab } from "@/components/domain/KoStaPrimaTab"
import { CollapsibleSection } from "@/components/domain/CollapsibleSection"
import { MojNalogSekcija } from "@/components/domain/MojNalogSekcija"

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

      <MojNalogSekcija />

      {jeAdminKor && (
        <CollapsibleSection
          title={t("reminders.naslov")}
          description={t("reminders.opis")}
          icon={<BellRing className="h-[18px] w-[18px]" />}
        >
          <div className="space-y-8">
            {/* Grupa 1 — kada i kako se šalje (interni raspored). */}
            <div className="space-y-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("reminders.grupaRaspored")}
              </p>
              <ReminderForm danaPrije={danaPrije} />
              <VrijemeSlanjaForm vrijemeSat={postRes.data?.vrijeme_slanja_sat ?? 8} />
              <PodsjetniciKontrole aktivni={postRes.data?.podsjetnici_aktivni ?? true} />
            </div>
            {/* Grupa 2 — mejlovi koji izlaze van firme + automatske obavijesti. */}
            <div className="space-y-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("reminders.grupaPrimaoci")}
              </p>
              <div className="divide-y divide-border overflow-hidden rounded-xl ring-1 ring-foreground/10">
                <div className="p-4">
                  <SaljiKlijentimaToggle salji={postRes.data?.salji_klijentima ?? false} />
                </div>
                <div className="p-4">
                  <ZakazanoObavijestToggle aktivna={postRes.data?.zakazano_obavijest_aktivna ?? true} />
                </div>
              </div>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {jeAdminKor && (
        <CollapsibleSection
          title={t("vrste.naslov")}
          description={t("vrste.opis")}
          icon={<ClipboardList className="h-[18px] w-[18px]" />}
          action={<NovaVrstaButton />}
        >
          <VrstePregledaTabela vrste={vrste} />
        </CollapsibleSection>
      )}

      {jeAdminKor && <KorisniciTab />}

      {jeAdminKor && <KoStaPrimaTab />}
    </div>
  )
}
