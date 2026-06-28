"use client"

import { useActionState, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { X, Plus, Bell } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updatePostavke, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

// Uobičajeni pragovi za brzi izbor (0 = na dan roka)
const PRESETS = [30, 14, 10, 7, 3, 1, 0]

function labelFor(n: number): string {
  if (n === 0) return "na dan roka"
  if (n === 1) return "1 dan prije"
  return `${n} dana prije`
}

function presetLabel(n: number): string {
  if (n === 0) return "na dan"
  return `${n}d`
}

function sortedDesc(set: Set<number>): number[] {
  return Array.from(set).sort((a, b) => b - a)
}

export function ReminderForm({ danaPrije }: { danaPrije: number[] }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(updatePostavke, initial)
  const [pragovi, setPragovi] = useState<Set<number>>(() => new Set(danaPrije))
  const [custom, setCustom] = useState("")
  const [customError, setCustomError] = useState<string | null>(null)
  const prevState = useRef<ActionResult>(initial)

  useEffect(() => {
    if (!pending && state !== prevState.current) {
      prevState.current = state
      if (state.ok) router.refresh()
    }
  }, [state, pending, router])

  const lista = useMemo(() => sortedDesc(pragovi), [pragovi])
  const hiddenValue = lista.join(", ")

  function toggle(n: number) {
    setPragovi((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  function remove(n: number) {
    setPragovi((prev) => {
      const next = new Set(prev)
      next.delete(n)
      return next
    })
  }

  function addCustom() {
    const s = custom.trim()
    if (s === "") return
    const n = Number(s)
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      setCustomError("Unesite cijeli broj dana 0–365")
      return
    }
    setCustomError(null)
    setPragovi((prev) => new Set(prev).add(n))
    setCustom("")
  }

  return (
    <form
      action={(fd) => action(fd)}
      className="max-w-xl space-y-4"
      data-testid="reminder-form"
    >
      <input type="hidden" name="dana_prije" value={hiddenValue} />

      {/* Brzi izbor pragova */}
      <div>
        <p className="mb-2 text-sm text-slate-600">Kad se šalje podsjetnik prije roka:</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((n) => {
            const active = pragovi.has(n)
            return (
              <button
                key={n}
                type="button"
                onClick={() => toggle(n)}
                aria-pressed={active}
                data-testid={`reminder-preset-${n}`}
                className={
                  "rounded-full border px-3 py-1 text-sm transition-colors " +
                  (active
                    ? "border-brand bg-brand text-white"
                    : "border-slate-300 bg-white text-slate-600 hover:border-slate-400")
                }
              >
                {presetLabel(n)}
              </button>
            )
          })}
        </div>
      </div>

      {/* Aktivni pragovi (chips) */}
      <div>
        <p className="mb-2 text-sm text-slate-600">Aktivni podsjetnici:</p>
        {lista.length === 0 ? (
          <p className="text-sm text-amber-600" data-testid="reminder-empty">
            Nijedan podsjetnik nije izabran — neće se slati emailovi.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" data-testid="reminder-chips">
            {lista.map((n) => (
              <span
                key={n}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1 text-sm text-brand-dark"
                data-testid={`reminder-chip-${n}`}
              >
                {labelFor(n)}
                <button
                  type="button"
                  onClick={() => remove(n)}
                  aria-label={`Ukloni ${labelFor(n)}`}
                  data-testid={`reminder-chip-remove-${n}`}
                  className="rounded-full p-0.5 hover:bg-brand/20"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Custom dodavanje */}
      <div>
        <p className="mb-2 text-sm text-slate-600">Dodaj drugi prag:</p>
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
                addCustom()
              }
            }}
            placeholder="npr. 21"
            className="w-28"
            data-testid="reminder-custom-input"
          />
          <span className="text-sm text-slate-500">dana</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCustom}
            data-testid="reminder-custom-add"
          >
            <Plus className="h-4 w-4" aria-hidden /> Dodaj
          </Button>
        </div>
        {customError && (
          <p className="mt-1 text-sm text-red-600" role="alert">
            {customError}
          </p>
        )}
      </div>

      {/* Sažetak */}
      {lista.length > 0 && (
        <p
          className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600"
          data-testid="reminder-summary"
        >
          <Bell className="h-4 w-4 text-slate-400" aria-hidden />
          Podsjetnik se šalje: {lista.map(labelFor).join(", ")}.
        </p>
      )}

      {state.ok === false && (state.message || state.errors?.dana_prije?.[0]) && (
        <p className="text-sm text-red-600" role="alert">
          {state.message ?? state.errors?.dana_prije?.[0]}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending || lista.length === 0}
        data-testid="reminder-submit"
      >
        {pending ? "Spremam…" : "Spremi"}
      </Button>
    </form>
  )
}
