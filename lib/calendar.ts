import { MONTHS_BS } from "./date"

export type CalDay = { date: string; day: number; inMonth: boolean }

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/** Naziv mjeseca (1=Januar). Fallback "" za nevažeći broj. */
export function monthLabel(month1to12: number): string {
  return MONTHS_BS[month1to12 - 1] ?? ""
}

/** Prethodni mjesec (sa prelaskom godine). */
export function prevMonth(year: number, month1to12: number): { year: number; month: number } {
  return month1to12 <= 1 ? { year: year - 1, month: 12 } : { year, month: month1to12 - 1 }
}

/** Sljedeći mjesec (sa prelaskom godine). */
export function nextMonth(year: number, month1to12: number): { year: number; month: number } {
  return month1to12 >= 12 ? { year: year + 1, month: 1 } : { year, month: month1to12 + 1 }
}

/**
 * Gradi 42-ćelijski (6 sedmica × 7 dana) mjesečni grid, ponedjeljak-prvi.
 * Dani prethodnog/sljedećeg mjeseca imaju inMonth=false.
 * Weekday se računa preko Date.UTC (timezone-safe); brojevi dana integer aritmetikom.
 */
export function buildMonthGrid(year: number, month1to12: number): CalDay[] {
  const firstWeekday = new Date(Date.UTC(year, month1to12 - 1, 1)).getUTCDay() // 0=Ned..6=Sub
  const mondayOffset = (firstWeekday + 6) % 7 // koliko dana prije 1. (ponedjeljak-prvi)
  const lastDay = new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
  const prevLast = new Date(Date.UTC(year, month1to12 - 1, 0)).getUTCDate()
  const cells: CalDay[] = []

  // vodeći dani prethodnog mjeseca
  const prev = prevMonth(year, month1to12)
  for (let i = mondayOffset; i > 0; i--) {
    const d = prevLast - i + 1
    cells.push({ date: `${prev.year}-${pad(prev.month)}-${pad(d)}`, day: d, inMonth: false })
  }
  // dani tekućeg mjeseca
  for (let d = 1; d <= lastDay; d++) {
    cells.push({ date: `${year}-${pad(month1to12)}-${pad(d)}`, day: d, inMonth: true })
  }
  // prateći dani sljedećeg mjeseca do 42
  const next = nextMonth(year, month1to12)
  let d = 1
  while (cells.length < 42) {
    cells.push({ date: `${next.year}-${pad(next.month)}-${pad(d)}`, day: d, inMonth: false })
    d++
  }
  return cells
}
