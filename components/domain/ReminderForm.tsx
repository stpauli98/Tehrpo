"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updatePostavke, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

export function ReminderForm({ danaPrije }: { danaPrije: number[] }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(updatePostavke, initial)
  // Controlled value — user typing always wins; never overwritten by async effects.
  const [value, setValue] = useState(() => danaPrije.join(", "))
  const prevState = useRef<ActionResult>(initial)

  useEffect(() => {
    // Fire once when the action produces a new result
    if (!pending && state !== prevState.current) {
      prevState.current = state
      if (state.ok) {
        // Background-refresh the server component (e.g. to sync nav/badges).
        // Do NOT call setValue here — user may have already started typing the next value.
        router.refresh()
      }
    }
  }, [state, pending, router])

  return (
    <form
      action={(fd) => {
        action(fd)
      }}
      className="max-w-md space-y-3"
      data-testid="reminder-form"
    >
      <label className="block text-sm">
        <span className="text-slate-600">Pragovi (dana prije roka, odvojeni zarezom)</span>
        <Input
          name="dana_prije"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          data-testid="reminder-dana-prije"
        />
      </label>

      {state.ok === false && (state.message || state.errors?.dana_prije?.[0]) && (
        <p className="text-sm text-red-600" role="alert">
          {state.message ?? state.errors?.dana_prije?.[0]}
        </p>
      )}

      <Button type="submit" disabled={pending} data-testid="reminder-submit">
        {pending ? "Spremam…" : "Spremi"}
      </Button>
    </form>
  )
}
