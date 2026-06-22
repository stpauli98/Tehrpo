import type { DerivedStatus } from "./termini"

export type MatrixCell = {
  terminId: string
  dan: number
  status: DerivedStatus
  brojUCeliji: number
}

export type MatrixInput = {
  id: string
  vrstaId: string
  vrstaNaziv: string
  columnKey: string
  dan: number
  status: DerivedStatus
}

export type MatrixRow = {
  rowId: string
  rowLabel: string
  cells: Record<string, MatrixCell | null>
}

export type MatrixColumn = {
  id: string
  label: string
  isCurrent?: boolean
}

const STATUS_PRIORITET: Record<DerivedStatus, number> = {
  kasni: 4,
  planirano: 3,
  zakazano: 3,
  izvrseno: 2,
  otkazano: 1,
}

export function buildMatrix(items: MatrixInput[]): MatrixRow[] {
  const byVrsta = new Map<string, MatrixRow>()
  for (const it of items) {
    let row = byVrsta.get(it.vrstaId)
    if (!row) {
      row = { rowId: it.vrstaId, rowLabel: it.vrstaNaziv, cells: {} }
      byVrsta.set(it.vrstaId, row)
    }
    const existing = row.cells[it.columnKey]
    if (!existing) {
      row.cells[it.columnKey] = { terminId: it.id, dan: it.dan, status: it.status, brojUCeliji: 1 }
    } else {
      existing.brojUCeliji += 1
      if (STATUS_PRIORITET[it.status] > STATUS_PRIORITET[existing.status]) {
        existing.terminId = it.id
        existing.dan = it.dan
        existing.status = it.status
      }
    }
  }
  return Array.from(byVrsta.values())
}
