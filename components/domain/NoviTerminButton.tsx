"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { createTermin, type ActionResult } from "@/app/(dashboard)/termini/actions"
import { useMozeUrediti } from "@/providers/korisnik-provider"
import { jeZakazanoPoslijeRoka, danaPoslijeRoka } from "@/lib/plan-datum"
import { formatDatum } from "@/lib/date"

type Opt = { id: string; naziv: string }
const initial: ActionResult = { ok: true }

export function NoviTerminButton({
  klijenti,
  vrste,
  lokacijeByFirma,
}: {
  klijenti: Opt[]
  vrste: Opt[]
  lokacijeByFirma: Record<string, Opt[]>
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const t = useTranslations("termini.noviTermin")
  const tc = useTranslations("common")
  const [open, setOpen] = useState(false)
  const [klijentId, setKlijentId] = useState("")
  const [vrstaId, setVrstaId] = useState("")
  const [lokacijaId, setLokacijaId] = useState("")
  const [rok, setRok] = useState("")
  const [zakazan, setZakazan] = useState("")
  const tz = useTranslations("termini.zakazanoUpozorenje")
  const [state, action, pending] = useActionState(createTermin, initial)
  const submitted = useRef(false)
  const mozeUrediti = useMozeUrediti()

  const lokacije = klijentId ? lokacijeByFirma[klijentId] ?? [] : []

  // items mape (value→label) za base-ui SelectValue (prikaz labele kad je zatvoreno)
  const klijentItems: Record<string, string> = Object.fromEntries(klijenti.map((k) => [k.id, k.naziv]))
  const vrstaItems: Record<string, string> = Object.fromEntries(vrste.map((v) => [v.id, v.naziv]))
  const lokacijaItems: Record<string, string> = Object.fromEntries(lokacije.map((l) => [l.id, l.naziv]))

  // Zatvori sheet TEK nakon stvarnog submita koji je uspio (submitted ref
  // razlikuje uspjeh od initial { ok: true } stanja).
  // Optimistički uvećaj stats.ukupno u svim cached lista upitima, pa pokreni
  // background refetch da se potvrdi stvarna vrijednost iz baze.
  useEffect(() => {
    if (submitted.current && !pending && state.ok) {
      submitted.current = false
      // Optimistic update — sync, tako da Playwright vidi novu vrijednost odmah
      queryClient.setQueriesData({ queryKey: ["termini-lista"] }, (old: unknown) => {
        if (!old || typeof old !== "object" || !("stats" in old)) return old
        const data = old as { stats: { ukupno: number } | null }
        if (!data.stats) return old
        return { ...data, stats: { ...data.stats, ukupno: data.stats.ukupno + 1 } }
      })
      setOpen(false)
      setKlijentId("")
      setVrstaId("")
      setLokacijaId("")
      setRok("")
      setZakazan("")
      void queryClient.invalidateQueries({ queryKey: ["termini-lista"] })
      // Novi termin pripada i matrica/kalendar prikazima (rok_dospijeca); ti su keševi
      // perzistentni preko view-switch-a (staleTime 60s), pa ih eksplicitno invalidiraj
      // da se novi termin vidi pri povratku na te prikaze (mirror TerminSheet handlera).
      void queryClient.invalidateQueries({ queryKey: ["termini-matrica"] })
      void queryClient.invalidateQueries({ queryKey: ["termini-kalendar"] })
      router.refresh()
    }
  }, [state, pending, router, queryClient])

  if (!mozeUrediti) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button data-testid="novi-termin-btn">
            <Plus className="w-4 h-4" aria-hidden /> {t("dugme")}
          </Button>
        }
      />
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="novi-termin-sheet"
      >
        <DialogHeader>
          <DialogTitle>{t("dugme")}</DialogTitle>
        </DialogHeader>

        <form
          action={(fd) => {
            fd.set("klijent_id", klijentId)
            fd.set("vrsta_provjere_id", vrstaId)
            if (lokacijaId) fd.set("lokacija_id", lokacijaId)
            submitted.current = true
            action(fd)
          }}
          className="space-y-3"
          data-testid="novi-termin-form"
        >
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeKlijent")}</span>
            <Select
              value={klijentId}
              onValueChange={(v) => {
                setKlijentId(v ?? "")
                setLokacijaId("") // reset lokacije kad se promijeni firma
              }}
              items={klijentItems}
            >
              <SelectTrigger className="w-full" data-testid="novi-klijent">
                <SelectValue placeholder={t("placeholderKlijent")} />
              </SelectTrigger>
              <SelectContent>
                {klijenti.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    <span className="whitespace-normal">{k.naziv}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {lokacije.length > 0 && (
            <label className="block text-sm">
              <span className="text-muted-foreground">{t("poljeLokacija")}</span>
              <Select value={lokacijaId} onValueChange={(v) => setLokacijaId(v ?? "")} items={lokacijaItems}>
                <SelectTrigger className="w-full" data-testid="novi-lokacija">
                  <SelectValue placeholder={t("placeholderLokacija")} />
                </SelectTrigger>
                <SelectContent>
                  {lokacije.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      <span className="whitespace-normal">{l.naziv}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeVrsta")}</span>
            <Select value={vrstaId} onValueChange={(v) => setVrstaId(v ?? "")} items={vrstaItems}>
              <SelectTrigger className="w-full" data-testid="novi-vrsta">
                <SelectValue placeholder={t("placeholderVrsta")} />
              </SelectTrigger>
              <SelectContent>
                {vrste.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    <span className="whitespace-normal">{v.naziv}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeRok")}</span>
            <Input type="date" name="rok_dospijeca" required value={rok}
              onChange={(e) => setRok(e.target.value)} data-testid="novi-rok" />
          </label>

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeDatumZakazan")}</span>
            <Input type="date" name="datum_zakazan" value={zakazan}
              onChange={(e) => setZakazan(e.target.value)} data-testid="novi-zakazan" />
          </label>
          {jeZakazanoPoslijeRoka(rok, zakazan) && (
            <p className="text-xs text-amber-700" role="status" data-testid="zakazano-poslije-roka">
              {tz("poslijeRoka", { dana: danaPoslijeRoka(rok, zakazan), rok: formatDatum(rok) })}
            </p>
          )}

          <label className="block text-sm">
            <span className="text-muted-foreground">{t("poljeZaduzeni")}</span>
            <Input name="zaduzeni" placeholder={t("placeholderZaduzeni")} data-testid="novi-zaduzeni" />
          </label>

          {state.ok === false && state.message && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}

          <Button type="submit" disabled={pending} data-testid="novi-submit">
            {pending ? t("kreiram") : t("kreirajTermin")}
          </Button>
        </form>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" data-testid="novi-cancel">
                {tc("otkazi")}
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
