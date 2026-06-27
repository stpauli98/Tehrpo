import { createServerSupabaseClient } from "@/lib/supabase/server"
import { PrikazToolbar } from "@/components/domain/PrikazToolbar"
import { MatrixGrid } from "@/components/domain/MatrixGrid"
import { MatrixLegenda } from "@/components/domain/MatrixLegenda"
import type { MatrixColumn } from "@/lib/matrix"
import { TerminSheet } from "@/components/domain/TerminSheet"
import type { TerminRow } from "@/components/domain/TerminiTable"
import { currentYear, todayIso, MONTHS_BS, monthRange } from "@/lib/date"
import { toDerivedStatus } from "@/lib/termini"
import { buildMatrix, type MatrixInput, type MatrixRow } from "@/lib/matrix"

export async function MatricaView({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const sp = searchParams
  const godina = Number(typeof sp.godina === "string" ? sp.godina : "") || currentYear()
  const klijentId = typeof sp.klijent === "string" ? sp.klijent : ""
  const mode = typeof sp.mode === "string" ? sp.mode : "klijent"
  const mjesec = Number(typeof sp.mjesec === "string" ? sp.mjesec : "") || (Number(todayIso().slice(5, 7)))

  const supabase = await createServerSupabaseClient()
  const { data: klijentiData } = await supabase.from("klijenti").select("id, naziv").order("naziv")
  const klijenti = (klijentiData ?? []).map((k) => ({ id: k.id, naziv: k.naziv }))
  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]

  let matrixRows: MatrixRow[] = []
  let kolone: MatrixColumn[] = []
  let emptyMessage = "Izaberite klijenta za prikaz godišnje matrice."

  if (mode === "mjesec") {
    const { from: od, to: doIso } = monthRange(godina, mjesec)
    const { data } = await supabase
      .from("termini_view")
      .select("id, vrsta_provjere_id, vrsta_naziv, klijent_id, rok_dospijeca, status_izvedeni")
      .gte("rok_dospijeca", od)
      .lte("rok_dospijeca", doIso)
    const termini = (data ?? []) as TerminRow[]
    const inputs: MatrixInput[] = termini
      .filter((t) => t.id && t.vrsta_provjere_id && t.klijent_id && t.rok_dospijeca)
      .map((t) => ({
        id: t.id!,
        vrstaId: t.vrsta_provjere_id!,
        vrstaNaziv: t.vrsta_naziv ?? "—",
        columnKey: t.klijent_id!,
        dan: Number(t.rok_dospijeca!.slice(8, 10)),
        status: toDerivedStatus(t.status_izvedeni),
      }))
    matrixRows = buildMatrix(inputs)
    kolone = klijenti.map((k) => ({ id: k.id, label: k.naziv }))
    emptyMessage = "Nema termina za izabrani mjesec."
  } else if (klijentId) {
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
    // Kolone matrice: 12 mjeseci
    const currentMonthNum = Number(todayIso().slice(5, 7))
    const currentYearNum = currentYear()
    kolone = MONTHS_BS.map((label, i) => ({
      id: String(i + 1),
      label: label.slice(0, 3),
      isCurrent: godina === currentYearNum && i + 1 === currentMonthNum,
    }))
    emptyMessage = "Ovaj klijent nema termina u izabranoj godini."
  }

  // multiHref: za ćelije sa više termina (brojUCeliji > 1) → /plan-aktivnosti lista filtriran
  const multiHref = (vrstaId: string, colId: string): string =>
    mode === "mjesec"
      ? `/plan-aktivnosti?view=lista&klijent_id=${colId}&vrsta_id=${vrstaId}&mjesec=${mjesec}&godina=${godina}`
      : `/plan-aktivnosti?view=lista&klijent_id=${klijentId}&vrsta_id=${vrstaId}&mjesec=${colId}&godina=${godina}`

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
  const closeHref = `/plan-aktivnosti${closeParams.toString() ? `?${closeParams.toString()}` : ""}`

  const showMatrix = mode === "mjesec" || (mode === "klijent" && !!klijentId)

  return (
    <div className="space-y-6">
      <PrikazToolbar klijenti={klijenti} godine={godine} godina={godina} />

      {showMatrix ? (
        <div className="space-y-2">
          <MatrixGrid
            columns={kolone}
            rows={matrixRows}
            currentSearch={currentSearch}
            emptyMessage={emptyMessage}
            multiHref={multiHref}
            fillWidth={mode === "klijent"}
          />
          <MatrixLegenda />
        </div>
      ) : (
        <div
          data-testid="prikaz-empty"
          className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500"
        >
          {emptyMessage}
        </div>
      )}

      {selectedTermin && (
        <TerminSheet termin={selectedTermin} istorija={istorija} dokumenti={dokumenti} closeHref={closeHref} />
      )}
    </div>
  )
}
