import { MONTHS_BS } from "@/lib/date"

/** Mjesec opcije za filter — value je "1".."12". */
export const MONTHS_BS_OPTION = MONTHS_BS.map((label, i) => ({
  value: String(i + 1),
  label,
}))
