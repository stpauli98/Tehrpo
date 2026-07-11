import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { dohvatiAktivnost } from "@/lib/queries/aktivnost"
import { AktivnostFilteri } from "@/components/domain/AktivnostFilteri"
import { AktivnostTabela } from "@/components/domain/AktivnostTabela"

const PO_STRANI = 50

export default async function AktivnostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const korisnik = await getTrenutniKorisnik()
  if (korisnik?.uloga !== "admin") notFound()

  const t = await getTranslations("aktivnost")
  const sp = await searchParams
  const jedan = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const strana = Math.max(1, Number(jedan(sp.strana) ?? "1") || 1)
  const od = jedan(sp.od)
  const doDatum = jedan(sp.do)

  const { redovi, ukupno } = await dohvatiAktivnost({
    akcija: jedan(sp.akcija),
    pretraga: jedan(sp.q),
    od: od ? `${od}T00:00:00` : undefined,
    do: doDatum ? `${doDatum}T23:59:59` : undefined,
    limit: PO_STRANI,
    offset: (strana - 1) * PO_STRANI,
  })

  const straneUkupno = Math.max(1, Math.ceil(ukupno / PO_STRANI))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("naslov")}</h1>
        <p className="text-sm text-muted-foreground">{t("opis")}</p>
      </div>
      <AktivnostFilteri />
      <AktivnostTabela redovi={redovi} />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{ukupno}</span>
        <span>{strana} / {straneUkupno}</span>
      </div>
    </div>
  )
}
