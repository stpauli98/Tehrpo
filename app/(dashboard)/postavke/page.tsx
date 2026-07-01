import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { getCachedVrste } from "@/lib/cache"
import { ReminderForm } from "@/components/domain/ReminderForm"
import { NovaVrstaButton } from "@/components/domain/NovaVrstaButton"
import { VrstePregledaTabela } from "@/components/domain/VrstePregledaTabela"
import { KorisniciTab } from "@/components/domain/KorisniciTab"
import { CollapsibleSection } from "@/components/domain/CollapsibleSection"

export default async function PostavkePage() {
  const korisnik = await getTrenutniKorisnik()
  const jeAdminKor = korisnik?.uloga === "admin"
  const supabase = await createServerSupabaseClient()
  const [postRes, vrsteData] = await Promise.all([
    supabase.from("postavke").select("dana_prije").eq("id", 1).maybeSingle(),
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
      <h1 className="text-2xl font-semibold">Postavke</h1>

      {jeAdminKor && (
        <CollapsibleSection
          title="Email podsjetnici"
          description="Koliko dana prije roka dospijeća se šalje podsjetnik. Sistem dnevno provjerava termine."
        >
          <ReminderForm danaPrije={danaPrije} />
        </CollapsibleSection>
      )}

      {jeAdminKor && (
        <CollapsibleSection
          title="Vrste pregleda"
          description="Usluge koje sistem prati i automatski zakazuje. Interval (mjeseci) određuje kada se po izvršenju zakazuje sljedeći termin. Prazno = bez auto-zakazivanja."
          action={<NovaVrstaButton />}
        >
          <VrstePregledaTabela vrste={vrste} />
        </CollapsibleSection>
      )}

      {jeAdminKor && <KorisniciTab />}
    </div>
  )
}
