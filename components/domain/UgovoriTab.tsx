"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Trash2, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InfoIkona } from "@/components/ui/info-ikona"
import { UgovorSheet } from "@/components/domain/UgovorSheet"
import { PrikaziJosLista } from "@/components/domain/PrikaziJosLista"
import { deleteUgovor, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import { formatDatum } from "@/lib/date"
import type { Database } from "@/db/types"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
const initial: ActionResult = { ok: true }

export function UgovoriTab({ klijentId, ugovori, info }: { klijentId: string; ugovori: UgovorRow[]; info?: string }) {
  const router = useRouter()
  const [delState, delAction, delPending] = useActionState(deleteUgovor, initial)
  const prev = useRef(delState)
  useEffect(() => {
    if (delState !== prev.current) { prev.current = delState; if (delState.ok) router.refresh() }
  }, [delState, router])

  return (
    <div className="space-y-3" data-testid="ugovori-sekcija">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <FileText className="h-4 w-4 text-slate-400" aria-hidden /> Ugovori
          {info && <InfoIkona tekst={info} testId="info-sekcija-ugovori" />}
        </h3>
        <UgovorSheet klijentId={klijentId} />
      </div>
      {ugovori.length === 0 ? (
        <p className="text-sm text-slate-500">Nema ugovora. Dodajte prvi ugovor.</p>
      ) : (
        <PrikaziJosLista
          ulClassName="space-y-2"
          imenicaGenitiv="ugovora"
          testId="ugovori-prikazi-jos"
          items={ugovori.map((u) => (
            <li key={u.id} data-testid="ugovor-red" className="rounded-xl border border-slate-200 p-3 text-sm transition-colors hover:border-slate-300 hover:bg-slate-50/60">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {u.zavodni_broj || "Bez broja"}
                  {u.aktivan ? (
                    <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">aktivan</span>
                  ) : (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">neaktivan</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <UgovorSheet klijentId={klijentId} ugovor={u} />
                  <form action={delAction}>
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="klijent_id" value={klijentId} />
                    <Button type="submit" variant="ghost" disabled={delPending} aria-label="Obriši ugovor" data-testid={`obrisi-ugovor-${u.id}`}>
                      <Trash2 className="w-4 h-4 text-red-500" aria-hidden />
                    </Button>
                  </form>
                </span>
              </div>
              <div className="mt-1 text-slate-500">
                {u.datum_potpisivanja ? formatDatum(u.datum_potpisivanja) : "—"} → {u.datum_isteka ? formatDatum(u.datum_isteka) : "—"}
                {u.broj_obilazaka_mjesecno != null && ` · ${u.broj_obilazaka_mjesecno} obilaz./mj.`}
              </div>
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
