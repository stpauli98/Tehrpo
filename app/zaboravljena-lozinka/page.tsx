"use client"
import { Suspense } from "react"
import { useActionState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { posaljiReset, type ActionResult } from "./actions"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const initial: ActionResult = { ok: false }

function ZaboravljenaLozinkaForm() {
  const [state, action, pending] = useActionState(posaljiReset, initial)
  const istekao = useSearchParams().get("greska") === "istekao"
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <form action={action} className="w-80 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <h1 className="text-lg font-medium">Reset lozinke</h1>
        {istekao && (
          <p className="text-sm text-amber-700" role="alert">
            Link je istekao ili je nevažeći. Unesite email da pošaljemo novi.
          </p>
        )}
        <Input name="email" type="email" placeholder="Email" required />
        {state.message && <p className="text-sm text-slate-600" role="status">{state.message}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Slanje…" : "Pošalji link"}
        </Button>
        <Link href="/prijava" className="block text-center text-xs text-slate-500 hover:underline">Nazad na prijavu</Link>
      </form>
    </div>
  )
}

export default function ZaboravljenaLozinkaPage() {
  return (
    <Suspense fallback={null}>
      <ZaboravljenaLozinkaForm />
    </Suspense>
  )
}
