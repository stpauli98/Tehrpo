import { getTranslations } from "next-intl/server"
import { dohvatiPoslateMejlove } from "@/lib/queries/poslati-mejlovi"
import { PoslatiMejloviTabela, TIP_KEY, STATUS_KEY } from "@/components/domain/PoslatiMejloviTabela"
import { Constants, type Database } from "@/db/types"

type MejlTip = Database["public"]["Enums"]["mejl_tip"]
type MejlStatus = Database["public"]["Enums"]["mejl_status"]

const SVI_TIPOVI = Constants.public.Enums.mejl_tip
const SVI_STATUSI = Constants.public.Enums.mejl_status

function jeMejlTip(v: string | undefined): v is MejlTip {
  return !!v && (SVI_TIPOVI as readonly string[]).includes(v)
}

function jeMejlStatus(v: string | undefined): v is MejlStatus {
  return !!v && (SVI_STATUSI as readonly string[]).includes(v)
}

export default async function PoslatiMejloviPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const t = await getTranslations("poslatiMejlovi")

  const tip = jeMejlTip(sp.tip) ? sp.tip : null
  const status = jeMejlStatus(sp.status) ? sp.status : null

  const { redovi, ukupno } = await dohvatiPoslateMejlove({
    tip,
    status,
    od: sp.od || null,
    do: sp.do || null,
    samoGreske: sp.samo_greske === "1",
    samoNepregledane: sp.nepregledano === "1",
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t("naslov")}</h1>
        <p className="text-sm text-muted-foreground">{t("opis")}</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("filteri.tip")}
          <select
            name="tip"
            defaultValue={tip ?? ""}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="">{t("filteri.svi")}</option>
            {SVI_TIPOVI.map((v) => (
              <option key={v} value={v}>
                {t(`tip.${TIP_KEY[v]}` as never)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("filteri.status")}
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="">{t("filteri.svi")}</option>
            {SVI_STATUSI.map((v) => (
              <option key={v} value={v}>
                {t(`status.${STATUS_KEY[v]}` as never)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("filteri.od")}
          <input
            type="date"
            name="od"
            defaultValue={sp.od ?? ""}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("filteri.do")}
          <input
            type="date"
            name="do"
            defaultValue={sp.do ?? ""}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="samo_greske" value="1" defaultChecked={sp.samo_greske === "1"} />
          {t("filteri.samoGreske")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="nepregledano" value="1" defaultChecked={sp.nepregledano === "1"} />
          {t("filteri.samoNerijesene")}
        </label>
        <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          {t("filteri.svi")}
        </button>
      </form>
      <PoslatiMejloviTabela redovi={redovi} />
      <p className="text-sm text-muted-foreground">{ukupno}</p>
    </div>
  )
}
