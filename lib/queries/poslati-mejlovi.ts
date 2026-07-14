import { createServerSupabaseClient } from "@/lib/supabase/server"
import type { Database } from "@/db/types"

export type PoslatiMejlFilteri = {
  tip?: Database["public"]["Enums"]["mejl_tip"] | null
  status?: Database["public"]["Enums"]["mejl_status"] | null
  od?: string | null
  do?: string | null
  samoGreske?: boolean
  samoNepregledane?: boolean
  limit?: number
  offset?: number
}

export type PoslatiMejlRed =
  Database["public"]["Functions"]["get_poslati_mejlovi"]["Returns"][number]

export async function dohvatiPoslateMejlove(
  f: PoslatiMejlFilteri,
): Promise<{ redovi: PoslatiMejlRed[]; ukupno: number }> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc("get_poslati_mejlovi", {
    p_tip: f.tip ?? null,
    p_status: f.status ?? null,
    p_od: f.od ?? null,
    p_do: f.do ?? null,
    p_samo_greske: f.samoGreske ?? false,
    p_samo_nepregledane: f.samoNepregledane ?? false,
    p_limit: f.limit ?? 50,
    p_offset: f.offset ?? 0,
  } as Database["public"]["Functions"]["get_poslati_mejlovi"]["Args"])
  if (error) throw new Error(error.message)
  const redovi = data ?? []
  const ukupno = Number(redovi[0]?.ukupno ?? 0)
  return { redovi, ukupno }
}
