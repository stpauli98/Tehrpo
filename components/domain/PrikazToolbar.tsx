"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"

type Opt = { id: string; naziv: string }

export function PrikazToolbar({ klijenti, godine }: { klijenti: Opt[]; godine: number[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const klijent = params.get("klijent") ?? ""
  const godina = params.get("godina") ?? String(godine[0] ?? "")

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete("selected")
    startTransition(() => router.push(`/prikaz?${next.toString()}`))
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="prikaz-toolbar" data-pending={pending}>
      <Select value={klijent} onValueChange={(v) => setParam("klijent", v ?? "")}>
        <SelectTrigger className="w-72" data-testid="prikaz-klijent"><SelectValue placeholder="Izaberi klijenta" /></SelectTrigger>
        <SelectContent>
          {klijenti.map((k) => <SelectItem key={k.id} value={k.id}>{k.naziv}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={godina} onValueChange={(v) => setParam("godina", v ?? "")}>
        <SelectTrigger className="w-28" data-testid="prikaz-godina"><SelectValue placeholder="Godina" /></SelectTrigger>
        <SelectContent>
          {godine.map((g) => <SelectItem key={g} value={String(g)}>{g}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
