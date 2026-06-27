import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { KlijentTabs } from "@/components/domain/KlijentTabs"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { LokacijeTab } from "@/components/domain/LokacijeTab"
import { KlijentEditForm } from "@/components/domain/KlijentEditForm"
import { ObrisiKlijentButton } from "@/components/domain/ObrisiKlijentButton"
import { TipOdnosaBadge } from "@/components/domain/TipOdnosaBadge"
import { ProfilTab } from "@/components/domain/ProfilTab"
import { KlijentDokumentUpload } from "@/components/domain/KlijentDokumentUpload"
import { IdKartaTab } from "@/components/domain/IdKartaTab"
import { formatDatum, addMjeseci } from "@/lib/date"
import type { Database } from "@/db/types"

type TerminViewRow = Database["public"]["Views"]["termini_view"]["Row"]
type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]
type DokumentRow = Database["public"]["Tables"]["dokumenti"]["Row"]

const VALID_TABS = ["id-karta", "termini", "lokacije", "kontakti", "dokumenti", "profil"]

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
  // klijenti_view ne izlaže podsjetnik_emails, pa dodajemo 4. fetch direktno iz klijenti tabele.
  // 4 paralelna fetch-a = fan-out, nije N+1.
  const [klijentRes, terminiRes, lokacijeRes, primaociRes] = await Promise.all([
    supabase.from("klijenti_view").select("*").eq("id", id).maybeSingle(),
    supabase.from("termini_view").select("*").eq("klijent_id", id).order("rok_dospijeca", { ascending: true }),
    supabase.from("lokacije").select("*").eq("klijent_id", id).order("naziv", { ascending: true }),
    supabase.from("klijenti").select("podsjetnik_emails, tip_odnosa, adresa, pib, maticni_broj, sifra_djelatnosti, telefon, email, zaduzeni_tehpro_id").eq("id", id).maybeSingle(),
  ])

  const klijent = klijentRes.data
  // klijenti_view kolone su nullable u TS; guard narrowuje id/naziv na string (notFound() vraća never)
  if (!klijent || !klijent.id || !klijent.naziv) notFound()
  const termini = (terminiRes.data ?? []) as TerminViewRow[]
  const lokacije = (lokacijeRes.data ?? []) as LokacijaRow[]

  // Klijent-nivo: dohvaćamo SVE dokumente klijenta (termin-vezane + klijent/ugovor-nivo).
  const { data: dokData } = await supabase
    .from("dokumenti")
    .select("*")
    .eq("klijent_id", id)
    .order("uploaded_at", { ascending: false })
  const dokumenti = (dokData ?? []) as DokumentRow[]

  const [profilRes, vrsteRes] = await Promise.all([
    supabase
      .from("klijent_provjere")
      .select("id, interval_mjeseci, zadnji_datum, vrsta_provjere:vrste_provjera(naziv, podrazumevani_interval_mjeseci), lokacija:lokacije(naziv)")
      .eq("klijent_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("vrste_provjera").select("id, naziv, podrazumevani_interval_mjeseci").eq("aktivna", true).order("naziv"),
  ])
  const profilStavke = (profilRes.data ?? []).map((p) => {
    const interval = p.interval_mjeseci ?? (p.vrsta_provjere as { podrazumevani_interval_mjeseci: number | null } | null)?.podrazumevani_interval_mjeseci ?? null
    return {
      id: p.id as string,
      vrsta_naziv: (p.vrsta_provjere as { naziv: string } | null)?.naziv ?? "—",
      lokacija_naziv: (p.lokacija as { naziv: string } | null)?.naziv ?? null,
      interval_mjeseci: p.interval_mjeseci as number | null,
      zadnji_datum: p.zadnji_datum as string,
      sljedeci_rok: interval ? addMjeseci(p.zadnji_datum as string, interval) : (p.zadnji_datum as string),
    }
  })
  const vrsteOpcije = (vrsteRes.data ?? []).map((v) => ({ id: v.id as string, naziv: v.naziv as string, interval: v.podrazumevani_interval_mjeseci as number | null }))
  const lokacijeOpcije = lokacije.map((l) => ({ id: l.id, naziv: l.naziv }))
  const { data: korisniciData } = await supabase.from("korisnici").select("id, ime").eq("aktivan", true).order("ime")
  const korisnici = (korisniciData ?? []).map((k) => ({ id: k.id, ime: k.ime }))
  // Ugovori/kontakti trebaju samo na "id-karta" tabu → ne dohvaćaj ih bez potrebe.
  const ugovori = tab === "id-karta"
    ? ((await supabase.from("ugovori").select("*").eq("klijent_id", id)
        .order("aktivan", { ascending: false }).order("created_at", { ascending: false })).data ?? [])
    : []
  const kontakti = tab === "id-karta"
    ? ((await supabase.from("kontakt_osobe").select("*").eq("klijent_id", id).order("ime")).data ?? [])
    : []
  const zaduzeniIme = primaociRes.data?.zaduzeni_tehpro_id
    ? (korisnici.find((k) => k.id === primaociRes.data!.zaduzeni_tehpro_id)?.ime ?? null)
    : null

  return (
    <div className="space-y-6">
      <Link
        href="/klijenti"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        data-testid="nazad-klijenti"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden /> Klijenti
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold" data-testid="klijent-naziv">
              {klijent.naziv}
            </h1>
            <TipOdnosaBadge tip={(klijent.tip_odnosa as "ugovor" | "ponuda" | null) ?? null} />
          </div>
          {klijent.napomena && <p className="mt-1 text-sm text-slate-500">{klijent.napomena}</p>}
        </div>
        <div className="flex items-center gap-2">
          <KlijentEditForm
            klijent={{
              id: klijent.id,
              naziv: klijent.naziv,
              napomena: klijent.napomena ?? null,
              podsjetnik_emails: primaociRes.data?.podsjetnik_emails ?? [],
              tip_odnosa: primaociRes.data?.tip_odnosa ?? null,
              adresa: primaociRes.data?.adresa ?? null,
              pib: primaociRes.data?.pib ?? null,
              maticni_broj: primaociRes.data?.maticni_broj ?? null,
              sifra_djelatnosti: primaociRes.data?.sifra_djelatnosti ?? null,
              telefon: primaociRes.data?.telefon ?? null,
              email: primaociRes.data?.email ?? null,
              zaduzeni_tehpro_id: primaociRes.data?.zaduzeni_tehpro_id ?? null,
            }}
            korisnici={korisnici}
          />
          <ObrisiKlijentButton klijentId={klijent.id} brojTermina={klijent.broj_termina ?? 0} />
        </div>
      </div>

      <KlijentTabs activeTab={tab} klijentId={id} />

      {tab === "id-karta" && (
        <IdKartaTab
          klijentId={id}
          osnovni={{
            adresa: primaociRes.data?.adresa ?? null,
            telefon: primaociRes.data?.telefon ?? null,
            email: primaociRes.data?.email ?? null,
            pib: primaociRes.data?.pib ?? null,
            maticni_broj: primaociRes.data?.maticni_broj ?? null,
            sifra_djelatnosti: primaociRes.data?.sifra_djelatnosti ?? null,
          }}
          zaduzeniIme={zaduzeniIme}
          ugovori={ugovori}
          kontakti={kontakti}
          usluge={profilStavke.map((p) => ({ vrsta_naziv: p.vrsta_naziv, lokacija_naziv: p.lokacija_naziv, sljedeci_rok: p.sljedeci_rok }))}
        />
      )}

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
        <div data-testid="tab-dokumenti-content" className="space-y-3">
          <KlijentDokumentUpload klijentId={id} />
          {dokumenti.length === 0 ? (
            <div className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">Nema dokumenata za ovog klijenta.</div>
          ) : (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {["Naziv", "Tip", "Izvor", "Datum", ""].map((c) => (
                      <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dokumenti.map((d) => (
                    <tr key={d.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{d.naziv}</td>
                      <td className="px-3 py-2 text-slate-500">{d.tip}</td>
                      <td className="px-3 py-2 text-slate-500">{d.generated_by_ai ? "AI zapisnik" : "Upload"}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-500">{formatDatum(d.uploaded_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <a href={`/api/dokumenti/${d.id}`} className="text-brand hover:underline" data-testid="klijent-dokument-download">
                          Preuzmi
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "lokacije" && <LokacijeTab klijentId={id} lokacije={lokacije} />}

      {tab === "profil" && (
        <ProfilTab klijentId={id} stavke={profilStavke} vrste={vrsteOpcije} lokacije={lokacijeOpcije} />
      )}
    </div>
  )
}
