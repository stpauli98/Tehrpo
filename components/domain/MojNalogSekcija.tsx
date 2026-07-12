import { getTranslations } from "next-intl/server"
import { UserRound } from "lucide-react"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { CollapsibleSection } from "./CollapsibleSection"
import { MojNalogForm } from "./MojNalogForm"

export async function MojNalogSekcija() {
  const t = await getTranslations("postavke.mojNalog")
  // getTrenutniKorisnik je React-cache-ovan (već pozvan u page.tsx) → bez dodatnog upita.
  const korisnik = await getTrenutniKorisnik()
  return (
    <CollapsibleSection
      title={t("naslov")}
      description={t("opis")}
      icon={<UserRound className="h-[18px] w-[18px]" />}
    >
      <MojNalogForm ime={korisnik?.ime} />
    </CollapsibleSection>
  )
}
