"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KontaktSheet } from "@/components/domain/KontaktSheet"
import { deleteKontakt, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"

type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]
const initial: ActionResult = { ok: true }

export function KontaktiKlijentList({ klijentId, kontakti }: { klijentId: string; kontakti: KontaktRow[] }) {
  const router = useRouter()
  const [delState, delAction, delPending] = useActionState(deleteKontakt, initial)
  const prev = useRef(delState)
  useEffect(() => {
    if (delState !== prev.current) { prev.current = delState; if (delState.ok) router.refresh() }
  }, [delState, router])

  return (
    <div className="space-y-3" data-testid="kontakti-klijent-sekcija">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">Kontakt osobe (firma)</h3>
        <KontaktSheet klijentId={klijentId} />
      </div>
      {kontakti.length === 0 ? (
        <p className="text-sm text-slate-500">Nema kontakata firme.</p>
      ) : (
        <ul className="space-y-2">
          {kontakti.map((k) => (
            <li key={k.id} data-testid="kontakt-red" className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{k.ime}{k.funkcija ? ` · ${k.funkcija}` : ""}</span>
                <span className="flex items-center gap-2">
                  <KontaktSheet klijentId={klijentId} kontakt={k} />
                  <form action={delAction}>
                    <input type="hidden" name="id" value={k.id} />
                    <input type="hidden" name="klijent_id" value={klijentId} />
                    <Button type="submit" variant="ghost" disabled={delPending} aria-label="Obriši kontakt" data-testid={`obrisi-kontakt-${k.id}`}>
                      <Trash2 className="w-4 h-4 text-red-500" aria-hidden />
                    </Button>
                  </form>
                </span>
              </div>
              {(k.telefon || k.email) && (
                <div className="mt-1 text-slate-500">{[k.telefon, k.email].filter(Boolean).join(" · ")}</div>
              )}
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
