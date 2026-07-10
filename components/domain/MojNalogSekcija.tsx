import { getTranslations } from "next-intl/server"
import { CollapsibleSection } from "./CollapsibleSection"
import { MojNalogForm } from "./MojNalogForm"

export async function MojNalogSekcija() {
  const t = await getTranslations("postavke.mojNalog")
  return (
    <CollapsibleSection title={t("naslov")} description={t("opis")}>
      <MojNalogForm />
    </CollapsibleSection>
  )
}
