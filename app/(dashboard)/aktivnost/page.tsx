import Link from "next/link"
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
  const kljucFiltera = `${jedan(sp.akcija) ?? ""}|${jedan(sp.q) ?? ""}|${od ?? ""}|${doDatum ?? ""}`

  function stranaHref(n: number) {
    const p = new URLSearchParams()
    const a = jedan(sp.akcija); if (a) p.set("akcija", a)
    const q = jedan(sp.q); if (q) p.set("q", q)
    if (od) p.set("od", od)
    if (doDatum) p.set("do", doDatum)
    if (n > 1) p.set("strana", String(n))
    const qs = p.toString()
    return qs ? `?${qs}` : "?"
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("naslov")}</h1>
        <p className="text-sm text-muted-foreground">{t("opis")}</p>
      </div>
      <AktivnostFilteri key={kljucFiltera} />
      <AktivnostTabela redovi={redovi} />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{ukupno}</span>
        <div className="flex items-center gap-3">
          {strana > 1
            ? <Link href={stranaHref(strana - 1)} className="rounded-md border border-input px-3 py-1 hover:bg-muted">‹</Link>
            : <span className="rounded-md border border-input px-3 py-1 opacity-40" aria-disabled="true">‹</span>}
          <span>{strana} / {straneUkupno}</span>
          {strana < straneUkupno
            ? <Link href={stranaHref(strana + 1)} className="rounded-md border border-input px-3 py-1 hover:bg-muted">›</Link>
            : <span className="rounded-md border border-input px-3 py-1 opacity-40" aria-disabled="true">›</span>}
        </div>
      </div>
    </div>
  )
}
