import Link from "next/link"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { ChevronLeft, MapPin } from "lucide-react"
import { InfoIkona } from "@/components/ui/info-ikona"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { KlijentTabs } from "@/components/domain/KlijentTabs"
import { StatusBadge } from "@/components/domain/StatusBadge"
import { LokacijeTab } from "@/components/domain/LokacijeTab"
import { KlijentEditForm } from "@/components/domain/KlijentEditForm"
import { ObrisiKlijentButton } from "@/components/domain/ObrisiKlijentButton"
import { TipOdnosaBadge } from "@/components/domain/TipOdnosaBadge"
import { ProfilTab } from "@/components/domain/ProfilTab"
import { KlijentDokumentUpload } from "@/components/domain/KlijentDokumentUpload"
import { ObrisiDokumentButton } from "@/components/domain/ObrisiDokumentButton"
import { PreuzmiDokumentButton } from "@/components/domain/PreuzmiDokumentButton"
import { DodajProvjeruButton } from "@/components/domain/DodajProvjeruButton"
import { IdKartaTab } from "@/components/domain/IdKartaTab"
import { KlijentPodsjetniciTab } from "@/components/domain/KlijentPodsjetniciTab"
import { KontaktiKlijentList } from "@/components/domain/KontaktiKlijentList"
import { KontaktHighlighter } from "@/components/domain/KontaktHighlighter"
import { GreskaUcitavanja } from "@/components/domain/GreskaUcitavanja"
import { Pagination } from "@/components/domain/Pagination"
import { formatDatum, formatDatumInstant, addMjeseci } from "@/lib/date"
import { href } from "@/i18n/routes"
import type { Database } from "@/db/types"

type TerminViewRow = Database["public"]["Views"]["termini_view"]["Row"]
type LokacijaRow = Database["public"]["Tables"]["lokacije"]["Row"]
type DokumentRow = Database["public"]["Tables"]["dokumenti"]["Row"]

const VALID_TABS = ["id-karta", "termini", "lokacije", "kontakti", "dokumenti", "podsjetnici", "profil"]

const DOKUMENTI_PER_PAGE = 20
const TERMINI_PER_PAGE = 50

const KARTICA = "rounded-xl bg-card ring-1 ring-foreground/10"
const TABELA_OKVIR = `${KARTICA} overflow-hidden`
const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"

// PostgREST vraća ovaj kod kad je tražena `.range()` stranica van opsega
// (npr. bookmark na str. 3 poslije brisanja redova). To NIJE pad upita —
// tretiramo ga kao praznu stranicu, ne kao grešku učitavanja (S1).
const RANGE_VAN_OPSEGA = "PGRST103"
function jeGreskaUpita(e: { code?: string } | null): boolean {
  return e != null && e.code !== RANGE_VAN_OPSEGA
}

function strana(v: string | string[] | undefined): number {
  return Math.max(1, Number(typeof v === "string" ? v : "1") || 1)
}

export default async function KlijentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations("klijenti.detalj")
  const tPag = await getTranslations("common.pagination")
  const { id } = await params
  const sp = await searchParams
  const tab = typeof sp.tab === "string" && VALID_TABS.includes(sp.tab) ? sp.tab : "termini"
  const highlight = typeof sp.highlight === "string" ? sp.highlight : null
  const dokStrana = strana(sp.dstr)
  const termStrana = strana(sp.tstr)

  // Šta kojem tabu stvarno treba — tab koji podatke ne prikazuje ne okida upit (N14).
  const trebaEnrichment = tab === "id-karta" || tab === "profil" // termini + profil stavke
  const trebaOpcije = tab === "termini" || tab === "profil" // vrste + admini za DodajProvjeruButton
  const trebaUgovore = tab === "id-karta"
  // Tab „lokacije" takođe treba kontakte: forma nudi vezivanje postojećeg, a tabela
  // prikazuje ko stvarno prima podsjetnike za tu lokaciju.
  const trebaKontakte = tab === "id-karta" || tab === "kontakti" || tab === "lokacije"
  const trebaDokumente = tab === "dokumenti"

  const supabase = await createServerSupabaseClient()
  const prazno = Promise.resolve({ data: null, error: null, count: null })

  // Jedan fan-out umjesto 6 serijskih rundi (S16/N14). Čitamo iz klijenti_view
  // (naziv/napomena + broj_termina za T6 delete guard); klijenti_view ne izlaže
  // sva polja edit-forme pa ide i direktan select iz klijenti tabele.
  const [
    klijentRes,
    lokacijeRes,
    klijentTabelaRes,
    korisniciRes,
    terminiRes,
    terminiStranaRes,
    profilRes,
    vrsteRes,
    adminiRes,
    ugovoriRes,
    kontaktiRes,
    dokumentiRes,
  ] = await Promise.all([
    supabase.from("klijenti_view").select("*").eq("id", id).maybeSingle(),
    supabase.from("lokacije").select("*").eq("klijent_id", id).order("naziv", { ascending: true }),
    supabase.from("klijenti").select("tip_odnosa, adresa, pib, maticni_broj, sifra_djelatnosti, telefon, email, zaduzeni_tehpro_id").eq("id", id).maybeSingle(),
    // RLS na `korisnici` je self-select → direktan from() bi operateru vratio samo
    // njega samog; SECURITY DEFINER RPC daje sve aktivne (S8.6).
    supabase.rpc("get_aktivni_korisnici"),
    // Puni spisak termina služi ISKLJUČIVO obogaćivanju profila/usluga.
    trebaEnrichment
      ? supabase.from("termini_view").select("*").eq("klijent_id", id).order("rok_dospijeca", { ascending: true })
      : prazno,
    // Prikaz tabele termina je paginiran (S9).
    tab === "termini"
      ? supabase.from("termini_view").select("*", { count: "exact" }).eq("klijent_id", id)
          .order("rok_dospijeca", { ascending: true })
          .range((termStrana - 1) * TERMINI_PER_PAGE, termStrana * TERMINI_PER_PAGE - 1)
      : prazno,
    trebaEnrichment
      ? supabase
          .from("klijent_provjere")
          .select("id, vrsta_provjere_id, lokacija_id, interval_mjeseci, zadnji_datum, vrsta_provjere:vrste_provjera(naziv, podrazumevani_interval_mjeseci), lokacija:lokacije(naziv)")
          .eq("klijent_id", id)
          .order("created_at", { ascending: true })
      : prazno,
    trebaOpcije
      ? supabase.from("vrste_provjera").select("id, naziv, podrazumevani_interval_mjeseci").eq("aktivna", true).order("naziv")
      : prazno,
    // Aktivni admini (ime+email) za "Dodaj provjeru" fallback kad vrsta nema interval:
    // operater ne može u Postavke, pa mu prikazujemo kome da se javi.
    trebaOpcije ? supabase.rpc("get_admini") : prazno,
    trebaUgovore
      ? supabase.from("ugovori").select("*").eq("klijent_id", id)
          .order("aktivan", { ascending: false }).order("created_at", { ascending: false })
      : prazno,
    trebaKontakte ? supabase.from("kontakt_osobe").select("*").eq("klijent_id", id).order("ime") : prazno,
    trebaDokumente
      ? supabase.from("dokumenti").select("*", { count: "exact" }).eq("klijent_id", id)
          .order("uploaded_at", { ascending: false })
          .range((dokStrana - 1) * DOKUMENTI_PER_PAGE, dokStrana * DOKUMENTI_PER_PAGE - 1)
      : prazno,
  ])

  // S1: pad upita se NE smije maskirati u 404 — prvo greška, pa tek onda notFound().
  if (klijentRes.error) {
    return (
      <div className="space-y-6">
        <Link
          href={href("/klijenti")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          data-testid="nazad-klijenti"
        >
          <ChevronLeft className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("nazad")}
        </Link>
        <GreskaUcitavanja testId="klijent-greska" />
      </div>
    )
  }

  const klijent = klijentRes.data
  // klijenti_view kolone su nullable u TS; guard narrowuje id/naziv na string (notFound() vraća never)
  if (!klijent || !klijent.id || !klijent.naziv) notFound()

  // S1: greška bilo kog aktivnog fetch-a → sadržaj taba se zamjenjuje porukom,
  // header i tabs ostaju upotrebljivi.
  const greskaTaba = [
    lokacijeRes.error,
    klijentTabelaRes.error,
    korisniciRes.error,
    trebaEnrichment ? terminiRes.error : null,
    trebaEnrichment ? profilRes.error : null,
    tab === "termini" ? terminiStranaRes.error : null,
    trebaOpcije ? vrsteRes.error : null,
    trebaOpcije ? adminiRes.error : null,
    trebaUgovore ? ugovoriRes.error : null,
    trebaKontakte ? kontaktiRes.error : null,
    trebaDokumente ? dokumentiRes.error : null,
  ].some(jeGreskaUpita)

  const termini = (terminiRes.data ?? []) as TerminViewRow[]
  const terminiStrane = (terminiStranaRes.data ?? []) as TerminViewRow[]
  const terminiUkupno = terminiStranaRes.count ?? 0
  const terminiStranica = Math.max(1, Math.ceil(terminiUkupno / TERMINI_PER_PAGE))
  const lokacije = (lokacijeRes.data ?? []) as LokacijaRow[]
  const dokumenti = (dokumentiRes.data ?? []) as DokumentRow[]
  const dokumentiUkupno = dokumentiRes.count ?? 0
  const dokumentiStranica = Math.max(1, Math.ceil(dokumentiUkupno / DOKUMENTI_PER_PAGE))
  const ugovori = ugovoriRes.data ?? []
  const kontakti = kontaktiRes.data ?? []
  const klijentPolja = klijentTabelaRes.data

  // Profil se obogaćuje STVARNIM terminima iz baze (već dohvaćeni, sortirani po roku ASC):
  // "Sljedeći rok" = rok aktivnog termina (planirano/zakazano/kasni), "Zadnji put" = zadnje
  // stvarno izvršenje. Statični klijent_provjere.zadnji_datum je samo fallback — ne ažurira
  // se pri izvršenju termina, pa bi bez ovoga profil pokazivao zastarjele datume.
  const AKTIVNI_STATUSI = ["planirano", "zakazano", "kasni"]
  const profilStavke = (profilRes.data ?? []).map((p) => {
    const interval = p.interval_mjeseci ?? (p.vrsta_provjere as { podrazumevani_interval_mjeseci: number | null } | null)?.podrazumevani_interval_mjeseci ?? null
    // NULL lokacija se poklapa samo sa NULL lokacijom (?? null normalizuje undefined iz view-a)
    const istiPar = termini.filter(
      (term) => term.vrsta_provjere_id === p.vrsta_provjere_id && (term.lokacija_id ?? null) === (p.lokacija_id ?? null),
    )
    const aktivni = istiPar.find((term) => AKTIVNI_STATUSI.includes(term.status_izvedeni ?? ""))
    const zadnjeIzvrsenje = istiPar.reduce<string | null>(
      (max, term) => (term.status === "izvrseno" && term.datum_izvrsenja && (!max || term.datum_izvrsenja > max) ? term.datum_izvrsenja : max),
      null,
    )
    const zadnji = zadnjeIzvrsenje ?? (p.zadnji_datum as string | null)
    return {
      id: p.id as string,
      vrsta_naziv: (p.vrsta_provjere as { naziv: string } | null)?.naziv ?? "—",
      lokacija_naziv: (p.lokacija as { naziv: string } | null)?.naziv ?? null,
      interval_mjeseci: interval,
      zadnji_datum: zadnji,
      sljedeci_rok: aktivni?.rok_dospijeca ?? (interval && zadnji ? addMjeseci(zadnji, interval) : zadnji),
      termin_status: aktivni?.status_izvedeni ?? null,
    }
  })
  const vrsteOpcije = (vrsteRes.data ?? []).map((v) => ({ id: v.id as string, naziv: v.naziv as string, interval: v.podrazumevani_interval_mjeseci as number | null }))
  const lokacijeOpcije = lokacije.map((l) => ({ id: l.id, naziv: l.naziv }))
  const korisnici = (korisniciRes.data ?? []).map((k) => ({ id: k.id, ime: k.ime }))
  const admini = (adminiRes.data ?? []).map((a) => ({ ime: a.ime, email: a.email }))
  const zaduzeniIme = klijentPolja?.zaduzeni_tehpro_id
    ? (korisnici.find((k) => k.id === klijentPolja.zaduzeni_tehpro_id)?.ime ?? null)
    : null

  // Paginacioni link čuva tab (i sve ostale searchParamse).
  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : []))
  )
  const stranaHref = (kljuc: "dstr" | "tstr") => (p: number) => {
    const params = new URLSearchParams(currentSearch)
    params.set("tab", tab)
    params.set(kljuc, String(p))
    return href(`/klijenti/${id}?${params.toString()}`)
  }

  return (
    <div className="space-y-6">
      <Link
        href={href("/klijenti")}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        data-testid="nazad-klijenti"
      >
        <ChevronLeft className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("nazad")}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand/10 text-lg font-semibold text-brand"
            aria-hidden
          >
            {klijent.naziv.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"}
          </span>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold" data-testid="klijent-naziv">
                {klijent.naziv}
              </h1>
              <TipOdnosaBadge tip={(klijent.tip_odnosa as "ugovor" | "ponuda" | null) ?? null} />
            </div>
            {klijent.napomena && <p className="mt-1 text-sm text-muted-foreground">{klijent.napomena}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <KlijentEditForm
            klijent={{
              id: klijent.id,
              naziv: klijent.naziv,
              napomena: klijent.napomena ?? null,
              tip_odnosa: klijentPolja?.tip_odnosa ?? null,
              adresa: klijentPolja?.adresa ?? null,
              pib: klijentPolja?.pib ?? null,
              maticni_broj: klijentPolja?.maticni_broj ?? null,
              sifra_djelatnosti: klijentPolja?.sifra_djelatnosti ?? null,
              telefon: klijentPolja?.telefon ?? null,
              email: klijentPolja?.email ?? null,
              zaduzeni_tehpro_id: klijentPolja?.zaduzeni_tehpro_id ?? null,
            }}
            korisnici={korisnici}
          />
          <ObrisiKlijentButton klijentId={klijent.id} brojTermina={klijent.broj_termina ?? 0} />
        </div>
      </div>

      <KlijentTabs activeTab={tab} klijentId={id} />

      {greskaTaba ? (
        <GreskaUcitavanja testId="klijent-tab-greska" />
      ) : (
        <>
          {tab === "id-karta" && (
            <IdKartaTab
              klijentId={id}
              lokacije={lokacije.map((l) => ({ id: l.id, naziv: l.naziv }))}
              osnovni={{
                adresa: klijentPolja?.adresa ?? null,
                telefon: klijentPolja?.telefon ?? null,
                email: klijentPolja?.email ?? null,
                pib: klijentPolja?.pib ?? null,
                maticni_broj: klijentPolja?.maticni_broj ?? null,
                sifra_djelatnosti: klijentPolja?.sifra_djelatnosti ?? null,
              }}
              zaduzeniIme={zaduzeniIme}
              ugovori={ugovori}
              kontakti={kontakti}
              usluge={profilStavke.map((p) => ({ vrsta_naziv: p.vrsta_naziv, lokacija_naziv: p.lokacija_naziv, sljedeci_rok: p.sljedeci_rok }))}
            />
          )}

          {tab === "termini" && (
            <div data-testid="tab-termini-content" className="space-y-4">
              <div className="flex justify-end">
                <DodajProvjeruButton klijentId={id} vrste={vrsteOpcije} lokacije={lokacijeOpcije} admini={admini} />
              </div>
              <div className={TABELA_OKVIR}>
                {terminiUkupno === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    {t("terminiTab.prazno")}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        {[
                          t("terminiTab.kolone.datumRoka"),
                          t("terminiTab.kolone.vrsta"),
                          t("terminiTab.kolone.lokacija"),
                          t("terminiTab.kolone.status"),
                          t("terminiTab.kolone.zaduzeni"),
                        ].map((c) => (
                          <th key={c} scope="col" className={TH}>
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {terminiStrane.map((term) => (
                        <tr key={term.id ?? ""} className="border-t border-border">
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap">{formatDatum(term.rok_dospijeca)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{term.vrsta_naziv ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{term.lokacija_naziv ?? "—"}</td>
                          <td className="px-3 py-2">
                            <StatusBadge status={term.status_izvedeni} stvarniStatus={term.status} datumZakazan={term.datum_zakazan} />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{term.zaduzeni ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="flex justify-end" data-testid="termini-pagination">
                <Pagination
                  pageNum={termStrana}
                  totalPages={terminiStranica}
                  hrefFor={stranaHref("tstr")}
                  pageTestId="termini-page"
                  prethodnaLabel={tPag("prethodna")}
                  sljedecaLabel={tPag("sljedeca")}
                  stranaText={tPag("strana", { pageNum: termStrana, totalPages: terminiStranica })}
                />
              </div>
            </div>
          )}

          {tab === "kontakti" && (
            <div data-testid="tab-kontakti-content" className="space-y-5">
              <KontaktHighlighter targetId={highlight} />

              <section className={`${KARTICA} p-5`}>
                <KontaktiKlijentList
                  klijentId={id}
                  kontakti={kontakti}
                  lokacije={lokacije.map((l) => ({ id: l.id, naziv: l.naziv }))}
                  searchable
                  info={t("kontaktiTab.infoPuniSpisak")}
                />
              </section>

              {lokacije.some((l) => l.kontakt_osoba || l.kontakt_email || l.kontakt_telefon) && (
                <section className={`${KARTICA} p-5`}>
                  <div className="mb-3 flex items-center gap-2">
                    <MapPin className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
                    <h3 className="text-sm font-semibold text-foreground">{t("kontaktiTab.naslovLokacije")}</h3>
                    <InfoIkona
                      tekst={t("kontaktiTab.infoLokacije")}
                      testId="info-sekcija-kontakti-lokacija"
                    />
                  </div>
                  <ul className="space-y-2">
                    {lokacije.map(
                      (l) =>
                        (l.kontakt_osoba || l.kontakt_email || l.kontakt_telefon) && (
                          <li
                            key={l.id}
                            id={`kontakt-${l.id}`}
                            data-testid="kontakt-lokacija-card"
                            className="scroll-mt-24 rounded-xl border border-border p-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">
                                {l.kontakt_osoba ?? "—"}
                                <span className="font-normal text-muted-foreground"> · {l.naziv}</span>
                              </span>
                              <Link
                                href={href(`/klijenti/${id}?tab=lokacije`)}
                                className="shrink-0 text-xs text-brand hover:underline"
                              >
                                {t("kontaktiTab.urediULokacijama")}
                              </Link>
                            </div>
                            {(l.kontakt_telefon || l.kontakt_email) && (
                              <div className="mt-1 text-muted-foreground">
                                {[l.kontakt_telefon, l.kontakt_email].filter(Boolean).join(" · ")}
                              </div>
                            )}
                          </li>
                        )
                    )}
                  </ul>
                </section>
              )}
            </div>
          )}

          {tab === "dokumenti" && (
            <div data-testid="tab-dokumenti-content" className="space-y-3">
              <KlijentDokumentUpload klijentId={id} />
              {dokumentiUkupno === 0 ? (
                <div className={`${KARTICA} p-8 text-center text-sm text-muted-foreground`}>{t("dokumentiTab.prazno")}</div>
              ) : (
                <div className={TABELA_OKVIR}>
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        {[
                          t("dokumentiTab.kolone.naziv"),
                          t("dokumentiTab.kolone.tip"),
                          t("dokumentiTab.kolone.izvor"),
                          t("dokumentiTab.kolone.datum"),
                          "",
                        ].map((c) => (
                          <th key={c} scope="col" className={TH}>
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dokumenti.map((d) => (
                        <tr key={d.id} className="border-t border-border">
                          <td className="px-3 py-2">{d.naziv}</td>
                          <td className="px-3 py-2 text-muted-foreground">{d.tip}</td>
                          <td className="px-3 py-2 text-muted-foreground">{d.generated_by_ai ? t("dokumentiTab.izvorAi") : t("dokumentiTab.izvorUpload")}</td>
                          {/* uploaded_at je timestamptz (instant) — zidni datum po APP_TIME_ZONE, ne UTC datum-dio */}
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatDatumInstant(d.uploaded_at)}</td>
                          <td className="px-3 py-2">
                            <span className="flex items-center justify-end gap-1">
                              <PreuzmiDokumentButton dokumentId={d.id} label={t("dokumentiTab.preuzmi")} testId="klijent-dokument-download" />
                              {/* Renderuje se samo adminu (samogating u komponenti; server akcija nameće isto pravilo) */}
                              <ObrisiDokumentButton dokumentId={d.id} testId="klijent-dokument-delete" />
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end" data-testid="dokumenti-pagination">
                <Pagination
                  pageNum={dokStrana}
                  totalPages={dokumentiStranica}
                  hrefFor={stranaHref("dstr")}
                  pageTestId="dokumenti-page"
                  prethodnaLabel={tPag("prethodna")}
                  sljedecaLabel={tPag("sljedeca")}
                  stranaText={tPag("strana", { pageNum: dokStrana, totalPages: dokumentiStranica })}
                />
              </div>
            </div>
          )}

          {tab === "lokacije" && (
            <LokacijeTab
              klijentId={id}
              lokacije={lokacije}
              kontakti={kontakti.map((k) => ({ id: k.id, ime: k.ime, lokacija_id: k.lokacija_id }))}
            />
          )}

          {tab === "podsjetnici" && <KlijentPodsjetniciTab klijentId={id} />}

          {tab === "profil" && (
            <ProfilTab klijentId={id} stavke={profilStavke} vrste={vrsteOpcije} lokacije={lokacijeOpcije} admini={admini} />
          )}
        </>
      )}
    </div>
  )
}
