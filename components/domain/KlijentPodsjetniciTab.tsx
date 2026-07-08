import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { KlijentPodsjetniciForm } from "./KlijentPodsjetniciForm"
import { DodjelaRadnikaFirmi } from "./DodjelaRadnikaFirmi"

export async function KlijentPodsjetniciTab({ klijentId }: { klijentId: string }) {
  const t = await getTranslations("klijenti.podsjetnici")
  const ja = await getTrenutniKorisnik()
  const jeAdmin = ja?.uloga === "admin"
  const supabase = await createServerSupabaseClient()
  const [klRes, radniciRes, dodjeleRes] = await Promise.all([
    supabase.from("klijenti").select("salji_podsjetnik_klijentu, podsjetnik_emails").eq("id", klijentId).maybeSingle(),
    jeAdmin ? supabase.from("korisnici").select("id, ime").eq("aktivan", true).order("ime") : Promise.resolve({ data: [] }),
    jeAdmin ? supabase.from("korisnik_klijent").select("korisnik_id").eq("klijent_id", klijentId) : Promise.resolve({ data: [] }),
  ])
  const salji = klRes.data?.salji_podsjetnik_klijentu ?? false
  const emails = klRes.data?.podsjetnik_emails ?? []
  const radnici = (radniciRes.data ?? []).map((r) => ({ id: r.id, ime: r.ime }))
  const izabrani = (dodjeleRes.data ?? []).map((d: { korisnik_id: string }) => d.korisnik_id)

  return (
    <div className="space-y-8" data-testid="tab-podsjetnici-content">
      <section>
        <h2 className="mb-3 text-lg font-medium">{t("sekcijaSlanje")}</h2>
        <KlijentPodsjetniciForm klijentId={klijentId} salji={salji} emails={emails} />
      </section>
      {jeAdmin && (
        <section>
          <h2 className="mb-3 text-lg font-medium">{t("sekcijaDodjela")}</h2>
          <DodjelaRadnikaFirmi klijentId={klijentId} radnici={radnici} izabrani={izabrani} />
        </section>
      )}
    </div>
  )
}
