"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { UgovorSheet } from "@/components/domain/UgovorSheet"
import { deleteUgovor, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import { formatDatum } from "@/lib/date"
import type { Database } from "@/db/types"

type UgovorRow = Database["public"]["Tables"]["ugovori"]["Row"]
const initial: ActionResult = { ok: true }

export function UgovoriTab({ klijentId, ugovori }: { klijentId: string; ugovori: UgovorRow[] }) {
  const router = useRouter()
  const [delState, delAction, delPending] = useActionState(deleteUgovor, initial)
  const prev = useRef(delState)
  useEffect(() => {
    if (delState !== prev.current) { prev.current = delState; if (delState.ok) router.refresh() }
  }, [delState, router])

  return (
    <div className="space-y-3" data-testid="ugovori-sekcija">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">Ugovori</h3>
        <UgovorSheet klijentId={klijentId} />
      </div>
      {ugovori.length === 0 ? (
        <p className="text-sm text-slate-500">Nema ugovora. Dodajte prvi ugovor.</p>
      ) : (
        <ul className="space-y-2">
          {ugovori.map((u) => (
            <li key={u.id} data-testid="ugovor-red" className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {u.zavodni_broj || "Bez broja"}
                  {u.aktivan && <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">aktivan</span>}
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
        </ul>
      )}
      {delState.ok === false && delState.message && (
        <p className="text-sm text-red-600" role="alert">{delState.message}</p>
      )}
    </div>
  )
}
