"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Check, Minus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { VrstaSheet } from "./VrstaSheet"
import { toastRezultat } from "@/components/akcija-toast"
import { postaviVrstaInterval, postaviVrstaAktivna } from "@/app/(dashboard)/postavke/actions"

type Vrsta = {
  id: string
  naziv: string
  interval: number | null
  zakonski_osnov: string | null
  aktivna: boolean
  vodi_dokumentaciju: boolean
}

export function VrstePregledaTabela({ vrste }: { vrste: Vrsta[] }) {
  const t = useTranslations("termini.vrstePregleda")
  const tKolone = useTranslations("termini.vrstePregleda.kolone")
  const [prikaziNeaktivne, setPrikaziNeaktivne] = useState(false)
  const brNeaktivnih = vrste.filter((v) => !v.aktivna).length
  const vidljive = prikaziNeaktivne ? vrste : vrste.filter((v) => v.aktivna)

  return (
    <div className="space-y-3" data-testid="vrste-tabela">
      <div className="flex items-center justify-between gap-4 text-sm">
        <label className="flex items-center gap-2 text-muted-foreground">
          <Checkbox
            checked={prikaziNeaktivne}
            onCheckedChange={(next) => setPrikaziNeaktivne(next)}
            data-testid="vrste-prikazi-neaktivne"
          />
          {t("prikaziNeaktivne")}{brNeaktivnih > 0 && ` (${brNeaktivnih})`}
        </label>
        <span className="text-muted-foreground">{t("brojVrsta", { count: vidljive.length })}</span>
      </div>

      <div className="max-h-96 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{tKolone("vrsta")}</th>
              <th className="w-44 px-3 py-2 font-medium">{tKolone("interval")}</th>
              <th className="w-16 px-3 py-2 text-center font-medium">{tKolone("dokumentacija")}</th>
              <th className="w-32 px-3 py-2 font-medium">{tKolone("status")}</th>
              <th className="w-20 px-3 py-2 text-right font-medium">{tKolone("akcije")}</th>
            </tr>
          </thead>
          <tbody data-testid="vrste-lista">
            {vidljive.map((v) => (
              <tr key={v.id} className={cn("border-t border-border", !v.aktivna && "bg-muted/60")}>
                <td className="px-3 py-2">
                  <div className={cn("font-medium", !v.aktivna && "text-muted-foreground line-through")}>{v.naziv}</div>
                  {v.zakonski_osnov && <div className="text-xs text-muted-foreground">{v.zakonski_osnov}</div>}
                </td>
                <td className="px-3 py-2">
                  <IntervalCell vrsta={v} />
                </td>
                <td className="px-3 py-2 text-center">
                  {v.vodi_dokumentaciju ? (
                    <span className="inline-flex text-muted-foreground" title={t("vodiDokumentacijuTitle")}>
                      <Check className="h-[18px] w-[18px] shrink-0" aria-label={t("vodiDokumentacijuTitle")} />
                    </span>
                  ) : (
                    <span className="inline-flex text-muted-foreground/40" title={t("bezDokumentacijeTitle")}>
                      <Minus className="h-[18px] w-[18px] shrink-0" aria-label={t("bezDokumentacijeTitle")} />
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusPill vrsta={v} />
                </td>
                <td className="px-3 py-2 text-right">
                  <VrstaSheet vrsta={v} />
                </td>
              </tr>
            ))}
            {vidljive.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  {t("prazno")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Inline interval s autosave-om na blur/Enter. Izvor istine je server-vrijednost
// (vrsta.interval) — nju mijenja samo ova ćelija, pa nije potrebna sinhronizacija
// lokalnog stanja kroz effect.
function IntervalCell({ vrsta }: { vrsta: Vrsta }) {
  const router = useRouter()
  const t = useTranslations("termini.vrstePregleda")
  const tc = useTranslations("common")
  const serverVal = vrsta.interval?.toString() ?? ""
  const [val, setVal] = useState(serverVal)
  const [pending, startSave] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function commit() {
    const trimmed = val.trim()
    if (trimmed === serverVal) {
      setErr(null)
      return
    }
    const parsed = trimmed === "" ? null : Number(trimmed)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 120)) {
      setErr(t("intervalGreska"))
      return
    }
    setErr(null)
    startSave(async () => {
      const res = toastRezultat(await postaviVrstaInterval(vrsta.id, parsed), {
        uspjeh: tc("sacuvano"),
        greska: t("intervalGreskaFallback"),
      })
      if (res.ok) router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        max={120}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        placeholder="—"
        className="w-20"
        aria-invalid={err ? true : undefined}
        data-testid={`interval-${vrsta.id}`}
      />
      <span className="w-24 text-xs">
        {pending && <span className="text-muted-foreground">…</span>}
        {!pending && err && <span className="text-destructive">{err}</span>}
      </span>
    </div>
  )
}

function StatusPill({ vrsta }: { vrsta: Vrsta }) {
  const router = useRouter()
  const t = useTranslations("termini.vrstePregleda")
  const tc = useTranslations("common")
  const [pending, startToggle] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      data-testid={`status-vrsta-${vrsta.id}`}
      title={vrsta.aktivna ? t("klikDeaktivacija") : t("klikAktivacija")}
      onClick={() =>
        startToggle(async () => {
          const next = !vrsta.aktivna
          toastRezultat(await postaviVrstaAktivna(vrsta.id, next), {
            uspjeh: next ? t("aktiviranaUspjeh") : t("deaktiviranaUspjeh"),
            greska: tc("greska"),
          })
          router.refresh()
        })
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50",
        vrsta.aktivna
          ? "bg-green-50 text-green-700 hover:bg-green-100"
          : "bg-muted text-muted-foreground hover:bg-accent",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", vrsta.aktivna ? "bg-green-500" : "bg-muted-foreground")} />
      {vrsta.aktivna ? t("aktivna") : t("neaktivna")}
    </button>
  )
}
