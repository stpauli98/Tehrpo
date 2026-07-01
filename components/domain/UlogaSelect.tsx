"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { postaviUlogu } from "@/app/(dashboard)/postavke/actions"

type Uloga = "admin" | "operater" | "pregled"

const ULOGE: { v: Uloga; l: string }[] = [
  { v: "admin", l: "Administrator" },
  { v: "operater", l: "Operater" },
  { v: "pregled", l: "Pregled" },
]

export function UlogaSelect({
  korisnikId,
  uloga,
  jeJa,
}: {
  korisnikId: string
  uloga: Uloga
  jeJa: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <select
      defaultValue={uloga}
      disabled={pending || jeJa}
      title={jeJa ? "Ne možeš mijenjati vlastitu ulogu" : "Promijeni ulogu"}
      data-testid={`uloga-select-${korisnikId}`}
      onChange={(e) => {
        const next = e.target.value as Uloga
        start(async () => {
          const r = await postaviUlogu(korisnikId, next)
          if (r.ok) {
            toast.success("Uloga promijenjena.")
            router.refresh()
          } else {
            toast.error(r.message ?? "Greška.")
            router.refresh() // vrati select na stvarnu vrijednost ako je brana odbila
          }
        })
      }}
      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
    >
      {ULOGE.map((u) => (
        <option key={u.v} value={u.v}>
          {u.l}
        </option>
      ))}
    </select>
  )
}
