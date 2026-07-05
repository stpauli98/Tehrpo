"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Building2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { postaviDodjele } from "@/app/(dashboard)/postavke/actions"

export function DodjelaKlijenata({
  korisnikId,
  klijenti,
  izabrani,
}: {
  korisnikId: string
  klijenti: { id: string; naziv: string }[]
  izabrani: string[]
}) {
  const t = useTranslations("klijenti.dodjelaKlijenata")
  const tc = useTranslations("common")
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<Set<string>>(() => new Set(izabrani))
  const [q, setQ] = useState("")
  const [pending, start] = useTransition()

  const filtrirani = klijenti.filter((k) => k.naziv.toLowerCase().includes(q.trim().toLowerCase()))

  function toggle(id: string) {
    setSel((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function sacuvaj() {
    start(async () => {
      const r = await postaviDodjele(korisnikId, [...sel])
      if (r.ok) {
        toast.success(t("toastSuccess"))
        setOpen(false)
        router.refresh()
      } else {
        toast.error(r.message ?? t("toastErrorFallback"))
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Pri svakom otvaranju kreni od trenutnog stanja sa servera.
        if (o) {
          setSel(new Set(izabrani))
          setQ("")
        }
        setOpen(o)
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid={`dodjela-${korisnikId}`}>
            <Building2 className="h-3.5 w-3.5" aria-hidden /> {t("dugme", { count: izabrani.length })}
          </Button>
        }
      />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("naslov")}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-slate-500">
          {t("opis")}
        </p>

        <Input
          placeholder={t("pretragaPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid={`dodjela-pretraga-${korisnikId}`}
        />

        <div className="max-h-72 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
          {filtrirani.map((k) => (
            <label key={k.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={sel.has(k.id)} onChange={() => toggle(k.id)} />
              {k.naziv}
            </label>
          ))}
          {filtrirani.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-slate-400">{t("prazno")}</p>
          )}
        </div>

        <DialogFooter className="justify-between">
          <span className="text-xs text-slate-500" data-testid={`dodjela-brojac-${korisnikId}`}>
            {t("brojac", { count: sel.size })}
          </span>
          <div className="flex gap-2">
            <DialogClose render={<Button variant="outline">{tc("otkazi")}</Button>} />
            <Button onClick={sacuvaj} disabled={pending} data-testid={`dodjela-sacuvaj-${korisnikId}`}>
              {pending ? t("submitPending") : tc("sacuvaj")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
