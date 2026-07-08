"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { X, Plus } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateKlijentPodsjetnici } from "@/app/(dashboard)/klijenti/[id]/actions"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function KlijentPodsjetniciForm({
  klijentId, salji, emails,
}: { klijentId: string; salji: boolean; emails: string[] }) {
  const t = useTranslations("klijenti.podsjetnici")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [saljiState, setSalji] = useState(salji)
  const [lista, setLista] = useState<string[]>(emails)
  const [nova, setNova] = useState("")
  const [greska, setGreska] = useState<string | null>(null)

  function spasi(nextSalji: boolean, nextLista: string[]) {
    startTransition(async () => {
      const res = await updateKlijentPodsjetnici(klijentId, nextSalji, nextLista)
      if (res.ok) { toast.success(t("spaseno")); router.refresh() }
      else toast.error(res.message)
    })
  }

  function dodaj() {
    const e = nova.trim().toLowerCase()
    if (!EMAIL_RE.test(e)) { setGreska(t("emailNeispravan")); return }
    if (lista.includes(e)) { setNova(""); return }
    setGreska(null)
    const next = [...lista, e]
    setLista(next); setNova("")
    spasi(saljiState, next)
  }

  function ukloni(e: string) {
    const next = lista.filter((x) => x !== e)
    setLista(next); spasi(saljiState, next)
  }

  return (
    <div className="max-w-xl space-y-4" data-testid="klijent-podsjetnici-form">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={saljiState}
          disabled={pending}
          data-testid="klijent-salji-toggle"
          className="mt-0.5 h-4 w-4 cursor-pointer accent-brand disabled:opacity-50"
          onChange={(e) => { setSalji(e.target.checked); spasi(e.target.checked, lista) }}
        />
        <span>
          <span className="block text-sm font-medium">{t("saljiNaslov")}</span>
          <span className="block text-sm text-slate-500">{t("saljiOpis")}</span>
        </span>
      </label>

      <div>
        <p className="mb-2 text-sm font-medium">{t("adreseNaslov")}</p>
        <div className="flex flex-wrap gap-2">
          {lista.map((e) => (
            <span key={e} data-testid={`klijent-email-${e}`}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white py-1 pl-3 pr-1.5 text-sm text-slate-600">
              {e}
              <button type="button" onClick={() => ukloni(e)} disabled={pending}
                aria-label={t("ukloniAdresu", { email: e })}
                className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          ))}
          {lista.length === 0 && <span className="text-sm text-slate-400">{t("nemaAdresa")}</span>}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Input type="email" value={nova} onChange={(e) => setNova(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); dodaj() } }}
            placeholder={t("adresaPlaceholder")} className="w-64" data-testid="klijent-email-input" />
          <Button type="button" variant="outline" size="sm" onClick={dodaj} disabled={pending} data-testid="klijent-email-add">
            <Plus className="h-4 w-4" aria-hidden /> {t("dodaj")}
          </Button>
        </div>
        {greska && <p className="mt-1 text-sm text-red-600" role="alert">{greska}</p>}
      </div>
    </div>
  )
}
