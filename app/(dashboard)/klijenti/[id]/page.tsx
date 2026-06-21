import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { KlijentTabs } from "@/components/domain/KlijentTabs"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { formatDatum } from "@/lib/date"
import type { Database } from "@/db/types"

type TerminViewRow = Database["public"]["Views"]["termini_view"]["Row"]
type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]

const VALID_TABS = ["termini", "lokacije", "kontakti", "dokumenti"]

export default async function KlijentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const tab = typeof sp.tab === "string" && VALID_TABS.includes(sp.tab) ? sp.tab : "termini"

  const supabase = await createServerSupabaseClient()
  // Čitamo iz klijenti_view OD POČETKA (daje naziv/napomena + broj_termina za T6 delete guard).
  // 3 paralelna fetch-a = fan-out, nije N+1.
  const [klijentRes, terminiRes, lokacijeRes] = await Promise.all([
    supabase.from("klijenti_view").select("*").eq("id", id).maybeSingle(),
    supabase.from("termini_view").select("*").eq("klijent_id", id).order("rok_dospijeca", { ascending: true }),
    supabase.from("lokacije").select("*").eq("klijent_id", id).order("naziv", { ascending: true }),
  ])

  const klijent = klijentRes.data
  // klijenti_view kolone su nullable u TS; guard narrowuje id/naziv na string (notFound() vraća never)
  if (!klijent || !klijent.id || !klijent.naziv) notFound()
  const termini = (terminiRes.data ?? []) as TerminViewRow[]
  const lokacije = (lokacijeRes.data ?? []) as LokacijaRow[]

  return (
    <div className="space-y-6">
      <Link
        href="/klijenti"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        data-testid="nazad-klijenti"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden /> Klijenti
      </Link>

      <div>
        <h1 className="text-2xl font-semibold" data-testid="klijent-naziv">
          {klijent.naziv}
        </h1>
        {klijent.napomena && <p className="mt-1 text-sm text-slate-500">{klijent.napomena}</p>}
      </div>

      <KlijentTabs activeTab={tab} klijentId={id} />

      {tab === "termini" && (
        <div data-testid="tab-termini-content" className="rounded-xl border border-slate-200 overflow-hidden">
          {termini.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Nema termina za ovog klijenta.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Datum roka", "Vrsta", "Lokacija", "Status", "Zaduženi"].map((c) => (
                    <th
                      key={c}
                      className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {termini.map((t) => (
                  <tr key={t.id ?? ""} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{formatDatum(t.rok_dospijeca)}</td>
                    <td className="px-3 py-2 text-slate-600">{t.vrsta_naziv ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{t.lokacija_naziv ?? "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={t.status_izvedeni} />
                    </td>
                    <td className="px-3 py-2 text-slate-600">{t.zaduzeni ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "kontakti" && (
        <div data-testid="tab-kontakti-content" className="space-y-3">
          {lokacije.filter((l) => l.kontakt_osoba || l.kontakt_email || l.kontakt_telefon).length === 0 ? (
            <p className="text-sm text-slate-500">Nema kontakata. Dodajte ih kroz lokacije.</p>
          ) : (
            lokacije.map(
              (l) =>
                (l.kontakt_osoba || l.kontakt_email || l.kontakt_telefon) && (
                  <div key={l.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="font-medium">
                      {l.naziv}
                      {l.grad ? ` · ${l.grad}` : ""}
                    </p>
                    <div className="mt-1 text-slate-600 space-y-0.5">
                      {l.kontakt_osoba && <p>{l.kontakt_osoba}</p>}
                      {l.kontakt_email && <p>{l.kontakt_email}</p>}
                      {l.kontakt_telefon && <p>{l.kontakt_telefon}</p>}
                    </div>
                  </div>
                )
            )
          )}
        </div>
      )}

      {tab === "dokumenti" && (
        <div
          data-testid="tab-dokumenti-content"
          className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500"
        >
          Upload i AI generisanje zapisnika dolazi u Fazi 7.
        </div>
      )}

      {tab === "lokacije" && (
        <div
          data-testid="tab-lokacije-content"
          className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500"
        >
          Lokacije se popunjavaju u Task 5.
        </div>
      )}
    </div>
  )
}
