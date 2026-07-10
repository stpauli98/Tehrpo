"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Trash2, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InfoIkona } from "@/components/ui/info-ikona"
import { UgovorSheet } from "@/components/domain/UgovorSheet"
import { PrikaziJosLista } from "@/components/domain/PrikaziJosLista"
import { deleteUgovor, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import { formatDatum } from "@/lib/date"
import { useMozeUrediti } from "@/providers/korisnik-provider"
import type { Database } from "@/db/types"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
const initial: ActionResult = { ok: true }

export function UgovoriTab({ klijentId, ugovori, info }: { klijentId: string; ugovori: UgovorRow[]; info?: string }) {
  const t = useTranslations("klijenti.ugovori")
  const router = useRouter()
  const mozeUrediti = useMozeUrediti()
  const [delState, delAction, delPending] = useActionState(deleteUgovor, initial)
  const prev = useRef(delState)
  useEffect(() => {
    if (delState !== prev.current) { prev.current = delState; if (delState.ok) router.refresh() }
  }, [delState, router])

  return (
    <div className="space-y-3" data-testid="ugovori-sekcija">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <FileText className="h-4 w-4 text-slate-400" aria-hidden /> {t("naslov")}
          {info && <InfoIkona tekst={info} testId="info-sekcija-ugovori" />}
        </h3>
        <UgovorSheet klijentId={klijentId} />
      </div>
      {ugovori.length === 0 ? (
        <p className="text-sm text-slate-500">{t("prazno")}</p>
      ) : (
        <PrikaziJosLista
          ulClassName="space-y-2"
          imenicaGenitiv={t("imenica")}
          testId="ugovori-prikazi-jos"
          items={ugovori.map((u) => (
            <li key={u.id} data-testid="ugovor-red" className="rounded-xl border border-slate-200 p-3 text-sm transition-colors hover:border-slate-300 hover:bg-slate-50/60">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {u.zavodni_broj || t("bezBroja")}
                  {u.aktivan ? (
                    <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">{t("aktivan")}</span>
                  ) : (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{t("neaktivan")}</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <UgovorSheet klijentId={klijentId} ugovor={u} />
                  {mozeUrediti && (
                    <form action={delAction}>
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="klijent_id" value={klijentId} />
                      <Button type="submit" variant="ghost" disabled={delPending} aria-label={t("obrisiAriaLabel")} data-testid={`obrisi-ugovor-${u.id}`}>
                        <Trash2 className="w-4 h-4 text-red-500" aria-hidden />
                      </Button>
                    </form>
                  )}
                </span>
              </div>
              <div className="mt-1 text-slate-500">
                {u.datum_potpisivanja ? formatDatum(u.datum_potpisivanja) : "—"} → {u.datum_isteka ? formatDatum(u.datum_isteka) : "—"}
                {u.broj_obilazaka_mjesecno != null && t("obilazMjesecno", { count: u.broj_obilazaka_mjesecno })}
                {u.vazenje_mjeseci != null && t("vazenjeMjeseci", { count: u.vazenje_mjeseci })}
                {u.automatsko_obnavljanje ? t("autoObnavljanjeDa") : t("autoObnavljanjeNe")}
              </div>
              {u.napomena && <p className="mt-1 text-slate-500">{u.napomena}</p>}
            </li>
          ))}
        />
      )}
      {delState.ok === false && delState.message && (
        <p className="text-sm text-red-600" role="alert">{delState.message}</p>
      )}
    </div>
  )
}
