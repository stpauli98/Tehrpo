import type { SupabaseClient } from "@supabase/supabase-js"
import { createTranslator } from "next-intl"
import type { Database } from "@/db/types"
import { env } from "@/lib/env"
import { sendEmail, type SendArgs, type SendResult } from "@/lib/email/resend"
import { posaljiIzabiljezi } from "@/lib/email/posaljiIzabiljezi"
import { buildTerminIcs } from "@/lib/email/ics"
import { reminderSubject, reminderHtml, rokIstekaoFirmaSubject, rokIstekaoFirmaHtml } from "@/lib/email/templates"
import { loadRecipientIndex, recipientsForKlijent, firmaRecipientsZa } from "@/lib/reminders/recipients"
import { firmBrand } from "@/lib/email/firmBrand"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "email.podsjetnik" })

export type Kanal = "interni" | "firma"
export type SentItem = { terminId: string; kanal: Kanal; to: string[]; resendId: string; dryRun: boolean }
export type SkipItem = { terminId: string; kanal: Kanal; razlog: string }
export type ErrItem = { terminId: string; kanal: Kanal; message: string }
export type PostDueRunResult = {
  sent: SentItem[]
  skipped: SkipItem[]
  errors: ErrItem[]
  /**
   * Koliko kanala (termin × kanal) je ostalo NEOBRAĐENO u ovom prolazu — zbog cap-a
   * ili istrošenog vremenskog budžeta. Nije gubitak: claim se za njih nije ni uzeo,
   * pa ih get_post_due_termine vraća i u sljedećem prolazu (cron je na 0 * * * *).
   */
  deferred: number
  /** true kad je prekid izazvao vremenski budžet (a ne cap) — razlikovanje za nadzor. */
  prekinutoZbogVremena: boolean
}

type Outcome =
  | ({ kind: "sent" } & SentItem)
  | ({ kind: "skip" } & SkipItem)
  | ({ kind: "err" } & ErrItem)

type PostDueObavijestiUpdate = Database["public"]["Tables"]["post_due_obavijesti"]["Update"]

/**
 * Post-due obavijesti: tačno jedna po ciklusu i kanalu.
 *
 * Redoslijed je claim-first (upiši → pošalji → označi ishod), jer postoje dva
 * schedulera (vercel.json crons i GH Actions na 0 * * * *) koji rutu pale skoro
 * istovremeno. Send-first bi značio da oba nađu prazan ledger i oba pošalju.
 * Pad slanja NE briše claim — red ostaje 'u_toku' i get_post_due_termine ga
 * ponovo otvori poslije 15 minuta.
 *
 * Dry run (deps.dryRun) je izuzet iz claim-a: ne piše u ledger uopšte, jer ne
 * postoji "pravo slanje" koje bi trebalo zaštititi od duplikata. Da dry run
 * ipak uzme claim, ostavio bi red u 'u_toku' na 15 minuta i time blokirao
 * stvarnu obavijest za taj ciklus — upravo scenario koji claim-first sprječava
 * za pravo slanje. Namjerno eksplicitan flag, ne poređenje `deps.send === drySend`:
 * referenca funkcije nije pouzdan signal (poziv može doći umotan/rebinding-om).
 *
 * OGRADE PROTIV PREKIDA (maxPerRun + deadlineAt): petlja je throttlovana (~1,36 s po
 * grupi), a Vercel funkciju ubija na maxDuration. Kill usred obrade je opasan upravo
 * zbog claim-first redoslijeda: claim je upisan, mejl je možda otišao, ali označavanje
 * ishoda više nikad ne stigne → red ostaje 'u_toku' i za 15 minuta se šalje ponovo.
 * Zato se prolaz sam zaustavlja PRIJE roka i ostatak prijavljuje kroz `deferred`.
 * Ništa se ne gubi: neobrađeni kanali nemaju claim, pa ih sljedeći prolaz vidi.
 */
export async function runPostDue(
  supabase: SupabaseClient<Database>,
  deps: {
    send?: (a: SendArgs) => Promise<SendResult>
    maxPerRun?: number
    batchSize?: number
    delayMs?: number
    dryRun?: boolean
    /** Apsolutni rok (Date.now() skala). Kad istekne, prolaz staje i ostatak ide u `deferred`. */
    deadlineAt?: number
    /** Izvor vremena — samo radi determinističkih testova; produkcija koristi Date.now. */
    sada?: () => number
  } = {},
): Promise<PostDueRunResult> {
  const send = deps.send ?? sendEmail
  const isDryRun = deps.dryRun === true
  const brand = firmBrand()
  const fromAddr = env.EMAIL_FROM ?? "no-reply@localhost"
  const maxPerRun = Math.max(1, deps.maxPerRun ?? (Number(env.REMINDER_MAX_PER_RUN) || 90))
  const batchSize = Math.max(1, deps.batchSize ?? (Number(env.REMINDER_BATCH_SIZE) || 2))
  const delayMs = deps.delayMs ?? (Number(env.REMINDER_BATCH_DELAY_MS) || 1100)
  const deadlineAt = deps.deadlineAt
  const sada = deps.sada ?? (() => Date.now())
  const prazno = (): PostDueRunResult => ({ sent: [], skipped: [], errors: [], deferred: 0, prekinutoZbogVremena: false })

  const { data: due, error } = await supabase.rpc("get_post_due_termine")
  if (error) throw new Error(error.message)
  const rows = due ?? []
  if (rows.length === 0) return prazno()

  // Baca ako se postavke/primaoci ne mogu pročitati. Namjerno: tiho tretiranje
  // transientnog kvara kao "prekidač je isključen" trajno bi progutalo firmin kanal,
  // jer bi upisalo 'preskoceno' claim za tekući ciklus.
  const { index, base } = await loadRecipientIndex(supabase)

  const oznaci = async (claimId: string, patch: PostDueObavijestiUpdate): Promise<void> => {
    const { error: updErr } = await supabase.from("post_due_obavijesti").update(patch).eq("id", claimId)
    if (updErr) console.error("[post-due] označavanje ishoda nije uspjelo:", updErr.message)
  }

  const obradiKanal = async (r: (typeof rows)[number], kanal: Kanal): Promise<Outcome> => {
    const terminId = r.termin_id!
    let claimId: string | null = null
    if (!isDryRun) {
      const { data, error: claimErr } = await supabase.rpc("claim_post_due", {
        p_termin: terminId, p_ciklus: r.ciklus_rok!, p_kanal: kanal,
      })
      // Generisani tip laže: claim_post_due je tipiziran kao `Returns: string`, ali
      // stvarno vraća null kad claim drži neko drugi (potvrđeno izvršavanjem u recenziji
      // prethodnog taska). Provjera ispod mora ostati — bez nje bi "claim nije dobijen"
      // tiho prošlo kao uspjeh i poslalo duplikat.
      claimId = data as string | null
      if (claimErr) return { kind: "err", terminId, kanal, message: claimErr.message }
      if (!claimId) return { kind: "skip", terminId, kanal, razlog: "claim drži neko drugi" }
    }

    const primaoci = kanal === "interni"
      ? recipientsForKlijent(index, r.klijent_id!, base)
      : firmaRecipientsZa(index, r.klijent_id!, r.lokacija_id ?? null)
    if (primaoci.length === 0) {
      if (claimId) await oznaci(claimId, { stanje: "preskoceno", razlog: "nema_primalaca" })
      return { kind: "skip", terminId, kanal, razlog: "nema primalaca" }
    }

    // Ciklus dolazi iz datum_zakazan samo kad se razlikuje od roka; tada mejl mora
    // prikazati oba datuma, da se ne laže o roku.
    const zakazanoZa = r.datum_zakazan && r.datum_zakazan !== r.rok_dospijeca ? r.datum_zakazan : null

    // Broj u predmetu i bedžu mjeri se ISKLJUČIVO prema roku (`dana_do_roka`), nikad prema
    // ciklusu. Ciklus (coalesce(datum_zakazan, rok)) odlučuje samo KADA se ponovo šalje —
    // v. where/claim iznad. Ranije je isti `dana_do_ciklusa` išao i u tekst, pa je prezakazan
    // termin dobijao naslov "kasni 1 dan" iznad tijela u kojem piše "Rok dospijeća: 27.06.",
    // dok je /pregled za isti termin javljao "kasni 33 dana".
    const args: SendArgs = kanal === "interni"
      ? {
          to: primaoci,
          subject: reminderSubject({ vrsta: r.vrsta_naziv!, klijent: r.klijent_naziv!, danaDoRoka: r.dana_do_roka! }),
          html: reminderHtml({
            klijent: r.klijent_naziv!, vrsta: r.vrsta_naziv!, rok: r.rok_dospijeca!,
            danaDoRoka: r.dana_do_roka!, lokacija: r.lokacija_naziv, zakazanoZa,
            terminId, klijentId: r.klijent_id!, baseUrl: env.NEXT_PUBLIC_APP_URL,
          }),
          attachments: [{
            filename: t("prilogNaziv"),
            content: Buffer.from(buildTerminIcs({
              vrsta: r.vrsta_naziv!, klijent: r.klijent_naziv!, rok: r.rok_dospijeca!,
              terminId, lokacija: r.lokacija_naziv, baseUrl: env.NEXT_PUBLIC_APP_URL,
            }), "utf-8"),
          }],
        }
      : {
          to: [fromAddr],
          bcc: primaoci,
          subject: rokIstekaoFirmaSubject({ vrsta: r.vrsta_naziv!, klijent: r.klijent_naziv! }),
          html: rokIstekaoFirmaHtml({
            klijent: r.klijent_naziv!, vrsta: r.vrsta_naziv!, rok: r.rok_dospijeca!,
            zakazanoZa, lokacija: r.lokacija_naziv, brand,
          }),
        }

    try {
      const res = await posaljiIzabiljezi(
        supabase,
        {
          ...args,
          tip: kanal === "interni" ? "podsjetnik_rok_istekao_interni" : "podsjetnik_rok_istekao_firma",
          terminId, klijentId: r.klijent_id,
        },
        send,
      )
      const svi = [...(args.to ?? []), ...(args.bcc ?? [])]
      // claimId je null tačno kad je isDryRun true (claim se u tom slučaju ni ne uzima) —
      // ledger se dry runu ne dira. res.dryRun se dodatno provjerava za rubni slučaj kad
      // claim JESTE uzet (isDryRun false) ali je send() svejedno tiho pao na drySend
      // (nedostaje RESEND_API_KEY) — tada mejl nije stvarno poslat pa se ni ne označava.
      if (claimId && !res.dryRun) {
        const { error: updErr } = await supabase
          .from("post_due_obavijesti")
          .update({ stanje: "poslato", poslat_at: new Date().toISOString(), poslat_na: svi, resend_id: res.id })
          .eq("id", claimId)
        if (updErr) {
          // Mejl je STVARNO poslat, ali trag u ledgeru nije upisan: red ostaje 'u_toku' i
          // get_post_due_termine ga ponovo otvori za 15 minuta → realan rizik duplikata.
          // Vraćamo "err" (ne "sent") da bi pozivalac (cron) ovo vidio kao grešku koju treba
          // istražiti — samo console.error bi ovo progutao bez traga za nadzor.
          console.error("[post-due] mejl poslat ali označavanje ishoda nije uspjelo:", updErr.message)
          return {
            kind: "err", terminId, kanal,
            message: `mejl poslat (resend_id=${res.id}) ali označavanje ishoda nije uspjelo (${updErr.message}) — red ostaje u_toku, mogući duplikat`,
          }
        }
      }
      return { kind: "sent", terminId, kanal, to: svi, resendId: res.id, dryRun: res.dryRun }
    } catch (e) {
      // Claim se NE briše: red ostaje 'u_toku' i RPC ga otvori za 15 minuta.
      return { kind: "err", terminId, kanal, message: e instanceof Error ? e.message : String(e) }
    }
  }

  const zadaci: Array<() => Promise<Outcome>> = []
  for (const r of rows) {
    if (r.treba_interni) zadaci.push(() => obradiKanal(r, "interni"))
    if (r.treba_firma) zadaci.push(() => obradiKanal(r, "firma"))
  }

  // Cap po prolazu. get_post_due_termine sortira najhitnije prvo, pa odsijecanje repa
  // odgađa najmanje hitne, a ne nasumične.
  const zaObradu = zadaci.slice(0, maxPerRun)
  let deferred = zadaci.length - zaObradu.length
  let prekinutoZbogVremena = false
  if (deferred > 0) {
    console.warn(`[post-due] cap ${maxPerRun}/prolaz — odgođeno ${deferred} kanala za sljedeći prolaz`)
  }

  const outcomes: Outcome[] = []
  for (let i = 0; i < zaObradu.length; i += batchSize) {
    // Provjera je PRIJE grupe (uključujući prvu): bolje ne započeti slanje nego biti
    // ubijen između mejla i upisa ishoda. Gladovanja nema — post-due se vrti svakih sat
    // vremena, a pre-due (koji jedini može pojesti budžet) najviše jednom dnevno.
    if (deadlineAt !== undefined && sada() >= deadlineAt) {
      deferred += zaObradu.length - i
      prekinutoZbogVremena = true
      break
    }
    const grupa = zaObradu.slice(i, i + batchSize)
    // eslint-disable-next-line no-await-in-loop -- throttling: namjerno sekvencijalne grupe radi Resend rate-limita
    outcomes.push(...(await Promise.all(grupa.map((f) => f()))))
    if (delayMs > 0 && i + batchSize < zaObradu.length) {
      // eslint-disable-next-line no-await-in-loop -- pauza između grupa (rate-limit)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  if (prekinutoZbogVremena) {
    console.warn(`[post-due] vremenski budžet istekao — odgođeno ${deferred} kanala za sljedeći prolaz`)
  }

  const sent: SentItem[] = []
  const skipped: SkipItem[] = []
  const errors: ErrItem[] = []
  for (const o of outcomes) {
    if (o.kind === "sent") sent.push({ terminId: o.terminId, kanal: o.kanal, to: o.to, resendId: o.resendId, dryRun: o.dryRun })
    else if (o.kind === "skip") skipped.push({ terminId: o.terminId, kanal: o.kanal, razlog: o.razlog })
    else errors.push({ terminId: o.terminId, kanal: o.kanal, message: o.message })
  }
  return { sent, skipped, errors, deferred, prekinutoZbogVremena }
}
