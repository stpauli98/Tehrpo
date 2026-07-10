import Link from "next/link"
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
  const [klRes, postRes, kontaktiRes, radniciRes, dodjeleRes] = await Promise.all([
    supabase.from("klijenti").select("salji_podsjetnik_klijentu, podsjetnik_emails").eq("id", klijentId).maybeSingle(),
    supabase.from("postavke").select("salji_klijentima").eq("id", 1).maybeSingle(),
    supabase.from("kontakt_osobe").select("id, ime, funkcija, email, podsjetnik_primalac").eq("klijent_id", klijentId).order("ime"),
    jeAdmin ? supabase.from("korisnici").select("id, ime").eq("aktivan", true).order("ime") : Promise.resolve({ data: [] }),
    jeAdmin ? supabase.from("korisnik_klijent").select("korisnik_id").eq("klijent_id", klijentId) : Promise.resolve({ data: [] }),
  ])
  const salji = klRes.data?.salji_podsjetnik_klijentu ?? false
  const adHocEmails = klRes.data?.podsjetnik_emails ?? []
  const saljiGlobalno = postRes.data?.salji_klijentima ?? false
  const kontakti = (kontaktiRes.data ?? []).map((k) => ({
    id: k.id, ime: k.ime, funkcija: k.funkcija, email: k.email, podsjetnik_primalac: k.podsjetnik_primalac,
  }))
  const radnici = (radniciRes.data ?? []).map((r) => ({ id: r.id, ime: r.ime }))
  const izabrani = (dodjeleRes.data ?? []).map((d: { korisnik_id: string }) => d.korisnik_id)

  return (
    <div className="space-y-8" data-testid="tab-podsjetnici-content">
      <section>
        <h2 className="mb-3 text-lg font-medium">{t("sekcijaSlanje")}</h2>
        {saljiGlobalno ? (
          <KlijentPodsjetniciForm klijentId={klijentId} salji={salji} kontakti={kontakti} adHocEmails={adHocEmails} />
        ) : (
          <p className="max-w-xl text-sm text-slate-500" data-testid="podsjetnici-global-off">
            {t("globalnoIskljuceno")}
            {jeAdmin && (
              <>
                {" "}
                <Link href="/postavke" className="font-medium text-brand hover:underline">
                  {t("otvoriPostavke")}
                </Link>
              </>
            )}
          </p>
        )}
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
