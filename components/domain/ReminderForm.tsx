"use client"

import { useActionState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updatePostavke, type ActionResult } from "@/app/(dashboard)/postavke/actions"

const initial: ActionResult = { ok: true }

export function ReminderForm({ danaPrije }: { danaPrije: number[] }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(updatePostavke, initial)
  const submitted = useRef(false)

  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      router.refresh()
    }
  }, [state, pending, router])

  return (
    <form
      action={(fd) => {
        submitted.current = true
        action(fd)
      }}
      className="max-w-md space-y-3"
      data-testid="reminder-form"
    >
      <label className="block text-sm">
        <span className="text-slate-600">Pragovi (dana prije roka, odvojeni zarezom)</span>
        <Input
          name="dana_prije"
          defaultValue={danaPrije.join(", ")}
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
