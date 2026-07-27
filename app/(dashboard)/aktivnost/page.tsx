import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { dohvatiAktivnost } from "@/lib/queries/aktivnost"
import { dodajDan, utcGranicaSarajevskogDana } from "@/lib/date"
import { AktivnostFilteri } from "@/components/domain/AktivnostFilteri"
import { AktivnostSearch } from "@/components/domain/AktivnostSearch"
import { AktivnostTabela } from "@/components/domain/AktivnostTabela"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"
import { Pagination } from "@/components/domain/Pagination"

const PO_STRANI = 50

export default async function AktivnostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const korisnik = await getTrenutniKorisnik()
  if (korisnik?.uloga !== "admin") notFound()

  const t = await getTranslations("aktivnost")
  const tPag = await getTranslations("common.pagination")
  const sp = await searchParams
  const jedan = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const strana = Math.max(1, Number(jedan(sp.strana) ?? "1") || 1)
  // Sanitacija prije `utcGranicaSarajevskogDana` (S1): helper na neispravnom
  // datumu baca RangeError, pa bi ručno pokvaren URL (?od=xyz) srušio stranicu
  // umjesto da padne na čitljivu granu greške. Neispravan datum = filter se ignoriše.
  const isoDatum = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const od = isoDatum(jedan(sp.od))
  const doDatum = isoDatum(jedan(sp.do))

  // S7: granice sarajevskog dana kao UTC instanti; `do` je ekskluzivni sljedeći dan
  // (RPC poredi `vrijeme >= p_od AND vrijeme < p_do`), pa zadnja sekunda dana ne ispada.
  const rezultat = await dohvatiAktivnost({
    akcija: jedan(sp.akcija),
    pretraga: jedan(sp.q),
    od: od ? utcGranicaSarajevskogDana(od) : undefined,
    do: doDatum ? utcGranicaSarajevskogDana(dodajDan(doDatum)) : undefined,
    limit: PO_STRANI,
    offset: (strana - 1) * PO_STRANI,
  })

  const ukupno = rezultat.ok ? rezultat.ukupno : 0
  const straneUkupno = Math.max(1, Math.ceil(ukupno / PO_STRANI))
  const kljucFiltera = `${jedan(sp.akcija) ?? ""}|${od ?? ""}|${doDatum ?? ""}`

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
      <div className="flex flex-wrap items-end gap-3">
        <AktivnostSearch />
        <AktivnostFilteri key={kljucFiltera} />
      </div>
      {/* S1: greška čitanja NIJE prazan rezultat — tabela i paginacija se ne renderuju,
          ali naslov i filteri ostaju (promjena filtera = novi pokušaj). */}
      {rezultat.ok ? (
        <>
          <AktivnostTabela redovi={rezultat.redovi} />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span data-testid="aktivnost-total">{t("ukupno", { count: ukupno })}</span>
            <Pagination
              pageNum={strana}
              totalPages={straneUkupno}
              hrefFor={stranaHref}
              pageTestId="aktivnost-page"
              prethodnaLabel={tPag("prethodna")}
              sljedecaLabel={tPag("sljedeca")}
              stranaText={tPag("strana", { pageNum: strana, totalPages: straneUkupno })}
            />
          </div>
        </>
      ) : (
        <GreskaUcitavanja />
      )}
    </div>
  )
}
