"use client"

import { useActionState, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { X, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { updatePostavke, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

// Uobičajeni pragovi koji se nude u brzom izboru (0 = na dan roka).
const DEFAULT_OPCIJE = [30, 14, 10, 7, 3, 1, 0]

function labelFor(n: number): string {
  if (n === 0) return "na dan"
  if (n === 1) return "1 dan"
  return `${n} dana`
}

function sortedDesc(arr: number[]): number[] {
  return Array.from(new Set(arr)).sort((a, b) => b - a)
}

export function ReminderForm({ danaPrije }: { danaPrije: number[] }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(updatePostavke, initial)
  const [opcije, setOpcije] = useState<number[]>(() => sortedDesc([...DEFAULT_OPCIJE, ...danaPrije]))
  const [selected, setSelected] = useState<Set<number>>(() => new Set(danaPrije))
  const [custom, setCustom] = useState("")
  const [customError, setCustomError] = useState<string | null>(null)
  const prevState = useRef<ActionResult>(initial)

  useEffect(() => {
    if (!pending && state !== prevState.current) {
      prevState.current = state
      if (state.ok) router.refresh()
    }
  }, [state, pending, router])

  const aktivni = useMemo(() => sortedDesc([...selected]), [selected])
  const hiddenValue = aktivni.join(", ")

  function toggle(n: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  function ukloniOpciju(n: number) {
    setOpcije((prev) => prev.filter((x) => x !== n))
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(n)
      return next
    })
  }

  function dodaj() {
    const s = custom.trim()
    if (s === "") return
    const n = Number(s)
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      setCustomError("Unesite cijeli broj dana 0–365")
      return
    }
    setCustomError(null)
    setOpcije((prev) => sortedDesc([...prev, n]))
    setSelected((prev) => new Set(prev).add(n))
    setCustom("")
  }

  return (
    <form action={(fd) => action(fd)} className="max-w-xl space-y-4" data-testid="reminder-form">
      <input type="hidden" name="dana_prije" value={hiddenValue} />

      <div>
        <p className="mb-2 text-sm text-slate-600">
          Klikni prag da uključiš/isključiš slanje.{" "}
          <span className="text-slate-400">× uklanja opciju.</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {opcije.map((n) => {
            const active = selected.has(n)
            return (
              <span
                key={n}
                data-testid={`reminder-chip-${n}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border py-1 pl-3 pr-1.5 text-sm transition-colors",
                  active
                    ? "border-brand bg-brand text-white shadow-sm"
                    : "border-slate-300 bg-white text-slate-600",
                )}
              >
                <button
                  type="button"
                  onClick={() => toggle(n)}
                  aria-pressed={active}
                  data-testid={`reminder-preset-${n}`}
                  className="cursor-pointer"
                >
                  {labelFor(n)}
                </button>
                <button
                  type="button"
                  onClick={() => ukloniOpciju(n)}
                  aria-label={`Ukloni ${labelFor(n)}`}
                  data-testid={`reminder-chip-remove-${n}`}
                  className={cn(
                    "rounded-full p-0.5 transition-colors",
                    active
                      ? "text-white/80 hover:bg-white/20 hover:text-white"
                      : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
                  )}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </span>
            )
          })}
        </div>
      </div>

      {/* Dodaj novi prag */}
      <div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={365}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                dodaj()
              }
            }}
            placeholder="npr. 21"
            className="w-28"
            data-testid="reminder-custom-input"
          />
          <span className="text-sm text-slate-500">dana prije</span>
          <Button type="button" variant="outline" size="sm" onClick={dodaj} data-testid="reminder-custom-add">
            <Plus className="h-4 w-4" aria-hidden /> Dodaj
          </Button>
        </div>
        {customError && (
          <p className="mt-1 text-sm text-red-600" role="alert">
            {customError}
          </p>
        )}
      </div>

      {aktivni.length === 0 && (
        <p className="text-sm text-amber-600" data-testid="reminder-empty">
          Nijedan prag nije uključen — emailovi se neće slati.
        </p>
      )}

      {state.ok === false && (state.message || state.errors?.dana_prije?.[0]) && (
        <p className="text-sm text-red-600" role="alert">
          {state.message ?? state.errors?.dana_prije?.[0]}
        </p>
      )}

      <Button type="submit" disabled={pending || aktivni.length === 0} data-testid="reminder-submit">
        {pending ? "Spremam…" : "Spremi"}
      </Button>
    </form>
  )
}
