import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { downloadDokument } from "@/lib/supabase/storage"
import { DocxPreview } from "@/components/domain/DocxPreview"
import { ObrisiDokumentButton } from "@/components/domain/ObrisiDokumentButton"
import { formatDatum } from "@/lib/date"
import mammoth from "mammoth"

export default async function PregledPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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
      <h1 className="text-2xl font-semibold">Pregled — AI zapisnici</h1>

      {dokumenti.length === 0 ? (
        <div data-testid="pregled-prazno" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          Još nema AI-generisanih zapisnika. Generiši ih iz detalja termina.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm" data-testid="pregled-tabela">
            <thead className="bg-slate-50">
              <tr>
                {["Klijent", "Vrsta provjere", "Datum", "Akcije"].map((c) => (
                  <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dokumenti.map((d) => (
                <tr key={d.id} data-testid="pregled-red" className="border-t border-slate-100">
                  <td className="px-3 py-2">{d.klijent_naziv ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{d.vrsta_naziv ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">{formatDatum(d.uploaded_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <Link href={`/pregled?preview=${d.id}`} className="text-brand hover:underline" data-testid="pregled-preview">
                        Pregled
                      </Link>
                      <a href={`/api/dokumenti/${d.id}`} className="text-brand hover:underline" data-testid="pregled-download">
                        Preuzmi
                      </a>
                      <ObrisiDokumentButton dokumentId={d.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewHtml !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">{previewNaziv}</h2>
            <Link href="/pregled" className="text-sm text-slate-500 hover:text-slate-700" data-testid="pregled-zatvori">
              Zatvori pregled
            </Link>
          </div>
          <DocxPreview html={previewHtml} />
        </div>
      )}
    </div>
  )
}
