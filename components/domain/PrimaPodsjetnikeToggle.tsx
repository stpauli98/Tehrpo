"use client"
import { useTransition } from "react"
import { postaviPrimaPodsjetnike } from "@/app/(dashboard)/postavke/actions"
import { toast } from "sonner"

export function PrimaPodsjetnikeToggle({ korisnikId, prima }: { korisnikId: string; prima: boolean }) {
  const [pending, start] = useTransition()
  return (
    <input
      type="checkbox"
      defaultChecked={prima}
      disabled={pending}
      aria-label="Prima email podsjetnike"
      title="Prima email podsjetnike"
      className="h-4 w-4 cursor-pointer accent-brand disabled:opacity-50"
      onChange={(e) => {
        const next = e.target.checked
        start(async () => {
          const r = await postaviPrimaPodsjetnike(korisnikId, next)
          toast[r.ok ? "success" : "error"](r.ok ? "Sačuvano." : (r.message ?? "Greška."))
        })
      }}
    />
  )
}
