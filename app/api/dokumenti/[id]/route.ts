import { NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { signedUrl } from "@/lib/supabase/storage"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "dokumenti" })

/**
 * Vraća potpisani URL za preuzimanje (S13): greška je JSON sa i18n `error`, uspjeh je
 * `{ url }` koji `PreuzmiDokumentButton` otvara TEK nakon `res.ok` provjere.
 *
 * Zašto `{ url }` a ne redirect + blob: Supabase Storage šalje `access-control-allow-origin: *`,
 * ali NE i `access-control-expose-headers`, pa `Content-Disposition` finalnog (cross-origin)
 * odgovora nije čitljiv iz `fetch`-a — blob varijanta bi izgubila stvarno ime fajla. Potpisani
 * URL već nosi `download=<naziv>`, pa ime ostaje ispravno.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: dok } = await supabase
    .from("dokumenti")
    .select("storage_path, naziv")
    .eq("id", id)
    .maybeSingle()
  if (!dok) return NextResponse.json({ error: t("dokumentNePostoji") }, { status: 404 })

  try {
    const url = await signedUrl(dok.storage_path, { downloadName: dok.naziv })
    return NextResponse.json({ url })
  } catch (e) {
    console.error("Potpisani URL za dokument nije uspio:", e)
    return NextResponse.json({ error: t("preuzimanjeNijeUspjelo") }, { status: 500 })
  }
}
