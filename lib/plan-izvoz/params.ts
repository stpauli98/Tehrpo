import { currentYear } from "@/lib/date"
import { validRaspon, type IzvozPeriod } from "@/lib/plan-izvoz/period"

export type IzvozFormat = "pdf" | "xlsx"
export type IzvozOpseg = "sve" | "filtrirano"

export type IzvozParams =
  | { ok: true; legacy: true; format: IzvozFormat; count: boolean }
  | { ok: true; legacy: false; format: IzvozFormat; opseg: IzvozOpseg; period: IzvozPeriod; count: boolean }
  | { ok: false; greska: "raspon" }

export function parseIzvozParams(sp: URLSearchParams): IzvozParams {
  const format: IzvozFormat = sp.get("format") === "pdf" ? "pdf" : "xlsx"
  const count = sp.get("count") === "1"
  const periodParam = sp.get("period")

  // Backward-compat: bez 'period' param → stara ruta (parsePlanFilteri + applyPlanFilteri).
  if (!periodParam) return { ok: true, legacy: true, format, count }

  const opseg: IzvozOpseg = sp.get("opseg") === "filtrirano" ? "filtrirano" : "sve"
  const godina = Number(sp.get("godina")) || currentYear()

  let period: IzvozPeriod
  switch (periodParam) {
    case "god":
      period = { mod: "god", godina }
      break
    case "mj": {
      const m = Number(sp.get("mjesec"))
      period = { mod: "mj", godina, mjesec: m >= 1 && m <= 12 ? m : 1 }
      break
    }
    case "raspon": {
      const od = sp.get("od")
      const doD = sp.get("do")
      if (!validRaspon(od, doD)) return { ok: false, greska: "raspon" }
      period = { mod: "raspon", od, do: doD }
      break
    }
    case "svi":
      period = { mod: "svi" }
      break
    case "om":
    default:
      period = { mod: "om" }
      break
  }
  return { ok: true, legacy: false, format, opseg, period, count }
}
