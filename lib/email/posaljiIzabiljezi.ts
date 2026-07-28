import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"

type MejlTip = Database["public"]["Enums"]["mejl_tip"]
// Vezano za enum, ne prepisano — inače bi nova vrijednost statusa mogla tiho odlutati.
type MejlStatus = Database["public"]["Enums"]["mejl_status"]

export async function posaljiIzabiljezi(
  supabase: SupabaseClient<Database>,
  args: SendArgs & { tip: MejlTip; terminId?: string | null; klijentId?: string | null },
  send: (a: SendArgs) => Promise<SendResult> = sendEmail,
): Promise<SendResult> {
  const { tip, terminId = null, klijentId = null, ...sendArgs } = args
  const primaoci = [...(sendArgs.to ?? []), ...(sendArgs.bcc ?? [])]
  try {
    const res = await send(sendArgs)
    // Demo režim SE bilježi — tab „Poslati mejlovi" time pokazuje kako bi mejlovi
    // izgledali u stvarnom radu. Obični dry-run (nema ključa, unit testovi) ostaje
    // tih, inače bi svaki test punio dnevnik.
    if (!res.dryRun || res.demo) {
      await zabiljeziMejlLog(supabase, {
        tip, terminId, klijentId, primaoci, subject: sendArgs.subject,
        resendId: res.id, status: res.demo ? "demo" : "poslato", greska: null,
      })
    }
    return res
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await zabiljeziMejlLog(supabase, {
      tip, terminId, klijentId, primaoci, subject: sendArgs.subject,
      resendId: null, status: "greska_slanja", greska: message,
    })
    throw e // RE-THROW: čuva postojeće rukovanje greškom na pozivnim mjestima
  }
}

async function zabiljeziMejlLog(
  supabase: SupabaseClient<Database>,
  row: {
    tip: MejlTip; terminId: string | null; klijentId: string | null
    primaoci: string[]; subject: string; resendId: string | null
    status: MejlStatus; greska: string | null
  },
): Promise<void> {
  try {
    const { error } = await supabase.rpc("zabiljezi_mejl_log", {
      p_tip: row.tip, p_termin_id: row.terminId, p_klijent_id: row.klijentId,
      p_primaoci: row.primaoci, p_subject: row.subject, p_resend_id: row.resendId,
      p_status: row.status, p_greska: row.greska,
    } as Database["public"]["Functions"]["zabiljezi_mejl_log"]["Args"])
    if (error) console.error("[mejl_log] upis nije uspio:", error.message)
  } catch (e) {
    console.error("[mejl_log] upis bacio:", e instanceof Error ? e.message : String(e))
  }
}
