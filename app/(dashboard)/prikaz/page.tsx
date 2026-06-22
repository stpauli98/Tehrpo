import { createServerSupabaseClient } from "@/lib/supabase/server"
import { OpterecenjeChart, type OpterecenjeRow } from "@/components/domain/OpterecenjeChart"
import { PrikazToolbar } from "@/components/domain/PrikazToolbar"
import { MatrixGrid } from "@/components/domain/MatrixGrid"
import { TerminSheet } from "@/components/domain/TerminSheet"
import type { TerminRow } from "@/components/domain/TerminiTable"
import { currentYear, todayIso, MONTHS_BS } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import { buildMatrix, type MatrixInput, type MatrixRow } from "@/lib/matrix"

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
    const inputs: MatrixInput[] = termini
      .filter((t) => t.id && t.vrsta_provjere_id && t.rok_dospijeca)
      .map((t) => ({
        id: t.id!,
        vrstaId: t.vrsta_provjere_id!,
        vrstaNaziv: t.vrsta_naziv ?? "—",
        columnKey: String(Number(t.rok_dospijeca!.slice(5, 7))),
        dan: Number(t.rok_dospijeca!.slice(8, 10)),
        status: toDerivedStatus(t.status_izvedeni),
      }))
    matrixRows = buildMatrix(inputs)
  }

  // Kolone matrice: 12 mjeseci
  const currentMonthNum = Number(todayIso().slice(5, 7))
  const currentYearNum = currentYear()
  const mjeseciKolone = MONTHS_BS.map((label, i) => ({
    id: String(i + 1),
    label: label.slice(0, 3),
    isCurrent: godina === currentYearNum && i + 1 === currentMonthNum,
  }))

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

  const dokumenti = selectedTermin?.id
    ? ((await supabase
        .from("dokumenti")
        .select("*")
        .eq("termin_id", selectedTermin.id)
        .order("uploaded_at", { ascending: false })).data ?? [])
    : []

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

      <PrikazToolbar klijenti={klijenti} godine={godine} godina={godina} />

      {!klijentId ? (
        <div
          data-testid="prikaz-empty"
          className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500"
        >
          Izaberite klijenta za prikaz godišnje matrice.
        </div>
      ) : (
        <MatrixGrid
          columns={mjeseciKolone}
          rows={matrixRows}
          currentSearch={currentSearch}
          emptyMessage="Ovaj klijent nema termina u izabranoj godini."
        />
      )}

      {selectedTermin && (
        <TerminSheet termin={selectedTermin} istorija={istorija} dokumenti={dokumenti} closeHref={closeHref} />
      )}
    </div>
  )
}
