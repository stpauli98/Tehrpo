import { NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import mammoth from "mammoth"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { downloadDokument, signedUrl } from "@/lib/supabase/storage"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "dokumenti" })

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/** Stariji redovi mogu imati `mime_type = null` → izvedi iz ekstenzije. */
function mimeIz(naziv: string, sacuvani: string | null): string {
  if (sacuvani) return sacuvani
  const ext = naziv.toLowerCase().split(".").pop() ?? ""
  const mapa: Record<string, string> = {
    docx: DOCX_MIME,
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  }
  return mapa[ext] ?? ""
}

/**
 * Pregled dokumenta bez preuzimanja.
 *
 * Dva ishoda po tipu fajla:
 *  - DOCX → `{ vrsta: "html" }`; preglednik ga ne ume prikazati, pa se pretvara
 *    u HTML mammoth-om — isti put koji `/zapisnici` već koristi.
 *  - PDF/slika → `{ vrsta: "url" }` sa potpisanim URL-om BEZ `downloadName`,
 *    pa ga preglednik prikaže umjesto da ga snimi.
 *
 * S1: pad Storage-a/konverzije se razlikuje od „tip se ne može prikazati" —
 * prvo je 500, drugo je uspješan odgovor sa `vrsta: "nedostupan"`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: dok, error: citanjeGreska } = await supabase
    .from("dokumenti")
    .select("storage_path, naziv, mime_type")
    .eq("id", id)
    .maybeSingle()

  if (citanjeGreska) {
    console.error("Čitanje dokumenta za pregled nije uspjelo:", citanjeGreska)
    return NextResponse.json({ error: t("pregledGreska") }, { status: 500 })
  }
  if (!dok) return NextResponse.json({ error: t("dokumentNePostoji") }, { status: 404 })

  const mime = mimeIz(dok.naziv, dok.mime_type)

  if (mime === DOCX_MIME) {
    try {
      const buffer = await downloadDokument(dok.storage_path)
      const { value } = await mammoth.convertToHtml({ buffer })
      return NextResponse.json({ vrsta: "html", naziv: dok.naziv, html: value })
    } catch (e) {
      console.error("Konverzija dokumenta za pregled nije uspjela:", e)
      return NextResponse.json({ error: t("pregledGreska") }, { status: 500 })
    }
  }

  if (mime === "application/pdf" || mime.startsWith("image/")) {
    try {
      // 10 min: pregled ostaje otvoren dok korisnik čita, a `iframe`/`img` bi
      // sa 60s znao isteći usred gledanja.
      const url = await signedUrl(dok.storage_path, { expiresIn: 600 })
      return NextResponse.json({ vrsta: "url", naziv: dok.naziv, mime, url })
    } catch (e) {
      console.error("Potpisani URL za pregled nije uspio:", e)
      return NextResponse.json({ error: t("pregledGreska") }, { status: 500 })
    }
  }

  return NextResponse.json({ vrsta: "nedostupan", naziv: dok.naziv })
}
