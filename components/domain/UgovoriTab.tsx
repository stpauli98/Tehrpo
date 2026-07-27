"use client"

import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Trash2, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InfoIkona } from "@/components/ui/info-ikona"
import { UgovorSheet } from "@/components/domain/UgovorSheet"
import { PrikaziJosLista } from "@/components/domain/PrikaziJosLista"
import { PotvrdiBrisanjeDialog } from "@/components/domain/PotvrdiBrisanjeDialog"
import { toastRezultat } from "@/components/akcija-toast"
import { deleteUgovor } from "@/app/(dashboard)/klijenti/actions"
import { formatDatum } from "@/lib/date"
import { useMozeUrediti } from "@/providers/korisnik-provider"
import type { Database } from "@/db/types"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]

export function UgovoriTab({ klijentId, ugovori, info }: { klijentId: string; ugovori: UgovorRow[]; info?: string }) {
  const t = useTranslations("klijenti.ugovori")
  const tc = useTranslations("common")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()

  // Per-red brisanje (S3/O3): svaki red ima vlastitu instancu dijaloga, pa pending
  // jednog reda ne blokira dugmad ostalih redova (raniji zajednički useActionState
  // je disable-ovao cijelu listu), a greška živi u dijalogu tog reda.
  async function obrisi(ugovorId: string) {
    const fd = new FormData()
    fd.set("id", ugovorId)
    fd.set("klijent_id", klijentId)
    return toastRezultat(await deleteUgovor({ ok: true }, fd), {
      uspjeh: tc("obrisano"),
      greska: tc("greska"),
    })
  }

  return (
    <div className="space-y-3" data-testid="ugovori-sekcija">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden /> {t("naslov")}
          {info && <InfoIkona tekst={info} testId="info-sekcija-ugovori" />}
        </h3>
        <UgovorSheet klijentId={klijentId} />
      </div>
      {ugovori.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("prazno")}</p>
      ) : (
        <PrikaziJosLista
          ulClassName="space-y-2"
          imenicaGenitiv={t("imenica")}
          testId="ugovori-prikazi-jos"
          items={ugovori.map((u) => (
            <li key={u.id} data-testid="ugovor-red" className="rounded-xl border border-border p-3 text-sm transition-colors motion-reduce:transition-none hover:border-border hover:bg-muted/60">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {u.zavodni_broj || t("bezBroja")}
                  {u.aktivan ? (
                    <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">{t("aktivan")}</span>
                  ) : (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("neaktivan")}</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <UgovorSheet klijentId={klijentId} ugovor={u} />
                  {mozeUrediti && (
                    <PotvrdiBrisanjeDialog
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={t("obrisiAriaLabel")} data-testid={`obrisi-ugovor-${u.id}`}>
                          <Trash2 className="h-[18px] w-[18px] shrink-0 text-destructive" aria-hidden />
                        </Button>
                      }
                      naslov={t("obrisiDialogNaslov")}
                      opis={t("obrisiDialogOpis")}
                      onPotvrdi={() => obrisi(u.id)}
                      onUspjeh={() => router.refresh()}
                      testId="obrisi-ugovor-dialog"
                    />
                  )}
                </span>
              </div>
              <div className="mt-1 text-muted-foreground">
                {u.datum_potpisivanja ? formatDatum(u.datum_potpisivanja) : "—"} → {u.datum_isteka ? formatDatum(u.datum_isteka) : "—"}
                {u.broj_obilazaka_mjesecno != null && t("obilazMjesecno", { count: u.broj_obilazaka_mjesecno })}
                {u.vazenje_mjeseci != null && t("vazenjeMjeseci", { count: u.vazenje_mjeseci })}
                {u.automatsko_obnavljanje ? t("autoObnavljanjeDa") : t("autoObnavljanjeNe")}
              </div>
              {u.napomena && <p className="mt-1 text-muted-foreground">{u.napomena}</p>}
            </li>
          ))}
        />
      )}
    </div>
  )
}
