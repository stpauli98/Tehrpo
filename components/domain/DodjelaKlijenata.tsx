"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Building2 } from "lucide-react"
import { toastRezultat } from "@/components/akcija-toast"
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
import { Checkbox } from "@/components/ui/checkbox"
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
  const t = useTranslations("postavke.dodjelaKlijenata")
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
      const r = toastRezultat(await postaviDodjele(korisnikId, [...sel]), {
        uspjeh: t("toastSuccess"),
        greska: t("toastErrorFallback"),
      })
      if (r.ok) {
        setOpen(false)
        router.refresh()
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
            <Building2 className="h-[18px] w-[18px] shrink-0" aria-hidden /> {t("dugme", { count: izabrani.length })}
          </Button>
        }
      />
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("naslov")}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t("opis")}
        </p>

        <Input
          placeholder={t("pretragaPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid={`dodjela-pretraga-${korisnikId}`}
        />

        <div className="max-h-72 divide-y divide-border overflow-auto rounded-xl bg-card ring-1 ring-foreground/10">
          {filtrirani.map((k) => (
            <label key={k.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
              <Checkbox
                checked={sel.has(k.id)}
                onCheckedChange={() => toggle(k.id)}
                aria-label={t("checkboxAriaLabel", { naziv: k.naziv })}
              />
              {k.naziv}
            </label>
          ))}
          {filtrirani.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t("prazno")}</p>
          )}
        </div>

        <DialogFooter className="justify-between">
          <span className="text-xs text-muted-foreground" data-testid={`dodjela-brojac-${korisnikId}`}>
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
