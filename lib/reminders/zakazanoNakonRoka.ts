import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { parseEmailList } from "@/lib/reminders/recipients"
import { zakazanoNakonRokaSubject, zakazanoNakonRokaHtml } from "@/lib/email/templates"

export type ZakazanoObavijestResult = {
  poslato: boolean
  to?: string[]
  dryRun?: boolean
  razlog?: "preskoceno" | "greska"
  message?: string
}

/**
 * Best-effort obavijest "zakazano poslije roka". NE baca — vraća rezultat.
 * Idempotencija + interni primaoci: SECURITY DEFINER RPC zabiljezi_zakazano_obavijest
 * (bypass caller RLS, atomski claim). NIKAD klijentu.
 */
export async function posaljiZakazanoNakonRoka(
  supabase: SupabaseClient<Database>,
  args: { terminId: string; datumZakazan: string },
  deps: { send?: (a: SendArgs) => Promise<SendResult> } = {},
): Promise<ZakazanoObavijestResult> {
  const send = deps.send ?? sendEmail
  try {
    const base = parseEmailList(env.REMINDER_TO)
    const { data: primaociData, error: rpcErr } = await supabase.rpc("zabiljezi_zakazano_obavijest", {
      p_termin_id: args.terminId,
      p_datum_zakazan: args.datumZakazan,
      p_base: base,
    })
    if (rpcErr) return { poslato: false, razlog: "greska", message: rpcErr.message }
    const to = (primaociData ?? []) as string[]
    if (to.length === 0) return { poslato: false, razlog: "preskoceno" }

    const { data: row, error: rowErr } = await supabase
      .from("termini_view")
      .select("klijent_naziv, vrsta_naziv, lokacija_naziv, rok_dospijeca")
      .eq("id", args.terminId)
      .maybeSingle()
    if (rowErr || !row?.klijent_naziv || !row.vrsta_naziv || !row.rok_dospijeca) {
      return { poslato: false, razlog: "greska", message: rowErr?.message ?? "nepotpun termin" }
    }

    const res = await send({
      to,
      subject: zakazanoNakonRokaSubject({ vrsta: row.vrsta_naziv, klijent: row.klijent_naziv }),
      html: zakazanoNakonRokaHtml({
        klijent: row.klijent_naziv,
        vrsta: row.vrsta_naziv,
        rok: row.rok_dospijeca,
        zakazan: args.datumZakazan,
        lokacija: row.lokacija_naziv,
      }),
    })
    return { poslato: true, to, dryRun: res.dryRun }
  } catch (e) {
    return { poslato: false, razlog: "greska", message: e instanceof Error ? e.message : String(e) }
  }
}
