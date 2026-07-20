/**
 * preview-emails.ts — testni harness za automatske (Resend) mejlove.
 *
 * Omogućava tri stvari, sve iza istog ulaza:
 *   1. RENDER (default, bez mreže i bez baze) — renderuje SVE automatske mejlove kao
 *      samostalne .html fajlove i ispisuje putanje, da se vizuelno pregledaju u browseru.
 *   2. DRY-RUN PRIMAOCI (`--recipients`) — pokreće stvarni reminder engine (`runReminders`)
 *      sa `drySend`, pa ispisuje TAČNE primaoce po terminu. Ništa se NE šalje niti upisuje.
 *   3. ŽIVO SLANJE (`--send-to <email>`) — pošalje po jedan primjerak svakog tipa na jednu
 *      test-adresu. Guardovano: radi SAMO ako je `EMAIL_TEST_OVERRIDE=1` (da se nikad
 *      slučajno ne pošalje). Bez `RESEND_API_KEY` sve ostaje dry-run (vidi `dryRun` flag).
 *
 * NAPOMENA o env-u: `lib/env.ts` se učitava tranzitivno (preko firmBrand/templates) i zod-om
 * validira `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` na importu — pa čak i
 * RENDER mod može trebati `--env-file=.env.local`. `--recipients` i `--send-to` uvijek trebaju env.
 *
 * Primjeri pokretanja:
 *   pnpm preview:emails                                  # render (koristi .env.local preko pnpm skripte)
 *   pnpm exec tsx --env-file=.env.local scripts/preview-emails.ts
 *   pnpm exec tsx --env-file=.env.local scripts/preview-emails.ts --out /tmp/moj-dir
 *   pnpm exec tsx --env-file=.env.local scripts/preview-emails.ts --recipients
 *   EMAIL_TEST_OVERRIDE=1 pnpm exec tsx --env-file=.env.local scripts/preview-emails.ts --send-to me@example.com
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  reminderSubject,
  reminderHtml,
  reminderHtmlFirma,
  zakazanoNakonRokaSubject,
  zakazanoNakonRokaHtml,
  testEmailSubject,
  testEmailHtml,
  rokIstekaoFirmaSubject,
  rokIstekaoFirmaHtml,
} from "@/lib/email/templates"
import { firmBrand } from "@/lib/email/firmBrand"
import { sendEmail, drySend } from "@/lib/email/resend"
import { runReminders } from "@/lib/reminders/runReminders"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

// ── Domenski fixture (SAMO domenski podaci — NE brend; brend dolazi iz template funkcija/env-a) ──
const FX = {
  klijent: "Diorit d.o.o.",
  vrsta: "Pregled aparata za gašenje",
  rok: "2026-08-15",
  lokacija: "Banja Luka",
  // Realistични linkovi za dugmad u internom mejlu (nije brend — samo URL/id):
  baseUrl: "https://tehpro-demo.nextpixel.dev",
  terminId: "11111111-1111-4111-8111-111111111111",
  klijentId: "22222222-2222-4222-8222-222222222222",
  // Zakazano nakon roka:
  zakazanoRok: "2026-06-01",
  zakazanoZakazan: "2026-07-20",
  // Rok istekao (post-due): ciklus dolazi iz zakazanog datuma koji je i sam prošao.
  istekaoRok: "2026-07-13",
  istekaoZakazan: "2026-07-15",
} as const

const DANA_USKORO = 7
const DANA_KASNI = -3

type PreviewItem = { file: string; naziv: string; subject: string; html: string }

/** Sve preview stavke (8 fajlova (interni×3, firma×3, zakazano, test)). */
function buildItems(): PreviewItem[] {
  const brand = firmBrand()
  const { klijent, vrsta, rok, lokacija, baseUrl, terminId, klijentId } = FX

  return [
    {
      file: "1-podsjetnik-interni-uskoro.html",
      naziv: "Podsjetnik (interni, sa dugmadima) — rok uskoro",
      subject: reminderSubject({ vrsta, klijent, danaDoRoka: DANA_USKORO }),
      html: reminderHtml({ klijent, vrsta, rok, danaDoRoka: DANA_USKORO, lokacija, terminId, klijentId, baseUrl }),
    },
    {
      file: "2-podsjetnik-interni-kasni.html",
      naziv: "Podsjetnik (interni, sa dugmadima) — rok kasni",
      subject: reminderSubject({ vrsta, klijent, danaDoRoka: DANA_KASNI }),
      html: reminderHtml({ klijent, vrsta, rok, danaDoRoka: DANA_KASNI, lokacija, terminId, klijentId, baseUrl }),
    },
    {
      file: "3-podsjetnik-firma-uskoro.html",
      naziv: "Podsjetnik (firma, bez dugmadi, FirmBrand) — rok uskoro",
      subject: reminderSubject({ vrsta, klijent, danaDoRoka: DANA_USKORO }),
      html: reminderHtmlFirma({ klijent, vrsta, rok, danaDoRoka: DANA_USKORO, lokacija, brand }),
    },
    {
      file: "4-podsjetnik-firma-kasni.html",
      naziv: "Podsjetnik (firma, bez dugmadi, FirmBrand) — rok kasni",
      subject: reminderSubject({ vrsta, klijent, danaDoRoka: DANA_KASNI }),
      html: reminderHtmlFirma({ klijent, vrsta, rok, danaDoRoka: DANA_KASNI, lokacija, brand }),
    },
    {
      file: "5-zakazano-nakon-roka.html",
      naziv: "Zakazano nakon roka",
      subject: zakazanoNakonRokaSubject({ vrsta, klijent }),
      html: zakazanoNakonRokaHtml({ klijent, vrsta, rok: FX.zakazanoRok, zakazan: FX.zakazanoZakazan, lokacija }),
    },
    {
      file: "6-rok-istekao-firma.html",
      naziv: "Rok istekao (firma, poziv na dogovor, FirmBrand)",
      subject: rokIstekaoFirmaSubject({ vrsta, klijent }),
      html: rokIstekaoFirmaHtml({
        klijent, vrsta, rok: FX.istekaoRok, zakazanoZa: FX.istekaoZakazan, lokacija, brand,
      }),
    },
    {
      file: "7-podsjetnik-interni-zakazan-pa-propusten.html",
      naziv: "Podsjetnik (interni) — zakazano pa propušteno",
      subject: reminderSubject({ vrsta, klijent, danaDoRoka: DANA_KASNI }),
      html: reminderHtml({
        klijent, vrsta, rok: FX.istekaoRok, danaDoRoka: DANA_KASNI, lokacija,
        zakazanoZa: FX.istekaoZakazan, terminId, klijentId, baseUrl,
      }),
    },
    {
      file: "8-test-email.html",
      naziv: "Test email (potvrda dostave)",
      subject: testEmailSubject(),
      html: testEmailHtml({ ime: "Marko Marković" }),
    },
  ]
}

/** Mod 1: renderuj sve mejlove u .html fajlove i ispiši putanje. */
function renderMode(outDir: string): void {
  mkdirSync(outDir, { recursive: true })
  const items = buildItems()

  console.log(`\n📧 RENDER MOD — ${items.length} mejla u: ${outDir}\n`)
  for (const item of items) {
    const path = join(outDir, item.file)
    writeFileSync(path, item.html, "utf-8")
    console.log(`• ${item.naziv}`)
    console.log(`  subject: ${item.subject}`)
    console.log(`  html:    ${path}\n`)
  }
  console.log(`✅ Zapisano ${items.length} HTML fajlova.`)
  console.log(`Otvori: file://${outDir}`)
}

/** Mod 2: dry-run — ispiši TAČNE primaoce po terminu bez slanja i bez audita. */
async function recipientsMode(): Promise<void> {
  const supabase = createAdminSupabaseClient()
  const result = await runReminders(supabase, { send: drySend })

  console.log("\n📬 DRY-RUN PRIMAOCI — ništa NIJE poslano, audit NIJE upisan.\n")
  console.log(`Poslato (dry): ${result.sent.length} | Preskočeno: ${result.skipped.length} | Greške: ${result.errors.length} | Odgođeno: ${result.deferred}\n`)

  if (result.sent.length > 0) {
    console.log("── SENT (dry-run) ──")
    for (const s of result.sent) {
      console.log(`• termin ${s.terminId} · ${s.danaPrije} dana prije`)
      console.log(`  → to (interni + firma BCC spojeni): ${s.to.join(", ")}`)
    }
    console.log("")
  }
  if (result.skipped.length > 0) {
    console.log("── SKIPPED ──")
    for (const s of result.skipped) {
      console.log(`• termin ${s.terminId} · ${s.danaPrije} dana prije — razlog: ${s.razlog}`)
    }
    console.log("")
  }
  if (result.errors.length > 0) {
    console.log("── ERRORS ──")
    for (const e of result.errors) {
      console.log(`• termin ${e.terminId} · ${e.danaPrije} dana prije — ${e.message}`)
    }
    console.log("")
  }
  console.log("⚠️  DRY-RUN: ništa nije poslano, audit nije upisan.")
}

/** Mod 3: živo slanje po jednog primjerka svakog tipa na jednu test-adresu (guardovano). */
async function sendToMode(email: string): Promise<void> {
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  if (!emailOk) {
    console.error(`❌ Nevažeća test-adresa: "${email}". Očekivan format: ime@domena.tld`)
    process.exit(1)
  }
  if (process.env.EMAIL_TEST_OVERRIDE !== "1") {
    console.error("❌ Živo slanje odbijeno: postavi EMAIL_TEST_OVERRIDE=1 da eksplicitno dozvoliš slanje.")
    console.error("   Primjer: EMAIL_TEST_OVERRIDE=1 pnpm exec tsx --env-file=.env.local scripts/preview-emails.ts --send-to " + email)
    process.exit(1)
  }

  const brand = firmBrand()
  const { klijent, vrsta, rok, lokacija, baseUrl, terminId, klijentId } = FX

  // Za firmin mejl: to:[email] umjesto BCC (task); ostali su normalni to:[email].
  const mails: { naziv: string; subject: string; html: string }[] = [
    {
      naziv: "Podsjetnik (interni)",
      subject: reminderSubject({ vrsta, klijent, danaDoRoka: DANA_USKORO }),
      html: reminderHtml({ klijent, vrsta, rok, danaDoRoka: DANA_USKORO, lokacija, terminId, klijentId, baseUrl }),
    },
    {
      naziv: "Podsjetnik (firma)",
      subject: reminderSubject({ vrsta, klijent, danaDoRoka: DANA_USKORO }),
      html: reminderHtmlFirma({ klijent, vrsta, rok, danaDoRoka: DANA_USKORO, lokacija, brand }),
    },
    {
      naziv: "Zakazano nakon roka",
      subject: zakazanoNakonRokaSubject({ vrsta, klijent }),
      html: zakazanoNakonRokaHtml({ klijent, vrsta, rok: FX.zakazanoRok, zakazan: FX.zakazanoZakazan, lokacija }),
    },
    {
      naziv: "Test email",
      subject: testEmailSubject(),
      html: testEmailHtml({ ime: "Marko Marković" }),
    },
  ]

  console.log(`\n📤 ŽIVO SLANJE → ${email}  (EMAIL_TEST_OVERRIDE=1)\n`)
  for (const m of mails) {
    const res = await sendEmail({ to: [email], subject: m.subject, html: m.html })
    const stanje = res.dryRun
      ? "dryRun:true (nema RESEND_API_KEY → NIJE stvarno poslato)"
      : `dryRun:false (poslato, resendId=${res.id})`
    console.log(`• ${m.naziv} — ${stanje}`)
  }
  console.log("")
}

function parseArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

async function main(): Promise<void> {
  if (process.argv.includes("--send-to")) {
    const sendTo = parseArg("--send-to")
    if (!sendTo) {
      console.error("❌ --send-to zahtijeva email adresu, npr. --send-to me@example.com")
      process.exit(1)
    }
    await sendToMode(sendTo)
    return
  }
  if (process.argv.includes("--recipients")) {
    await recipientsMode()
    return
  }
  const outDir = parseArg("--out") ?? join(tmpdir(), "tehpro-email-preview")
  renderMode(outDir)
}

main().catch((err) => {
  console.error("❌ preview-emails:", err)
  process.exit(1)
})
