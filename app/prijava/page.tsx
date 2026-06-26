"use client"
import { useActionState } from "react"
import { prijaviSe, type ActionResult } from "./actions"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const initial: ActionResult = { ok: true }

export default function PrijavaPage() {
  const [state, action, pending] = useActionState(prijaviSe, initial)
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <form action={action} className="w-80 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-brand text-white text-xs font-bold grid place-items-center">T</div>
          <span className="font-semibold">Tehpro</span>
        </div>
        <h1 className="text-lg font-medium">Prijava</h1>
        <Input name="email" type="email" placeholder="Email" autoComplete="username" required />
        <Input name="lozinka" type="password" placeholder="Lozinka" autoComplete="current-password" required />
        {state.ok === false && state.message && (
          <p className="text-sm text-status-kasni" role="alert">{state.message}</p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Prijava…" : "Prijavi se"}
        </Button>
        <a href="/zaboravljena-lozinka" className="block text-center text-xs text-slate-500 hover:underline">
          Zaboravljena lozinka?
        </a>
      </form>
    </div>
  )
}
