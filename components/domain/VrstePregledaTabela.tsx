"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { VrstaSheet } from "./VrstaSheet"
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
  const [prikaziNeaktivne, setPrikaziNeaktivne] = useState(false)
  const brNeaktivnih = vrste.filter((v) => !v.aktivna).length
  const vidljive = prikaziNeaktivne ? vrste : vrste.filter((v) => v.aktivna)

  return (
    <div className="space-y-3" data-testid="vrste-tabela">
      <div className="flex items-center justify-between gap-4 text-sm">
        <label className="flex items-center gap-2 text-slate-600">
          <input
            type="checkbox"
            checked={prikaziNeaktivne}
            onChange={(e) => setPrikaziNeaktivne(e.target.checked)}
            data-testid="vrste-prikazi-neaktivne"
          />
          Prikaži i neaktivne{brNeaktivnih > 0 && ` (${brNeaktivnih})`}
        </label>
        <span className="text-slate-400">{vidljive.length} vrsta</span>
      </div>

      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Vrsta pregleda</th>
              <th className="w-44 px-3 py-2 font-medium">Interval (mj)</th>
              <th className="w-16 px-3 py-2 text-center font-medium">Dok.</th>
              <th className="w-32 px-3 py-2 font-medium">Status</th>
              <th className="w-20 px-3 py-2 text-right font-medium">Akcije</th>
            </tr>
          </thead>
          <tbody data-testid="vrste-lista">
            {vidljive.map((v) => (
              <tr key={v.id} className={cn("border-t border-slate-100", !v.aktivna && "bg-slate-50/60")}>
                <td className="px-3 py-2">
                  <div className={cn("font-medium", !v.aktivna && "text-slate-400 line-through")}>{v.naziv}</div>
                  {v.zakonski_osnov && <div className="text-xs text-slate-400">{v.zakonski_osnov}</div>}
                </td>
                <td className="px-3 py-2">
                  <IntervalCell vrsta={v} />
                </td>
                <td className="px-3 py-2 text-center">
                  {v.vodi_dokumentaciju ? (
                    <span className="text-slate-500" title="Vodi se dokumentacija">✓</span>
                  ) : (
                    <span className="text-slate-300" title="Bez dokumentacije">—</span>
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
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  Nema vrsta za prikaz.
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
  const serverVal = vrsta.interval?.toString() ?? ""
  const [val, setVal] = useState(serverVal)
  const [pending, startSave] = useTransition()
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // "✓ spremljeno" se sakrije nakon 2s.
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(t)
  }, [saved])

  function commit() {
    const trimmed = val.trim()
    if (trimmed === serverVal) {
      setErr(null)
      return
    }
    const parsed = trimmed === "" ? null : Number(trimmed)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 120)) {
      setErr("1–120 ili prazno")
      return
    }
    setErr(null)
    startSave(async () => {
      const res = await postaviVrstaInterval(vrsta.id, parsed)
      if (res.ok) {
        setSaved(true)
        router.refresh()
      } else {
        setErr(res.message ?? "Greška pri snimanju")
      }
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
        {pending && <span className="text-slate-400">…</span>}
        {!pending && saved && <span className="text-green-600">✓ spremljeno</span>}
        {!pending && err && <span className="text-red-600">{err}</span>}
      </span>
    </div>
  )
}

function StatusPill({ vrsta }: { vrsta: Vrsta }) {
  const router = useRouter()
  const [pending, startToggle] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      data-testid={`status-vrsta-${vrsta.id}`}
      title={vrsta.aktivna ? "Klik za deaktivaciju" : "Klik za aktivaciju"}
      onClick={() =>
        startToggle(async () => {
          await postaviVrstaAktivna(vrsta.id, !vrsta.aktivna)
          router.refresh()
        })
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50",
        vrsta.aktivna
          ? "bg-green-50 text-green-700 hover:bg-green-100"
          : "bg-slate-100 text-slate-500 hover:bg-slate-200",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", vrsta.aktivna ? "bg-green-500" : "bg-slate-400")} />
      {vrsta.aktivna ? "Aktivna" : "Neaktivna"}
    </button>
  )
}
