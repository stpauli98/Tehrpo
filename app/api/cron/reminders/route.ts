import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runReminders } from "@/lib/reminders/runReminders"
import { runPostDue } from "@/lib/reminders/runPostDue"
import { runDigest, type DigestRunResult } from "@/lib/reminders/runDigest"
import { drySend } from "@/lib/email/resend"
import { isCronAuthorized } from "@/lib/reminders/cronAuth"
import { podsjetniciAktivni, lokalniSatIDatum, trebaSlatiSada } from "@/lib/reminders/gating"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// Tri throttlovane petlje (pre-due + post-due + digest) dijele jedan zahtjev; 60s je bilo
// dimenzionisano samo za runReminders pri punom cap-u (~50s).
export const maxDuration = 120

async function handle(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let dryRun = false
  try {
    const body = (await req.json()) as { dryRun?: boolean } | null
    dryRun = body?.dryRun === true
  } catch {
    // prazno telo (Vercel Cron šalje GET bez tijela) je OK → dryRun = false
  }

  const supabase = createAdminSupabaseClient()

  // Prekidač + vrijeme + dnevni marker važe SAMO za automatski (cron) GET; POST
  // (ručno/test) uvijek radi oba bez gatinga. Marker gejtuje isključivo pre-due:
  // post-due ima vlastitu idempotenciju (claim_post_due, jedan red po terminu,
  // ciklusu i kanalu u post_due_obavijesti), pa mu dnevni marker nije potreban —
  // gejtovanje njime bi značilo da istekli rok čeka do sutra i onda kad je pre-due
  // za taj dan već odrađen.
  let datumZaMarker: string | null = null
  let preskociPreDue = false
  if (req.method === "GET") {
    const { data: post } = await supabase
      .from("postavke")
      .select("podsjetnici_aktivni, vrijeme_slanja_sat, zadnje_slanje_datum")
      .eq("id", 1)
      .maybeSingle()
    if (!podsjetniciAktivni(post)) {
      return NextResponse.json({ ok: true, skipped: "podsjetnici_iskljuceni" })
    }
    const vrijemeSat = post?.vrijeme_slanja_sat ?? 8
    const { sat, datum } = lokalniSatIDatum(new Date())
    if (sat < vrijemeSat) {
      return NextResponse.json({ ok: true, skipped: "izvan_sata" })
    }
    if (trebaSlatiSada(vrijemeSat, post?.zadnje_slanje_datum ?? null, new Date())) {
      datumZaMarker = datum
    } else {
      preskociPreDue = true
    }
  }

  // Bez ključa sendEmail tiho pređe na drySend (resend.ts:25). U cron kontekstu to
  // znači da se tragovi ne upisuju, dedup prestane raditi, a po vraćanju ključa prvi
  // run pošalje sve odjednom. Bolje pasti glasno. Eksplicitni dryRun je izuzet.
  // Provjera je namjerno POSLIJE gatinga: kad gating odluči da se ionako ništa ne
  // šalje (npr. DEMO ima podsjetnici_aktivni=false i namjerno nema ključ), ruta mora
  // vratiti uredan skip, ne 500 svakih sat vremena.
  if (!dryRun && !env.RESEND_API_KEY) {
    return NextResponse.json({ error: "RESEND_API_KEY nije postavljen" }, { status: 500 })
  }

  try {
    const posalji = dryRun ? { send: drySend, dryRun: true } : {}
    // preDue UVIJEK ima isti oblik (sent/skipped/errors kao nizovi, deferred kao broj) bez
    // obzira da li je stvarno pokrenut ili preskočen zbog dnevnog markera — potrošači (UI,
    // testovi) rade .sent.length/.skipped.length bez provjere tipa. Razlog preskakanja ide u
    // odvojeno `preskocen` polje, ne u `skipped` (koje bi inače prešlo sa niza na string).
    const preDue = preskociPreDue
      ? { sent: [], skipped: [], errors: [], deferred: 0, preskocen: "vec_slato_danas" as const }
      : await runReminders(supabase, posalji)
    // Marker se upisuje ODMAH poslije uspješnog pre-due, prije post-due poziva —
    // greška u post-due putu ne smije poništiti da je pre-due danas već odrađen
    // (inače bi svaki sljedeći sat ponovo vrtio pre-due dok post-due ne prođe).
    if (datumZaMarker) {
      const { error: markerErr } = await supabase
        .from("postavke")
        .update({ zadnje_slanje_datum: datumZaMarker })
        .eq("id", 1)
      if (markerErr) {
        // Isti obrazac kao u post-due putu (runPostDue.ts): greška se ne smije progutati —
        // bez ovoga bi pre-due tiho pokušavao ponovo svaki sat do kraja dana.
        console.error("[cron/reminders] upis markera zadnje_slanje_datum nije uspio:", markerErr.message)
      }
    }
    const postDue = await runPostDue(supabase, posalji)
    // Digest ide POSLIJE post-due puta, u istom zahtjevu. Redoslijed nije kozmetika:
    // get_istekli_termini izostavlja termin koji je danas dobio pojedinačnu obavijest,
    // pa post-due mora prvo upisati svoje tragove. U ranijem dizajnu je digest bio
    // zasebna cron ruta i taj redoslijed nije bio zagarantovan.
    //
    // Digest ima vlastiti try/catch: on je najmanje kritičan od tri kruga i posljednji
    // je u nizu. preDue i postDue su u ovom trenutku već poslali stvarne mejlove i upisali
    // svoje ledgere — pad digesta ne smije obrisati te rezultate iz odgovora niti pretvoriti
    // uspješan cron u 500. Kad padne, `digest` nosi grešku umjesto uobičajenog oblika.
    let digest: DigestRunResult | { error: string }
    try {
      digest = await runDigest(supabase, posalji)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Greška"
      console.error("[cron/reminders] runDigest je pukao:", message)
      digest = { error: message }
    }
    return NextResponse.json({ preDue, postDue, digest })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Greška"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Vercel Cron poziva GET (uz Authorization: Bearer $CRON_SECRET); POST ostaje za ručno/test.
export const GET = handle
export const POST = handle
