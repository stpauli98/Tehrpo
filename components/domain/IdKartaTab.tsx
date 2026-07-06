import { getTranslations } from "next-intl/server"
import { UgovoriTab } from "@/components/domain/UgovoriTab"
import { KontaktiKlijentList } from "@/components/domain/KontaktiKlijentList"
import { PrikaziJosLista } from "@/components/domain/PrikaziJosLista"
import { InfoIkona } from "@/components/ui/info-ikona"
import { formatDatum } from "@/lib/date"
import { APP_NAME } from "@/lib/brand"
import { href } from "@/i18n/routes"
import { Building2, ClipboardCheck } from "lucide-react"
import type { Database } from "@/db/types"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"

export async function IdKartaTab({
  klijentId,
  osnovni,
  zaduzeniIme,
  ugovori,
  kontakti,
  usluge,
}: {
  klijentId: string
  osnovni: {
    adresa: string | null; telefon: string | null; email: string | null
    pib: string | null; maticni_broj: string | null; sifra_djelatnosti: string | null
  }
  zaduzeniIme: string | null
  ugovori: UgovorRow[]
  kontakti: KontaktRow[]
  usluge: { vrsta_naziv: string; lokacija_naziv: string | null; sljedeci_rok: string | null }[]
}) {
  const t = await getTranslations("klijenti.idKarta")
  const redovi: [string, string | null][] = [
    [t("polja.adresa"), osnovni.adresa],
    [t("polja.telefon"), osnovni.telefon],
    [t("polja.email"), osnovni.email],
    [t("polja.pib"), osnovni.pib],
    [t("polja.maticniBroj"), osnovni.maticni_broj],
    [t("polja.sifraDjelatnosti"), osnovni.sifra_djelatnosti],
    [t("polja.zaduzen", { appName: APP_NAME }), zaduzeniIme],
  ]
  return (
    <div className="space-y-5" data-testid="tab-id-karta-content">
      <section className={CARD}>
        <div className="mb-4 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-slate-400" aria-hidden />
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            {t("osnovniPodaci.naslov")}
            <InfoIkona
              tekst={t("osnovniPodaci.info")}
              testId="info-sekcija-osnovni"
            />
          </h3>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-3">
          {redovi.map(([label, val]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-slate-400">{label}</dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-slate-800" title={val || undefined}>
                {val || "—"}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={CARD}>
        <UgovoriTab
          klijentId={klijentId}
          ugovori={ugovori}
          info={t("ugovoriInfo")}
        />
      </section>

      <section className={CARD}>
        <KontaktiKlijentList
          klijentId={klijentId}
          kontakti={kontakti}
          previewLimit={4}
          seeAllHref={href(`/klijenti/${klijentId}?tab=kontakti`)}
          info={t("kontaktiInfo")}
        />
      </section>

      <section className={CARD}>
        <div className="mb-4 flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-slate-400" aria-hidden />
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            {t("usluge.naslov")}
            <InfoIkona
              tekst={t("usluge.info")}
              testId="info-sekcija-usluge"
            />
          </h3>
        </div>
        {usluge.length === 0 ? (
          <p className="text-sm text-slate-500">{t("usluge.prazno")}</p>
        ) : (
          <PrikaziJosLista
            ulClassName="divide-y divide-slate-100 text-sm"
            imenicaGenitiv={t("usluge.imenica")}
            testId="usluge-prikazi-jos"
            items={usluge.map((u, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="text-slate-700">
                  {u.vrsta_naziv}
                  {u.lokacija_naziv && <span className="text-slate-400"> · {u.lokacija_naziv}</span>}
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs tabular-nums text-slate-500">
                  {t("usluge.sljedeci", { datum: formatDatum(u.sljedeci_rok) })}
                </span>
              </li>
            ))}
          />
        )}
      </section>
    </div>
  )
}
