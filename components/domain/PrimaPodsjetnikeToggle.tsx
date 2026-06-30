"use client"
import { useTransition } from "react"
import { postaviPrimaPodsjetnike } from "@/app/(dashboard)/postavke/actions"
import { toast } from "sonner"

export function PrimaPodsjetnikeToggle({ korisnikId, prima }: { korisnikId: string; prima: boolean }) {
  const [pending, start] = useTransition()
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-600">
      <input
        type="checkbox"
        defaultChecked={prima}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked
          start(async () => {
            const r = await postaviPrimaPodsjetnike(korisnikId, next)
            toast[r.ok ? "success" : "error"](r.ok ? "Sačuvano." : (r.message ?? "Greška."))
          })
        }}
      />
      Prima podsjetnike
    </label>
  )
}
