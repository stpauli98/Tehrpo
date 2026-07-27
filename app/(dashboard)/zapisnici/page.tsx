import Link from "next/link"
import { X } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { IKONA_INLINE_KLASA, Tooltip } from "@/components/ui/ikona-tooltip"
import { downloadDokument } from "@/lib/supabase/storage"
import { DocxPreview } from "@/components/domain/DocxPreview"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"
import { ZapisniciTabela } from "@/components/domain/ZapisniciTabela"
import { href } from "@/i18n/routes"
import mammoth from "mammoth"

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
  const sp = await searchParams
  const previewId = typeof sp.preview === "string" ? sp.preview : null

  const supabase = await createServerSupabaseClient()
  const { data: dokData, error: dokError } = await supabase
    .from("dokumenti")
    .select("id, naziv, storage_path, uploaded_at, termin_id")
    .eq("generated_by_ai", true)
    .order("uploaded_at", { ascending: false })
  const dokRedovi = dokData ?? []

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

  const zatvoriPregled = (
    <Link href={href("/zapisnici")} className={IKONA_INLINE_KLASA} data-testid="zapisnici-zatvori" aria-label={t("zatvoriPregled")}>
      <X className="h-4 w-4" aria-hidden />
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
          {dokumenti.length === 0 ? (
            <div data-testid="zapisnici-prazno" className="rounded-xl bg-card p-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
              {t("prazno")}
            </div>
          ) : (
            <ZapisniciTabela
              dokumenti={dokumenti.map((d) => ({
                id: d.id,
                klijent_naziv: d.klijent_naziv,
                vrsta_naziv: d.vrsta_naziv,
                uploaded_at: d.uploaded_at,
              }))}
            />
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
