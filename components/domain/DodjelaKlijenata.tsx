"use client"
import { useState, useTransition } from "react"
import { postaviDodjele } from "@/app/(dashboard)/postavke/actions"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export function DodjelaKlijenata({
  korisnikId, klijenti, izabrani,
}: { korisnikId: string; klijenti: { id: string; naziv: string }[]; izabrani: string[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set(izabrani))
  const [pending, start] = useTransition()
  function toggle(id: string) {
    setSel((p) => {
      const n = new Set(p)
      if (n.has(id)) { n.delete(id) } else { n.add(id) }
      return n
    })
  }
  function sacuvaj() {
    start(async () => {
      const r = await postaviDodjele(korisnikId, [...sel])
      toast[r.ok ? "success" : "error"](r.ok ? "Dodjele snimljene." : (r.message ?? "Greška."))
    })
  }
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-brand">Dodijeljeni klijenti ({sel.size})</summary>
      <div className="mt-2 max-h-48 overflow-auto rounded border border-slate-100 p-2 space-y-1">
        {klijenti.map((k) => (
          <label key={k.id} className="flex items-center gap-2">
            <input type="checkbox" checked={sel.has(k.id)} onChange={() => toggle(k.id)} />
            {k.naziv}
          </label>
        ))}
      </div>
      <Button size="sm" className="mt-2" onClick={sacuvaj} disabled={pending}>
        {pending ? "Snimanje…" : "Sačuvaj dodjele"}
      </Button>
    </details>
  )
}
