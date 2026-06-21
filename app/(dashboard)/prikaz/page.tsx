import { createServerSupabaseClient } from "@/lib/supabase/server"
import { OpterecenjeChart, type OpterecenjeRow } from "@/components/domain/OpterecenjeChart"
import { PrikazToolbar } from "@/components/domain/PrikazToolbar"
import { MatrixGrid, type MatrixRow, type MatrixCell } from "@/components/domain/MatrixGrid"
import { TerminSheet } from "@/components/domain/TerminSheet"
import type { TerminRow } from "@/components/domain/TerminiTable"
import { currentYear, todayIso } from "@/lib/date"
import { toDerivedStatus, type DerivedStatus } from "@/lib/termini"

// status prioritet za "najurgentniji" u ćeliji (kasni > planirano/zakazano > izvrseno > otkazano)
const STATUS_PRIORITET: Record<DerivedStatus, number> = {
  kasni: 4,
  planirano: 3,
  zakazano: 3,
  izvrseno: 2,
  otkazano: 1,
}

export default async function PrikazPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const godina = Number(typeof sp.godina === "string" ? sp.godina : "") || currentYear()
  const klijentId = typeof sp.klijent === "string" ? sp.klijent : ""

  const supabase = await createServerSupabaseClient()
  const [opterecenjeRes, klijentiRes] = await Promise.all([
    supabase.rpc("get_opterecenje", { godina }),
    supabase.from("klijenti").select("id, naziv").order("naziv"),
  ])

  const opterecenje = (opterecenjeRes.data ?? []) as OpterecenjeRow[]
  const klijenti = (klijentiRes.data ?? []).map((k) => ({ id: k.id, naziv: k.naziv }))
  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]

  let matrixRows: MatrixRow[] = []
  if (klijentId) {
    const { data } = await supabase
      .from("termini_view")
      .select("id, vrsta_provjere_id, vrsta_naziv, rok_dospijeca, status_izvedeni")
      .eq("klijent_id", klijentId)
      .gte("rok_dospijeca", `${godina}-01-01`)
      .lte("rok_dospijeca", `${godina}-12-31`)
      .order("vrsta_naziv")
    const termini = (data ?? []) as TerminRow[]
    // pivot: vrsta → mjesec → najurgentniji termin
    const byVrsta = new Map<string, MatrixRow>()
    for (const t of termini) {
      if (!t.id || !t.vrsta_provjere_id || !t.rok_dospijeca) continue
      const vrstaId = t.vrsta_provjere_id
      let row = byVrsta.get(vrstaId)
      if (!row) {
        row = { vrstaId, vrstaNaziv: t.vrsta_naziv ?? "—", mjeseci: {} }
        byVrsta.set(vrstaId, row)
      }
      const mj = Number(t.rok_dospijeca.slice(5, 7))
      const dan = Number(t.rok_dospijeca.slice(8, 10))
      const status = toDerivedStatus(t.status_izvedeni)
      const existing: MatrixCell | null | undefined = row.mjeseci[mj]
      if (!existing) {
        row.mjeseci[mj] = { terminId: t.id, dan, status, brojUCeliji: 1 }
      } else {
        existing.brojUCeliji += 1
        // zadrži najurgentniji status + njegov datum
        if (STATUS_PRIORITET[status] > STATUS_PRIORITET[existing.status]) {
          existing.terminId = t.id
          existing.dan = dan
          existing.status = status
        }
      }
    }
    matrixRows = Array.from(byVrsta.values())
  }

  // currentSearch string (čuva sve trenutne parametre za link bazu)
  const currentSearch = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v] as [string, string]] : []
    )
  ).toString()

  // TerminSheet — otvara se kad ?selected=<id>
  const selectedId = typeof sp.selected === "string" ? sp.selected : null
  let selectedTermin: TerminRow | null = null
  let istorija: TerminRow[] = []
  if (selectedId) {
    const { data } = await supabase
      .from("termini_view")
      .select("*")
      .eq("id", selectedId)
      .maybeSingle()
    selectedTermin = (data as TerminRow | null) ?? null
    if (selectedTermin?.klijent_id && selectedTermin?.vrsta_provjere_id) {
      const { data: h } = await supabase
        .from("termini_view")
        .select("*")
        .eq("klijent_id", selectedTermin.klijent_id)
        .eq("vrsta_provjere_id", selectedTermin.vrsta_provjere_id)
        .eq("status", "izvrseno")
        .neq("id", selectedTermin.id ?? "")
        .order("datum_izvrsenja", { ascending: false })
        .limit(5)
      istorija = (h ?? []) as TerminRow[]
    }
  }

  // closeHref = trenutni URL bez "selected", čuva klijent/godina
  const closeParams = new URLSearchParams(currentSearch)
  closeParams.delete("selected")
  const closeHref = `/prikaz${closeParams.toString() ? `?${closeParams.toString()}` : ""}`

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Prikaz</h1>

      <div className="rounded-xl border border-slate-200 p-4">
        <OpterecenjeChart
          data={opterecenje}
          currentMonth={
            godina === Number(todayIso().slice(0, 4))
              ? Number(todayIso().slice(5, 7))
              : undefined
          }
        />
      </div>

      <PrikazToolbar klijenti={klijenti} godine={godine} />

      {!klijentId ? (
        <div
          data-testid="prikaz-empty"
          className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500"
        >
          Izaberite klijenta za prikaz godišnje matrice.
        </div>
      ) : (
        <MatrixGrid rows={matrixRows} currentSearch={currentSearch} />
      )}

      {selectedTermin && (
        <TerminSheet termin={selectedTermin} istorija={istorija} closeHref={closeHref} />
      )}
    </div>
  )
}
