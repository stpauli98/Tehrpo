import Link from "next/link"
import { X } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { IKONA_INLINE_KLASA, Tooltip } from "@/components/ui/ikona-tooltip"
import { downloadDokument } from "@/lib/supabase/storage"
import { DocxPreview } from "@/components/domain/DocxPreview"
import { ZapisniciTabela } from "@/components/domain/ZapisniciTabela"
import mammoth from "mammoth"

export default async function PregledPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations("zapisnici")
  const sp = await searchParams
  const previewId = typeof sp.preview === "string" ? sp.preview : null

  const supabase = await createServerSupabaseClient()
  const { data: dokData } = await supabase
    .from("dokumenti")
    .select("id, naziv, storage_path, uploaded_at, termin_id")
    .eq("generated_by_ai", true)
    .order("uploaded_at", { ascending: false })
  const dokRedovi = dokData ?? []

  // termini_view je VIEW → nema embed relacija u supabase-js; dohvat zasebnim upitom + mapa.
  const terminIds = [...new Set(dokRedovi.map((d) => d.termin_id))]
  const { data: terminiData } = terminIds.length
    ? await supabase.from("termini_view").select("id, klijent_naziv, vrsta_naziv").in("id", terminIds)
    : { data: [] }
  const terminMap = new Map((terminiData ?? []).map((t) => [t.id, t]))

  const dokumenti = dokRedovi.map((d) => ({
    ...d,
    klijent_naziv: terminMap.get(d.termin_id)?.klijent_naziv ?? null,
    vrsta_naziv: terminMap.get(d.termin_id)?.vrsta_naziv ?? null,
  }))

  // Preview: skini izabrani .docx i konvertuj u HTML (server-side).
  let previewHtml: string | null = null
  let previewNaziv: string | null = null
  if (previewId) {
    const { data: dok } = await supabase
      .from("dokumenti")
      .select("storage_path, naziv")
      .eq("id", previewId)
      .eq("generated_by_ai", true)
      .maybeSingle()
    if (dok) {
      const buffer = await downloadDokument(dok.storage_path)
      const result = await mammoth.convertToHtml({ buffer })
      previewHtml = result.value
      previewNaziv = dok.naziv
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("naslov")}</h1>

      {dokumenti.length === 0 ? (
        <div data-testid="pregled-prazno" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
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

      {previewHtml !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">{previewNaziv}</h2>
            <Link href="/zapisnici" className={IKONA_INLINE_KLASA} data-testid="pregled-zatvori" aria-label={t("zatvoriPregled")}>
              <X className="h-4 w-4" aria-hidden />
              <Tooltip>{t("zatvoriPregled")}</Tooltip>
            </Link>
          </div>
          <DocxPreview html={previewHtml} />
        </div>
      )}
    </div>
  )
}
