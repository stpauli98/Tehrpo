import Link from "next/link"
import { MapPin } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { ObilasciToolbar } from "@/components/domain/ObilasciToolbar"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"
import { Pagination } from "@/components/domain/Pagination"
import {
  AKTIVNI_NOT_IN,
  groupByGrad,
  parsirajObilasciParams,
  type ObilazakItem,
} from "@/lib/obilasci"
import { dohvatiGradoveLokacija } from "@/lib/queries/gradovi"
import { dohvatiGodineTermina } from "@/lib/queries/godine"
import { periodRange, formatDatum } from "@/lib/date"
import { href } from "@/i18n/routes"
import { FOCUS_RING } from "@/lib/utils"

// Kanon paginacije: PER_PAGE konstanta + offset + totalPages (poslati-mejlovi/page.tsx,
// klijenti/page.tsx). Odstupanje od PM kanona (50): kartice obilazaka su kompaktne i
// idu u grid od 2 kolone, pa 100 po strani drži ekran upotrebljivim bez suvišnih skokova.
const PER_PAGE = 100

export default async function ObilasciPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations("obilasci")
  const tPag = await getTranslations("common.pagination")
  const sp = await searchParams
  const { period, godina, mjesec, kvartal, status, grad, strana } = parsirajObilasciParams(sp)

  const { od, do: doIso } = periodRange(period, godina, mjesec, kvartal)
  const offset = (strana - 1) * PER_PAGE

  const supabase = await createServerSupabaseClient()

  let q = supabase
    .from("termini_view")
    .select(
      "id, klijent_id, klijent_naziv, vrsta_naziv, lokacija_naziv, lokacija_grad, rok_dospijeca, status_izvedeni, status, datum_zakazan",
      { count: "exact" },
    )
    .gte("rok_dospijeca", od)
    .lte("rok_dospijeca", doIso)
  if (status === "aktivni") q = q.not("status_izvedeni", "in", AKTIVNI_NOT_IN)
  else if (status !== "svi") q = q.eq("status_izvedeni", status)
  if (grad === "__bez__") q = q.is("lokacija_grad", null)
  else if (grad && grad !== "svi") q = q.eq("lokacija_grad", grad)

  const [gradovi, godine, terminiRes] = await Promise.all([
    // `dohvatiGradoveLokacija` BACA na grešku (S1 ugovor helpera) — hvatamo je ovdje da
    // bi se razlikovala od „nijedna lokacija nema grad" i prikazala kao greška.
    // Izvor su STVARNE lokacije klijenata (yoink 2026-07-29), ne katalog `gradovi`.
    dohvatiGradoveLokacija().catch(() => null),
    // `dohvatiGodineTermina` interno pada na fallback (tekuća ± 1) i nikad ne baca,
    // pa nije dio error-grane.
    dohvatiGodineTermina(),
    q
      .order("lokacija_grad", { ascending: true })
      .order("rok_dospijeca", { ascending: true })
      .range(offset, offset + PER_PAGE - 1),
  ])

  const greska = gradovi === null || terminiRes.error !== null
  // Grupisanje po gradu radi se NAD STRANOM — grupa smije biti presječena granicom
  // strane (npr. Banja Luka se nastavlja na sljedećoj strani). Prihvaćeno: alternativa
  // je učitavanje cijelog perioda, što je upravo problem koji paginacija rješava.
  const grupe = greska ? [] : groupByGrad((terminiRes.data ?? []) as ObilazakItem[])
  const ukupno = terminiRes.count ?? 0
  const totalPages = Math.max(1, Math.ceil(ukupno / PER_PAGE))

  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : []))
  ).toString()
  const pageHref = (p: number) => {
    const params = new URLSearchParams(currentSearch)
    params.set("strana", String(p))
    return href(`/obilasci?${params.toString()}`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("naslov")}</h1>
        <p className="text-sm text-muted-foreground">{t("podnaslov")}</p>
      </div>

      {/* Toolbar ostaje i u grešci: promjena filtera je novi pokušaj čitanja. */}
      <ObilasciToolbar
        period={period}
        godina={godina}
        mjesec={mjesec}
        kvartal={kvartal}
        gradovi={gradovi ?? []}
        godine={godine}
      />

      {greska ? (
        // Server komponenta nema refetch → bez `onRetry`; „Pokušaj ponovo" za
        // neuhvaćene padove pokriva app/(dashboard)/error.tsx.
        <GreskaUcitavanja testId="obilasci-greska" />
      ) : grupe.length === 0 ? (
        <div
          data-testid="obilasci-empty"
          className="rounded-xl bg-card p-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10"
        >
          {t("prazno")}
        </div>
      ) : (
        grupe.map((g) => (
          <section key={g.grad} data-testid="obilasci-grupa" className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
              <h2 className="font-semibold">
                {g.grad} <span className="text-muted-foreground font-normal">({g.items.length})</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {g.items.map((termin) => (
                <Link
                  key={termin.id}
                  href={href(`/plan-aktivnosti?view=lista&klijent_id=${termin.klijent_id}&mjesec=svi`)}
                  data-testid="obilasci-card"
                  className={`flex items-center justify-between rounded-lg ring-1 ring-foreground/10 px-3 py-2 transition-colors hover:bg-muted ${FOCUS_RING}`}
                >
                  <span>
                    <span className="font-medium">{termin.klijent_naziv}</span>
                    <span className="block text-xs text-muted-foreground">
                      {termin.vrsta_naziv}{termin.lokacija_naziv ? ` · ${termin.lokacija_naziv}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    {formatDatum(termin.rok_dospijeca)}
                    <StatusBadge
                      status={termin.status_izvedeni}
                      stvarniStatus={termin.status}
                      datumZakazan={termin.datum_zakazan}
                    />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}

      {!greska && totalPages > 1 && (
        <div
          className="flex items-center justify-end border-t border-border pt-4 text-sm text-muted-foreground"
          data-testid="obilasci-pagination"
        >
          <Pagination
            pageNum={strana}
            totalPages={totalPages}
            hrefFor={pageHref}
            pageTestId="obilasci-page"
            prethodnaLabel={tPag("prethodna")}
            sljedecaLabel={tPag("sljedeca")}
            stranaText={tPag("strana", { pageNum: strana, totalPages })}
          />
        </div>
      )}
    </div>
  )
}
