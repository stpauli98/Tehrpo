import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { AKCIJE_UI } from "@/lib/aktivnost/tipovi"
import { getTrenutniKorisnik } from "@/lib/auth/current-user"
import { dohvatiAktivnostStranu } from "@/lib/queries/aktivnost"
import { parsirajAktivnostFiltere } from "@/lib/aktivnost/filteri"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

export const runtime = "nodejs"

const dogadjajSchema = z.object({
  akcija: z.enum(AKCIJE_UI),
  entitet: z.string().max(100).nullable(),
  entitet_id: z.string().max(200).nullable(),
  detalji: z.record(z.string(), z.any()).nullable(),
})

const bodySchema = z.object({
  dogadjaji: z.array(dogadjajSchema).min(1).max(50),
})

export async function POST(req: Request) {
  let telo
  try {
    telo = bodySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc("zabiljezi_dogadjaje", { p_dogadjaji: telo.dogadjaji })
  if (error) return NextResponse.json({ ok: false }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// S1: ruta nikad ne vraća sirovi PostgrestError — samo `{ error: <i18n string> }`.
const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "common" })

export async function GET(req: NextRequest) {
  // Aktivnost je admin-only i na stranici (notFound) i u bazi (je_admin guard u RPC).
  // Ruta ponavlja provjeru da ne-admin dobije 404, a ne 400 iz baze.
  const korisnik = await getTrenutniKorisnik()
  if (korisnik?.uloga !== "admin") {
    return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 404 })
  }

  const sp = req.nextUrl.searchParams
  // `upitFiltera` šalje već pretvorene UTC granice kao odIso/doIso; ručno sastavljen
  // URL može poslati kalendarske od/do. Podržana su oba: odIso/doIso imaju prednost.
  const f = parsirajAktivnostFiltere((k) => sp.get(k) ?? undefined)
  const odIso = sp.get("odIso")
  const doIso = sp.get("doIso")
  if (odIso) f.od = odIso
  if (doIso) f.do = doIso

  const rezultat = await dohvatiAktivnostStranu(f)
  if (!rezultat.ok) {
    return NextResponse.json({ error: t("greskaUcitavanja") }, { status: 400 })
  }
  return NextResponse.json({ redovi: rezultat.redovi, imaJos: rezultat.imaJos })
}
