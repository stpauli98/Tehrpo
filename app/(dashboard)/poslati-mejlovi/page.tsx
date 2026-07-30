import { getTranslations } from "next-intl/server"
import { Info } from "lucide-react"
import { dohvatiPoslateMejlove } from "@/lib/queries/poslati-mejlovi"
import { PoslatiMejloviTabela } from "@/components/domain/PoslatiMejloviTabela"
import { PoslatiMejloviFilteri } from "@/components/domain/PoslatiMejloviFilteri"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"
import { Pagination } from "@/components/domain/Pagination"
import { href } from "@/i18n/routes"
import { dodajDan, utcGranicaDana } from "@/lib/date"
import { jeIsoDatum } from "@/lib/poslati-mejlovi"
import { Constants, type Database } from "@/db/types"
import { DEMO_MODE } from "@/lib/demo"

type MejlTip = Database["public"]["Enums"]["mejl_tip"]
type MejlStatus = Database["public"]["Enums"]["mejl_status"]

const SVI_TIPOVI = Constants.public.Enums.mejl_tip
const SVI_STATUSI = Constants.public.Enums.mejl_status

// Isti page-size obrazac kao klijenti/page.tsx (PER_PAGE konstanta + range),
// ovdje = RPC-ov postojeći podrazumijevani limit (p_limit ?? 50) da se prva
// strana ne promijeni kad je paginacija uvedena.
const PER_PAGE = 50

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
  const tPag = await getTranslations("common.pagination")

  const tip = jeMejlTip(sp.tip) ? sp.tip : null
  const status = jeMejlStatus(sp.status) ? sp.status : null
  const od = jeIsoDatum(sp.od) ? sp.od : null
  const do_ = jeIsoDatum(sp.do) ? sp.do : null
  const pageNum = Math.max(1, Number(typeof sp.page === "string" ? sp.page : "1") || 1)
  const offset = (pageNum - 1) * PER_PAGE

  const { redovi, ukupno, error } = await dohvatiPoslateMejlove({
    tip,
    status,
    // Granice dana u APP_TIME_ZONE (Europe/Belgrade) sa eksplicitnom zonom (S7):
    // `od` = ponoć izabranog dana, `do` = ponoć SLJEDEĆEG dana. RPC poredi
    // `created_at >= p_od AND < p_do`, pa ekskluzivna gornja granica obuhvata
    // cijeli izabrani dan (uklj. 23:59:59.999).
    od: od ? utcGranicaDana(od) : null,
    do: do_ ? utcGranicaDana(dodajDan(do_)) : null,
    samoGreske: sp.samo_greske === "1",
    samoNepregledane: sp.nepregledano === "1",
    limit: PER_PAGE,
    offset,
  })
  const totalPages = Math.max(1, Math.ceil(ukupno / PER_PAGE))

  // Razdvaja "dnevnik je prazan" od "filteri nemaju pogodaka" (S1-duh).
  // `pageNum > 1` pokriva i `?page=999` iznad zadnje strane (nema server-side clamp-a).
  const imaFiltera =
    Boolean(tip || status || od || do_ || sp.samo_greske === "1" || sp.nepregledano === "1") ||
    pageNum > 1

  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v] as [string, string]] : []
    )
  ).toString()
  const pageHref = (p: number) => {
    const params = new URLSearchParams(currentSearch)
    params.set("page", String(p))
    return href(`/poslati-mejlovi?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t("naslov")}</h1>
        <p className="text-sm text-muted-foreground">{t("opis")}</p>
      </div>
      {/* Bez ovoga korisnik DEMO-a redove tumači kao stvarna slanja — a ranije je
          vidio i sirovu Resend grešku koja liči na interni kvar softvera. */}
      {DEMO_MODE && (
        <div
          data-testid="demo-traka"
          role="status"
          className="flex items-start gap-2 rounded-xl bg-brand-light px-4 py-3 text-sm text-foreground ring-1 ring-brand/20"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
          <p>{t("demoTraka")}</p>
        </div>
      )}
      <PoslatiMejloviFilteri
        tip={tip}
        status={status}
        od={od ?? ""}
        do_={do_ ?? ""}
        samoGreske={sp.samo_greske === "1"}
        nepregledano={sp.nepregledano === "1"}
      />
      {error ? (
        // Upit je pao — nikad empty state (S1). Retry pokriva route error.tsx / reload.
        <GreskaUcitavanja />
      ) : (
        <>
          <PoslatiMejloviTabela redovi={redovi} imaFiltera={imaFiltera} />
          {totalPages > 1 && (
            <div className="flex items-center justify-end border-t border-border pt-4 text-sm text-muted-foreground" data-testid="poslati-mejlovi-pagination">
              <Pagination
                pageNum={pageNum}
                totalPages={totalPages}
                hrefFor={pageHref}
                pageTestId="poslati-mejlovi-page"
                prethodnaLabel={tPag("prethodna")}
                sljedecaLabel={tPag("sljedeca")}
                stranaText={tPag("strana", { pageNum, totalPages })}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
