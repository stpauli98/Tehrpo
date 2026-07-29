import Link from "next/link"
import { redirect } from "next/navigation"
import { X } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { IKONA_INLINE_KLASA, Tooltip } from "@/components/ui/ikona-tooltip"
import { downloadDokument } from "@/lib/supabase/storage"
import { DocxPreview } from "@/components/domain/DocxPreview"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"
import { Pagination } from "@/components/domain/Pagination"
import { ZapisniciTabela } from "@/components/domain/ZapisniciTabela"
import { href } from "@/i18n/routes"
import mammoth from "mammoth"

// Isti page-size obrazac kao poslati-mejlovi/page.tsx (PER_PAGE + offset/range).
const PER_PAGE = 50

// Ishodi preview bloka — pad Storage-a/konverzije i nepostojeći dokument se
// razlikuju od uspjeha (S1: „prazno" nije isto što i „palo").
type PreviewStanje =
  | { vrsta: "uspjeh"; html: string; naziv: string }
  | { vrsta: "nedostupan" }
  | { vrsta: "greska" }

export default async function ZapisniciPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations("zapisnici")
  const tPag = await getTranslations("common.pagination")

  // Zapisnici su admin-only (yoink zahtjev 2026-07-29): tab je ne-adminima sakriven
  // (Sidebar), a ovdje se zatvara i direktan URL pristup — isti obrazac kao /asistent.
  const korisnik = await getTrenutniKorisnik()
  if (korisnik?.uloga !== "admin") redirect(href("/pregled"))

  const sp = await searchParams
  const previewId = typeof sp.preview === "string" ? sp.preview : null
  const trazenaStrana = Math.max(1, Number(typeof sp.strana === "string" ? sp.strana : "1") || 1)

  const supabase = await createServerSupabaseClient()
  const ucitajStranu = (strana: number) => {
    const offset = (strana - 1) * PER_PAGE
    return supabase
      .from("dokumenti")
      .select("id, naziv, storage_path, uploaded_at, termin_id", { count: "exact" })
      .eq("generated_by_ai", true)
      .order("uploaded_at", { ascending: false })
      .range(offset, offset + PER_PAGE - 1)
  }

  let pageNum = trazenaStrana
  let dokUpit = await ucitajStranu(pageNum)
  // PostgREST vraća PGRST103 (416) kad `range` počinje iza kraja liste
  // (`?strana=999`, ili strana koja se ispraznila brisanjem). To je nepostojeća
  // strana, a ne pad čitanja — S1 traži razlikovanje u oba smjera, pa se
  // zahtjev svodi na zadnju postojeću stranu umjesto na poruku o grešci.
  if (dokUpit.error?.code === "PGRST103") {
    const { count: ukupnoRedova } = await supabase
      .from("dokumenti")
      .select("id", { count: "exact", head: true })
      .eq("generated_by_ai", true)
    pageNum = Math.max(1, Math.ceil((ukupnoRedova ?? 0) / PER_PAGE))
    dokUpit = await ucitajStranu(pageNum)
  }
  const { data: dokData, error: dokError, count } = dokUpit
  const dokRedovi = dokData ?? []
  const ukupno = count ?? 0
  const totalPages = Math.max(1, Math.ceil(ukupno / PER_PAGE))

  // termini_view je VIEW → nema embed relacija u supabase-js; dohvat zasebnim upitom + mapa.
  // termin_id je nullable → null-ovi se filtriraju da `.in("id", [null])` nikad ne nastane.
  const terminIds = [...new Set(dokRedovi.map((d) => d.termin_id))].filter(
    (id): id is string => id !== null,
  )
  const { data: terminiData, error: terminiError } = terminIds.length
    ? await supabase.from("termini_view").select("id, klijent_naziv, vrsta_naziv").in("id", terminIds)
    : { data: [], error: null }
  const terminMap = new Map((terminiData ?? []).map((term) => [term.id, term]))

  const greskaCitanja = Boolean(dokError) || Boolean(terminiError)

  const dokumenti = dokRedovi.map((d) => ({
    ...d,
    klijent_naziv: terminMap.get(d.termin_id)?.klijent_naziv ?? null,
    vrsta_naziv: terminMap.get(d.termin_id)?.vrsta_naziv ?? null,
  }))

  // Preview: skini izabrani .docx i konvertuj u HTML (server-side).
  let preview: PreviewStanje | null = null
  if (previewId && !greskaCitanja) {
    const { data: dok, error: previewError } = await supabase
      .from("dokumenti")
      .select("storage_path, naziv")
      .eq("id", previewId)
      .eq("generated_by_ai", true)
      .maybeSingle()
    if (previewError) {
      preview = { vrsta: "greska" }
    } else if (!dok) {
      // Obrisan dokument ili nevidljiv pod RLS-om — ranije tihi no-op (N16 simptom).
      preview = { vrsta: "nedostupan" }
    } else {
      try {
        const buffer = await downloadDokument(dok.storage_path)
        const result = await mammoth.convertToHtml({ buffer })
        preview = { vrsta: "uspjeh", html: result.value, naziv: dok.naziv }
      } catch {
        preview = { vrsta: "greska" }
      }
    }
  }

  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v] as [string, string]] : [],
    ),
  ).toString()
  const pageHref = (p: number) => {
    const params = new URLSearchParams(currentSearch)
    params.set("strana", String(p))
    return href(`/zapisnici?${params.toString()}`)
  }

  const zatvoriPregled = (
    <Link href={href("/zapisnici")} className={IKONA_INLINE_KLASA} data-testid="zapisnici-zatvori" aria-label={t("zatvoriPregled")}>
      <X className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <Tooltip>{t("zatvoriPregled")}</Tooltip>
    </Link>
  )

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("naslov")}</h1>

      {greskaCitanja ? (
        <GreskaUcitavanja testId="zapisnici-greska" />
      ) : (
        <>
          {ukupno === 0 ? (
            <div data-testid="zapisnici-prazno" className="rounded-xl bg-card p-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
              {t("prazno")}
            </div>
          ) : (
            <>
              <ZapisniciTabela
                ukupno={ukupno}
                dokumenti={dokumenti.map((d) => ({
                  id: d.id,
                  naziv: d.naziv,
                  klijent_naziv: d.klijent_naziv,
                  vrsta_naziv: d.vrsta_naziv,
                  uploaded_at: d.uploaded_at,
                }))}
              />
              {totalPages > 1 && (
                <div className="flex items-center justify-end pt-1" data-testid="zapisnici-pagination">
                  <Pagination
                    pageNum={pageNum}
                    totalPages={totalPages}
                    hrefFor={pageHref}
                    pageTestId="zapisnici-page"
                    prethodnaLabel={tPag("prethodna")}
                    sljedecaLabel={tPag("sljedeca")}
                    stranaText={tPag("strana", { pageNum, totalPages })}
                  />
                </div>
              )}
            </>
          )}

          {preview?.vrsta === "uspjeh" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium">{preview.naziv}</h2>
                {zatvoriPregled}
              </div>
              <DocxPreview html={preview.html} />
            </div>
          )}

          {(preview?.vrsta === "nedostupan" || preview?.vrsta === "greska") && (
            <div
              data-testid="zapisnici-preview-greska"
              className="flex items-center justify-between gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
            >
              <p className="text-sm text-muted-foreground">
                {preview.vrsta === "nedostupan" ? t("pregledNijeDostupan") : t("pregledGreska")}
              </p>
              {zatvoriPregled}
            </div>
          )}
        </>
      )}
    </div>
  )
}
