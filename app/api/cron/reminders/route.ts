import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runReminders, type ReminderRunResult } from "@/lib/reminders/runReminders"
import { runPostDue } from "@/lib/reminders/runPostDue"
import { runDigest, type DigestRunResult } from "@/lib/reminders/runDigest"
import { drySend } from "@/lib/email/resend"
import { isCronAuthorized } from "@/lib/reminders/cronAuth"
import { zabiljeziOtkucaj, ishodIzOdgovora } from "@/lib/reminders/otkucaj"
import {
  podsjetniciAktivni,
  lokalniSatIDatum,
  trebaSlatiSada,
  zauzmiPreDueKrug,
  oslobodiPreDueKrug,
  type PreDuePreskocen,
} from "@/lib/reminders/gating"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
// Tri throttlovane petlje (pre-due + post-due + digest) dijele jedan zahtjev; 60s je bilo
// dimenzionisano samo za runReminders pri punom cap-u (~50s).
export const maxDuration = 120

/**
 * Vremenski budžet: Vercel ubija funkciju na `maxDuration`. Kill usred throttlovane
 * petlje je opasan jer post-due i digest rade claim-first (claim → mejl → upis ishoda):
 * prekid između mejla i upisa ostavlja red 'u_toku' i za 15 minuta šalje duplikat.
 * Zato krugovi dobijaju rok ranije od `maxDuration` i staju sami.
 *
 * REZERVA_ODGOVOR_MS pokriva serijalizaciju odgovora, hladni start i PREKORAČENJE od
 * najviše jedne grupe: rok se provjerava PRIJE grupe, pa grupa koja je startovala tik
 * prije roka smije da ga probije za svoje trajanje (~1,4 s pri batchSize=2/delay=1100).
 * REZERVA_DIGEST_MS je zaseban dio budžeta koji post-due ne smije pojesti, inače
 * digest nikad ne bi ni krenuo dok backlog isteklih ne padne.
 */
const REZERVA_ODGOVOR_MS = 15_000
const REZERVA_DIGEST_MS = 15_000

/**
 * Prag na kojem cron prijavljuje NEUSPJEH (5xx) umjesto tihog 200.
 *
 * Bez ovoga potpuni ispad Resend-a izgleda identično kao miran dan: sva tri kruga
 * vrate errors[] i ruta svejedno vrati 200, pa u Vercel nadzoru nema nijednog crvenog
 * run-a. Skipovi se NE broje (npr. "claim drži neko drugi" je normalno stanje kad se
 * dva schedulera preklope) — samo stvarni pokušaji slanja.
 *
 * Prag je namjerno nizak (jedna greška uz udio ≥ 50%): sistem šalje mali broj mejlova
 * dnevno, pa bi zahtjev za više grešaka značio da ispad kod jednog jedinog termina
 * prođe nevidljivo. Lažni alarm košta crvenu oznaku u nadzoru; propušten alarm košta
 * zakonski rok o kojem niko nije obaviješten.
 *
 * 5xx se vraća SAMO automatskom pozivaocu (GET = Vercel Cron), jer je tamo HTTP status
 * jedini signal koji nadzor vidi. Ručni POST ostaje 200 sa punim tijelom: dugme
 * „Pokreni sada" u postavkama na !res.ok odbaci tijelo i prikaže samo generičku poruku
 * (app/(dashboard)/postavke/actions.ts), pa bi 500 čovjeku ODUZEO brojače grešaka koje
 * upravo treba da vidi. Kvar je i tako vidljiv objema stranama — kroz `dijagnostika`.
 */
const PRAG_UDJELA_GRESAKA = 0.5

// Polja su opcionalna namjerno: `odgoda`/`prekinut` se pozivaju i nad preskočenim
// pre-due objektom i nad rezultatima, a stariji pozivaoci (skripte, mockovi) ne moraju
// ih imati — nedostatak se čita kao "ništa nije odgođeno", ne kao NaN u nadzoru.
const odgoda = (r: { deferred?: number }): number => r.deferred ?? 0
const prekinut = (r: { prekinutoZbogVremena?: boolean }): boolean => r.prekinutoZbogVremena === true

async function izvrsi(req: Request) {
  const pocetak = Date.now()
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

  // Prekidač (podsjetnici_aktivni) i izabrani sat važe SAMO za automatski (cron) GET;
  // POST (ručno „Pokreni sada" / test) ih namjerno preskače. Dnevni marker gejtuje
  // isključivo pre-due: post-due ima vlastitu idempotenciju (claim_post_due, jedan red
  // po terminu, ciklusu i kanalu u post_due_obavijesti), pa mu dnevni marker nije
  // potreban — gejtovanje njime bi značilo da istekli rok čeka do sutra i onda kad je
  // pre-due za taj dan već odrađen.
  const { sat, datum } = lokalniSatIDatum(new Date())
  let preskocenRazlog: PreDuePreskocen | null = null
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
    if (sat < vrijemeSat) {
      return NextResponse.json({ ok: true, skipped: "izvan_sata" })
    }
    // Jeftin predfiltar nad već pročitanim redom — štedi RPC kad je marker očito
    // današnji. Odluka NIJE ovdje: autoritativan je atomski claim niže.
    if (!trebaSlatiSada(vrijemeSat, post?.zadnje_slanje_datum ?? null, new Date())) {
      preskocenRazlog = "vec_slato_danas"
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

  // B4 — ATOMSKI CLAIM dnevnog pre-due kruga. Ide TEK OVDJE, poslije svih izlaza koji
  // ne šalju ništa (401, iskljuceni, izvan_sata, nema ključa): claim koji bi se uzeo pa
  // odbacio 500-om potrošio bi dan, a pre-due se do sutra više ne bi ni pokušao.
  //
  // Uzima ga i POST: ručno „Pokreni sada" je do sada zaobilazilo marker POTPUNO, pa je
  // klik poslije cron kruga slao ISTE podsjetnike drugi put (runReminders šalje mejl
  // prije upisa u `podsjetnici`, unique tamo hvata duplikat prekasno). Sat i prekidač
  // POST i dalje ne gledaju — samo dnevni krug.
  //
  // dryRun je izuzet: suvi test ne smije potrošiti dan pravom slanju.
  let claimUzet = false
  if (!preskocenRazlog && !dryRun) {
    const claim = await zauzmiPreDueKrug(supabase, datum)
    if (claim.ishod === "zauzeto") claimUzet = true
    else if (claim.ishod === "vec_zauzeto") preskocenRazlog = "vec_slato_danas"
    else {
      // Fail-closed: bez potvrđenog claim-a ne diramo pre-due (radije propušten krug
      // nego duplikat mejla klijentu). Post-due i digest imaju vlastite claim-ove i
      // nastavljaju normalno, a razlog je vidljiv u odgovoru i u logu.
      console.error("[cron/reminders] claim_pre_due nije uspio:", claim.poruka)
      preskocenRazlog = "marker_greska"
    }
  }

  try {
    const posalji = dryRun ? { send: drySend, dryRun: true } : {}
    // preDue UVIJEK ima isti oblik (sent/skipped/errors kao nizovi, deferred kao broj) bez
    // obzira da li je stvarno pokrenut ili preskočen zbog dnevnog markera — potrošači (UI,
    // testovi) rade .sent.length/.skipped.length bez provjere tipa. Razlog preskakanja ide u
    // odvojeno `preskocen` polje, ne u `skipped` (koje bi inače prešlo sa niza na string).
    let preDue: ReminderRunResult | { sent: []; skipped: []; errors: []; deferred: 0; preskocen: PreDuePreskocen }
    if (preskocenRazlog) {
      preDue = { sent: [], skipped: [], errors: [], deferred: 0, preskocen: preskocenRazlog }
    } else {
      try {
        preDue = await runReminders(supabase, posalji)
      } catch (e) {
        // Claim je već upisan, a krug nije ni počeo da šalje: runReminders baca
        // ISKLJUČIVO prije prvog mejla (loadRecipientIndex / get_due_podsjetnici) —
        // per-red greške hvata iznutra i vraća ih u `errors`. Zato je sigurno vratiti
        // dan u opticaj; bez toga bi jedan pad RPC-a pojeo cijeli dnevni krug.
        if (claimUzet) {
          const povrat = await oslobodiPreDueKrug(supabase, datum)
          if (!povrat.oslobodjen) {
            console.error(
              "[cron/reminders] pre-due je pao, a dnevni claim nije vraćen:",
              povrat.poruka ?? "marker je u međuvremenu promijenjen",
            )
          }
        }
        throw e
      }
    }
    // Rokovi su APSOLUTNI (mjereni od početka zahtjeva), ne "koliko još smije trajati":
    // pre-due je već potrošio dio budžeta i to se mora vidjeti u ostatku.
    const rokSvega = pocetak + maxDuration * 1000 - REZERVA_ODGOVOR_MS
    const rokPostDue = rokSvega - REZERVA_DIGEST_MS
    const postDue = await runPostDue(supabase, { ...posalji, deadlineAt: rokPostDue })
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
      digest = await runDigest(supabase, { ...posalji, deadlineAt: rokSvega })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Greška"
      console.error("[cron/reminders] runDigest je pukao:", message)
      digest = { error: message }
    }

    // Zdravlje slanja preko sva tri kruga. `digest` može biti oblik greške (pao je
    // cijeli krug) — tada nema ni pokušaja ni grešaka slanja koje bi se brojale;
    // taj pad je već zaseban signal u tijelu odgovora i namjerno ne ruši cron sam po
    // sebi (v. komentar iznad: pre-due i post-due su do tad već poslali prave mejlove).
    const digestRez = "error" in digest ? null : digest
    const poslato = preDue.sent.length + postDue.sent.length + (digestRez?.sent.length ?? 0)
    const greske = preDue.errors.length + postDue.errors.length + (digestRez?.errors.length ?? 0)
    const pokusaji = poslato + greske
    const udioGresaka = pokusaji > 0 ? greske / pokusaji : 0
    const slanjeNeispravno = greske > 0 && udioGresaka >= PRAG_UDJELA_GRESAKA
    const prijaviNeuspjeh = slanjeNeispravno && req.method === "GET"

    const dijagnostika = {
      poslato,
      greske,
      udioGresaka: Number(udioGresaka.toFixed(3)),
      odgodjeno: odgoda(preDue) + odgoda(postDue) + (digestRez ? odgoda(digestRez) : 0),
      // Odgoda nije greška, ali jeste stanje koje treba vidjeti: ako raste iz sata u
      // sat, cap ili budžet ne stižu backlog i treba podići REMINDER_MAX_PER_RUN /
      // sniziti REMINDER_BATCH_DELAY_MS.
      prekinutoZbogVremena: prekinut(postDue) || (digestRez ? prekinut(digestRez) : false),
      trajanjeMs: Date.now() - pocetak,
      // Mašinski čitljiva zastavica: ista ocjena bez obzira na metod, pa i ručni POST
      // (koji ostaje 200) nosi puni signal kvara u tijelu.
      slanjeNeispravno,
    }
    if (slanjeNeispravno) {
      console.error(
        `[cron/reminders] udio grešaka slanja ${dijagnostika.udioGresaka} (${greske}/${pokusaji})` +
        (prijaviNeuspjeh ? " — vraćam 500 da kvar bude vidljiv u nadzoru" : " — ručni poziv, status ostaje 200"),
      )
    }
    return NextResponse.json(
      { preDue, postDue, digest, dijagnostika },
      // Tijelo ostaje puno: rezultati poslatih mejlova se NE gube time što je run crven.
      { status: prijaviNeuspjeh ? 500 : 200 },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : "Greška"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * O1 — otkucaj („srce"). Omotač oko `izvrsi`, NAMJERNO izvan njega: nijedna postojeća
 * `return` grana se ne dira, a ishod se izvodi iz odgovora koji ruta ionako vraća.
 *
 * Zašto uopšte: mrtav cron i miran dan ostavljaju identičan trag u bazi (nikakav), pa se
 * pre-due motor mogao zaustaviti na 9 dana bez ijednog signala. Otkucaj se upisuje i kad
 * krug ne pošalje ništa — odsustvo svježeg otkucaja je onda dokaz kvara, a ne tišina.
 *
 * 401 se ne bilježi: neautorizovan poziv nije naš cron i ne smije moći ugasiti alarm.
 * Upis nikad ne baca i ne mijenja odgovor (v. lib/reminders/otkucaj.ts).
 */
async function handle(req: Request) {
  const odgovor = await izvrsi(req)
  if (odgovor.status === 401) return odgovor
  type Tijelo = {
    ok?: boolean
    skipped?: string
    error?: string
    dijagnostika?: Record<string, unknown>
    preDue?: { preskocen?: string }
  }
  let tijelo: Tijelo | null = null
  try {
    tijelo = (await odgovor.clone().json()) as Tijelo
  } catch {
    // Odgovor bez JSON tijela ne smije oboriti upis otkucaja — status je i dalje signal.
  }
  await zabiljeziOtkucaj(
    createAdminSupabaseClient(),
    "podsjetnici",
    ishodIzOdgovora(odgovor.status, tijelo),
    {
      ...(tijelo?.dijagnostika ?? {}),
      ...(tijelo?.skipped ? { razlog: tijelo.skipped } : {}),
      ...(tijelo?.preDue?.preskocen ? { preDuePreskocen: tijelo.preDue.preskocen } : {}),
      metod: req.method,
    },
    tijelo?.error ?? null,
  )
  return odgovor
}

// Vercel Cron poziva GET (uz Authorization: Bearer $CRON_SECRET); POST ostaje za ručno/test.
export const GET = handle
export const POST = handle
