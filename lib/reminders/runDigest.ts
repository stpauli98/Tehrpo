import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { posaljiIzabiljezi } from "@/lib/email/posaljiIzabiljezi"
import { digestSubject, digestHtml, type DigestStavka } from "@/lib/email/templates"
import { loadRecipientIndex } from "@/lib/reminders/recipients"
import { digestGroups, type IstekliRed } from "@/lib/reminders/digestGroups"
import { trebaDigest } from "@/lib/reminders/digestCadence"
import { lokalniSatIDatum } from "@/lib/reminders/gating"

export type SentItem = { email: string; brojStavki: number; resendId: string; dryRun: boolean }
export type SkipItem = { email: string; razlog: string }
export type ErrItem = { email: string; message: string }
export type DigestRunResult = { sent: SentItem[]; skipped: SkipItem[]; errors: ErrItem[] }

type Outcome =
  | ({ kind: "sent" } & SentItem)
  | ({ kind: "skip" } & SkipItem)
  | ({ kind: "err" } & ErrItem)

/** Koliko dana unazad gledamo ledger da bismo znali kad je primalac zadnji put dobio digest. */
const PROZOR_DANA = 8

/**
 * Sedmični digest isteklih termina — jedan mejl po primaocu, ponedjeljkom.
 *
 * Isti claim-first obrazac kao post-due put: upiši claim → pošalji → označi ishod.
 * Pad slanja NE briše claim; red ostaje 'u_toku' i postaje ponovo dostupan poslije
 * 15 minuta, što je jedini razlog zašto oporavak uopšte postoji.
 *
 * Dry run ne uzima claim i ne dira ledger — inače bi test-pokretanje zaključalo
 * primaocu digest za taj dan.
 *
 * Datum je uvijek LOKALNI BEČKI: isti izvor i za ključ u ledgeru i za odluku o
 * kadenci. Da se razilaze, u kasnim satima bi ključ i odluka gledali različite dane.
 */
export async function runDigest(
  supabase: SupabaseClient<Database>,
  deps: {
    send?: (a: SendArgs) => Promise<SendResult>
    now?: Date
    batchSize?: number
    delayMs?: number
    dryRun?: boolean
  } = {},
): Promise<DigestRunResult> {
  const send = deps.send ?? sendEmail
  const now = deps.now ?? new Date()
  const isDryRun = deps.dryRun === true
  const batchSize = Math.max(1, deps.batchSize ?? (Number(env.REMINDER_BATCH_SIZE) || 2))
  const delayMs = deps.delayMs ?? (Number(env.REMINDER_BATCH_DELAY_MS) || 1100)

  const { datum: danas } = lokalniSatIDatum(now)

  const { data: istekli, error } = await supabase.rpc("get_istekli_termini", { p_danas: danas })
  if (error) throw new Error(error.message)
  const rows = istekli ?? []
  if (rows.length === 0) return { sent: [], skipped: [], errors: [] }

  const { index, base } = await loadRecipientIndex(supabase)

  const stavke: IstekliRed[] = rows.map((r) => ({
    terminId: r.termin_id!, klijentId: r.klijent_id!, klijentNaziv: r.klijent_naziv!,
    vrstaNaziv: r.vrsta_naziv!, rokDospijeca: r.rok_dospijeca!, datumZakazan: r.datum_zakazan,
    ciklusRok: r.ciklus_rok!, danaDoCiklusa: r.dana_do_ciklusa!, lokacijaNaziv: r.lokacija_naziv,
  }))
  const grupe = digestGroups(stavke, index, base)
  if (grupe.size === 0) return { sent: [], skipped: [], errors: [] }

  // Jedan upit za cijeli prozor umjesto po primaocu — na desetak primalaca to je
  // razlika između jednog i deset round-tripova.
  const odDatum = new Date(Date.parse(`${danas}T00:00:00Z`) - PROZOR_DANA * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const { data: zapisi, error: zapErr } = await supabase
    .from("digest_slanja")
    .select("primalac_email, datum, stanje, claimed_at")
    .gte("datum", odDatum)
  if (zapErr) throw new Error(`Greška pri čitanju digest_slanja: ${zapErr.message}`)

  const zadnjiPoslatPo = new Map<string, string>()
  const danasnjiPo = new Map<string, { stanje: string; claimedAt: string }>()
  for (const z of zapisi ?? []) {
    if (z.datum === danas) {
      danasnjiPo.set(z.primalac_email, { stanje: z.stanje, claimedAt: z.claimed_at })
    }
    if (z.stanje === "poslato") {
      const prethodni = zadnjiPoslatPo.get(z.primalac_email)
      if (!prethodni || z.datum > prethodni) zadnjiPoslatPo.set(z.primalac_email, z.datum)
    }
  }

  const obradiPrimaoca = async (email: string, lista: IstekliRed[]): Promise<Outcome> => {
    const treba = trebaDigest({
      danas,
      zadnjiPoslat: zadnjiPoslatPo.get(email) ?? null,
      danasnji: danasnjiPo.get(email) ?? null,
      now,
    })
    if (!treba) return { kind: "skip", email, razlog: "van kadence ili već obrađen danas" }

    let claimId: string | null = null
    if (!isDryRun) {
      const { data, error: claimErr } = await supabase.rpc("claim_digest", {
        p_email: email, p_datum: danas,
      })
      if (claimErr) return { kind: "err", email, message: claimErr.message }
      // Generisani tip laže: claim_digest je tipiziran kao `Returns: string`, ali stvarno
      // vraća null kad claim drži neko drugi (isti obrazac kao claim_post_due, potvrđen
      // izvršavanjem u prethodnom PR-u). Provjera ispod mora ostati — bez nje bi "claim
      // nije dobijen" tiho prošlo kao uspjeh i poslalo drugi digest.
      claimId = (data as string | null) ?? null
      if (!claimId) return { kind: "skip", email, razlog: "claim drži neko drugi" }
    }

    const stavkeZaMejl: DigestStavka[] = lista.map((r) => ({
      klijent: r.klijentNaziv, vrsta: r.vrstaNaziv, rok: r.rokDospijeca,
      zakazanoZa: r.datumZakazan && r.datumZakazan !== r.rokDospijeca ? r.datumZakazan : null,
      lokacija: r.lokacijaNaziv, danaDoCiklusa: r.danaDoCiklusa,
    }))

    try {
      const res = await posaljiIzabiljezi(
        supabase,
        {
          to: [email],
          subject: digestSubject({ broj: lista.length }),
          html: digestHtml({ stavke: stavkeZaMejl, baseUrl: env.NEXT_PUBLIC_APP_URL }),
          // Digest pokriva više klijenata, pa nema jednog termina ni klijenta.
          // Posljedica: u dnevniku mejlova ga po RLS-u vide samo admini.
          tip: "podsjetnik_digest",
          terminId: null,
          klijentId: null,
        },
        send,
      )
      if (claimId && !res.dryRun) {
        const { error: updErr } = await supabase
          .from("digest_slanja")
          .update({
            stanje: "poslato",
            poslat_at: new Date().toISOString(),
            resend_id: res.id,
            termin_ids: lista.map((r) => r.terminId),
          })
          .eq("id", claimId)
        if (updErr) {
          // Mejl je otišao, trag nije upisan → red ostaje 'u_toku' i za 15 minuta
          // postaje ponovo dostupan, što znači mogući drugi digest. Mora biti vidljivo.
          return {
            kind: "err", email,
            message: `mejl poslat (resend_id=${res.id}) ali upis nije uspio: ${updErr.message}`,
          }
        }
      }
      return { kind: "sent", email, brojStavki: lista.length, resendId: res.id, dryRun: res.dryRun }
    } catch (e) {
      // Claim se NE briše: red ostaje 'u_toku' i oporavlja se poslije 15 minuta.
      return { kind: "err", email, message: e instanceof Error ? e.message : String(e) }
    }
  }

  const zadaci = [...grupe.entries()].map(([email, lista]) => () => obradiPrimaoca(email, lista))
  const outcomes: Outcome[] = []
  for (let i = 0; i < zadaci.length; i += batchSize) {
    const grupa = zadaci.slice(i, i + batchSize)
    // eslint-disable-next-line no-await-in-loop -- throttling: namjerno sekvencijalne grupe radi Resend rate-limita
    outcomes.push(...(await Promise.all(grupa.map((f) => f()))))
    if (delayMs > 0 && i + batchSize < zadaci.length) {
      // eslint-disable-next-line no-await-in-loop -- pauza između grupa (rate-limit)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  const sent: SentItem[] = []
  const skipped: SkipItem[] = []
  const errors: ErrItem[] = []
  for (const o of outcomes) {
    if (o.kind === "sent") sent.push({ email: o.email, brojStavki: o.brojStavki, resendId: o.resendId, dryRun: o.dryRun })
    else if (o.kind === "skip") skipped.push({ email: o.email, razlog: o.razlog })
    else errors.push({ email: o.email, message: o.message })
  }
  return { sent, skipped, errors }
}
