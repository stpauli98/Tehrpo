"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Trash2, Users, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { KontaktSheet } from "@/components/domain/KontaktSheet"
import { deleteKontakt, type ActionResult } from "@/app/(dashboard)/klijenti/actions"
import type { Database } from "@/db/types"

type KontaktRow = Database["public"]["Tables"]["kontakt_osobe"]["Row"]
const initial: ActionResult = { ok: true }

export function KontaktiKlijentList({
  klijentId,
  kontakti,
  searchable = false,
  previewLimit,
  seeAllHref,
}: {
  klijentId: string
  kontakti: KontaktRow[]
  searchable?: boolean
  previewLimit?: number
  seeAllHref?: string
}) {
  const router = useRouter()
  const [delState, delAction, delPending] = useActionState(deleteKontakt, initial)
  const prev = useRef(delState)
  const [q, setQ] = useState("")
  useEffect(() => {
    if (delState !== prev.current) { prev.current = delState; if (delState.ok) router.refresh() }
  }, [delState, router])

  const t = q.trim().toLowerCase()
  const filtrirani =
    searchable && t
      ? kontakti.filter((k) => k.ime.toLowerCase().includes(t) || (k.funkcija ?? "").toLowerCase().includes(t))
      : kontakti
  const vidljivi = previewLimit ? filtrirani.slice(0, previewLimit) : filtrirani
  const ostatak = filtrirani.length - vidljivi.length

  return (
    <div className="space-y-3" data-testid="kontakti-klijent-sekcija">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Users className="h-4 w-4 text-slate-400" aria-hidden /> Kontakt osobe (firma)
        </h3>
        <KontaktSheet klijentId={klijentId} />
      </div>

      {searchable && kontakti.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pretraži po imenu ili funkciji…"
            className="pl-8"
            data-testid="kontakti-pretraga"
          />
        </div>
      )}

      {kontakti.length === 0 ? (
        <p className="text-sm text-slate-500">Nema kontakata firme.</p>
      ) : filtrirani.length === 0 ? (
        <p className="text-sm text-slate-400">Nema kontakata za „{q}”.</p>
      ) : (
        <ul className="space-y-2">
          {vidljivi.map((k) => (
            <li key={k.id} data-testid="kontakt-red" className="rounded-xl border border-slate-200 p-3 text-sm transition-colors hover:border-slate-300 hover:bg-slate-50/60">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {k.ime}
                  {k.funkcija && <span className="font-normal text-slate-500"> · {k.funkcija}</span>}
                </span>
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

      {previewLimit && seeAllHref && ostatak > 0 && (
        <Link
          href={seeAllHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
          data-testid="kontakti-vidi-sve"
        >
          Vidi sve ({filtrirani.length}) →
        </Link>
      )}

      {delState.ok === false && delState.message && (
        <p className="text-sm text-red-600" role="alert">{delState.message}</p>
      )}
    </div>
  )
}
