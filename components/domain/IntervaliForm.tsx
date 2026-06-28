"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateIntervali, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

type Vrsta = { id: string; naziv: string; interval: number | null }

export function IntervaliForm({ vrste }: { vrste: Vrsta[] }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(updateIntervali, initial)
  const prevState = useRef<ActionResult>(initial)

  useEffect(() => {
    if (!pending && state !== prevState.current) {
      prevState.current = state
      if (state.ok) router.refresh()
    }
  }, [state, pending, router])

  return (
    <form action={(fd) => action(fd)} className="space-y-3" data-testid="intervali-form">
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Vrsta pregleda</th>
              <th className="w-44 px-3 py-2 font-medium">Interval (mjeseci)</th>
            </tr>
          </thead>
          <tbody>
            {vrste.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{v.naziv}</td>
                <td className="px-3 py-2">
                  <Input
                    // Stabilan key uključuje server-vrijednost: kad se interval
                    // promijeni nakon router.refresh(), Input se remountuje umjesto
                    // da mijenja defaultValue uncontrolled polja (Base UI warning).
                    key={`${v.id}:${v.interval ?? ""}`}
                    name={`interval_${v.id}`}
                    type="number"
                    min={1}
                    max={120}
                    defaultValue={v.interval ?? ""}
                    placeholder="—"
                    className="w-28"
                    data-testid={`interval-${v.id}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state.ok === false && state.message && (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      )}

      <Button type="submit" disabled={pending} data-testid="intervali-submit">
        {pending ? "Spremam…" : "Spremi intervale"}
      </Button>
    </form>
  )
}
