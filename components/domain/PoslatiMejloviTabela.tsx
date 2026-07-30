import { getTranslations } from "next-intl/server"
import { Badge } from "@/components/ui/badge"
import { formatDatumVrijeme } from "@/lib/date"
import {
  TIP_KEY,
  STATUS_KEY,
  DOSTAVA_KEY,
  DOSTAVA_VARIJANTA,
  jeGreska,
  jeDemo,
  dostavaObim,
  type MejlRed,
} from "@/lib/poslati-mejlovi"
import { OznaciPregledanimButton } from "@/components/domain/OznaciPregledanimButton"

export async function PoslatiMejloviTabela({
  redovi,
  imaFiltera,
}: {
  redovi: MejlRed[]
  /** true kad je bar jedan filter (ili strana > 1) aktivan — razdvaja "dnevnik prazan" od "filteri bez rezultata". */
  imaFiltera: boolean
}) {
  const t = await getTranslations("poslatiMejlovi")

  if (redovi.length === 0) {
    return (
      <p className="rounded-xl bg-card p-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
        {t(imaFiltera ? "praznoFilteri" : "prazno")}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-3 py-2">{t("kolone.vrijeme")}</th>
            <th scope="col" className="px-3 py-2">{t("kolone.tip")}</th>
            <th scope="col" className="px-3 py-2">{t("kolone.primaoci")}</th>
            <th scope="col" className="px-3 py-2">{t("kolone.naslov")}</th>
            <th scope="col" className="px-3 py-2">{t("kolone.klijent")}</th>
            <th scope="col" className="px-3 py-2">{t("kolone.slanje")}</th>
            <th scope="col" className="px-3 py-2">{t("kolone.dostava")}</th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">{t("kolone.akcije")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {redovi.map((r) => (
            <tr
              key={r.id}
              className={
                jeGreska(r)
                  ? "border-t border-border bg-destructive/5"
                  : "border-t border-border"
              }
            >
              <td className="px-3 py-2 whitespace-nowrap">
                {formatDatumVrijeme(r.created_at)}
              </td>
              <td className="px-3 py-2">{t(`tip.${TIP_KEY[r.tip]}` as never)}</td>
              <td className="px-3 py-2">{(r.primaoci ?? []).join(", ") || "—"}</td>
              <td className="px-3 py-2">{r.subject}</td>
              <td className="px-3 py-2">{r.klijent_naziv ?? "—"}</td>
              <td className="px-3 py-2">
                {/* Demo red dobija bedž, ne običan tekst — da se na prvi pogled razlikuje
                    od stvarno poslatog mejla i kad je traka iznad odskrolana. */}
                {jeDemo(r) ? (
                  <Badge variant="secondary" data-testid="mejl-demo-bedz">
                    {t("status.demo")}
                  </Badge>
                ) : (
                  t(`status.${STATUS_KEY[r.status]}` as never)
                )}
                {r.greska && <span className="block text-xs text-destructive">{r.greska}</span>}
              </td>
              <td className="px-3 py-2">
                {/* Za demo red status dostave nema smisla: „Nepoznato" bi nagovijestilo
                    da mejl još može stići, a nikad nije ni poslat. */}
                {jeDemo(r) ? (
                  <span className="text-muted-foreground" data-testid="mejl-dostava-nema">—</span>
                ) : (
                  (() => {
                    // Jedan Resend send = jedan red = više primalaca. Kad je neuspjeh
                    // pogodio samo dio njih, bedž to mora reći — inače red za mejl koji
                    // je stigao dvojici od tri izgleda kao da nije stigao nikome.
                    const obim = dostavaObim(r)
                    const oznaka = t(`dostava.${DOSTAVA_KEY[r.delivery_status]}` as never)
                    if (obim.vrsta !== "djelimicna") {
                      return (
                        <Badge variant={DOSTAVA_VARIJANTA[r.delivery_status]}>{oznaka}</Badge>
                      )
                    }
                    return (
                      <>
                        <Badge
                          variant={DOSTAVA_VARIJANTA[r.delivery_status]}
                          data-testid="mejl-dostava-djelimicno"
                        >
                          {t("dostava.djelimicno", {
                            oznaka,
                            pogodjenih: obim.pogodjenih,
                            ukupno: obim.ukupno,
                          })}
                        </Badge>
                        {/* Adresa je vidljiv tekst, ne `title` — tooltip ne postoji za
                            tastaturu ni za čitače ekrana (S12). Bez nje se ne zna KOGA
                            treba ispraviti. */}
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {t("dostava.djelimicnoAdrese", { adrese: obim.pogodjeni.join(", ") })}
                        </span>
                      </>
                    )
                  })()
                )}
              </td>
              <td className="px-3 py-2">
                {jeGreska(r) && (
                  <OznaciPregledanimButton id={r.id} imaKlijenta={r.klijent_id !== null} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
