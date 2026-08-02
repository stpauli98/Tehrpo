import { NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import mammoth from "mammoth"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { downloadDokument } from "@/lib/supabase/storage"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "dokumenti" })

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/**
 * MIME tipovi koje smijemo servirati INLINE sa vlastitog origin-a.
 *
 * Namjerno uža lista od `ALLOWED_MIME` (lib/dokumenti.ts) i namjerno bez `startsWith("image/")`:
 * `mime_type` je korisnički unos (dolazi iz `file.type` pri uploadu), pa bi prefiks provjera
 * pustila `image/svg+xml` — a SVG servisan sa našeg origin-a je izvršni dokument (same-origin XSS).
 * Sve van liste ide u „ne može se prikazati", ne u stream.
 */
const INLINE_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"])

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

/** RFC 5987 `filename*` — ime fajla je korisnički unos (ćirilica, navodnici, CR/LF). */
function inlineDisposition(naziv: string): string {
  const ascii = naziv.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(naziv)}`
}

/**
 * Pregled dokumenta bez preuzimanja.
 *
 * Dva režima iste rute:
 *  - bez parametara → METAPODACI (JSON):
 *      DOCX → `{ vrsta: "html" }`; preglednik ga ne ume prikazati, pa se pretvara
 *      u HTML mammoth-om — isti put koji `/zapisnici` već koristi.
 *      PDF/slika → `{ vrsta: "url" }` gdje je `url` RELATIVNA putanja nazad na ovu rutu
 *      (`?sadrzaj=1`), pa `iframe`/`img` sadržaj povlače kroz server pod sesijom korisnika.
 *  - `?sadrzaj=1` → SAM BAJT-STREAM fajla (`inline`, `no-store`, `nosniff`).
 *
 * Zašto ne potpisani Storage URL (kako je bilo do 02.08.2026.): taj URL je bio
 * bearer-token u query stringu — radio je 10 minuta BEZ sesije, sa bilo kog uređaja,
 * za bilo koga kome se proslijedi. To je rušilo pravilo „uloga `pregled` gleda na ekranu,
 * bez preuzimanja i izvoza" (potvrđeno 30.07.2026.): korisnik bez prava preuzimanja
 * mogao je URL iz DOM-a otvoriti u novoj kartici i snimiti fajl. Stream kroz server
 * nema token, prestaje da radi u trenutku odjave i podliježe RLS-u na svakom zahtjevu.
 *
 * S1: pad Storage-a/konverzije se razlikuje od „tip se ne može prikazati" —
 * prvo je 500, drugo je uspješan odgovor sa `vrsta: "nedostupan"`.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  const trazenSadrzaj = new URL(req.url).searchParams.get("sadrzaj") === "1"

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
  // RLS je jedini gate: korisnik koji dokument ne smije vidjeti dobije prazan red → 404.
  if (!dok) return NextResponse.json({ error: t("dokumentNePostoji") }, { status: 404 })

  const mime = mimeIz(dok.naziv, dok.mime_type)

  // ── Bajtovi (ono što `iframe`/`img` traži) ─────────────────────────────────
  if (trazenSadrzaj) {
    if (!INLINE_MIME.has(mime)) {
      return NextResponse.json({ error: t("pregledNijeDostupan") }, { status: 415 })
    }
    try {
      const buffer = await downloadDokument(dok.storage_path)
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          // Tip iz ALLOWLIST-e, ne iz baze — `nosniff` uz to sprječava da preglednik
          // sam „pogodi" izvršni tip za fajl sa lažnim `mime_type`.
          "Content-Type": mime,
          "Content-Length": String(buffer.length),
          "Content-Disposition": inlineDisposition(dok.naziv),
          "X-Content-Type-Options": "nosniff",
          // Bez keširanja: sadržaj je privatan i pravo pristupa se može oduzeti
          // između dva zahtjeva (deaktivacija, uklonjena dodjela firme).
          "Cache-Control": "private, no-store, max-age=0",
        },
      })
    } catch (e) {
      console.error("Preuzimanje sadržaja za pregled nije uspjelo:", e)
      return NextResponse.json({ error: t("pregledGreska") }, { status: 500 })
    }
  }

  // ── Metapodaci ─────────────────────────────────────────────────────────────
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

  if (INLINE_MIME.has(mime)) {
    // Relativna, same-origin putanja: preglednik je traži sa sesijskim kolačićima,
    // pa i sadržaj prolazi kroz istu RLS provjeru kao i ovaj odgovor. Ništa se ne
    // potpisuje i ništa ne ostaje upotrebljivo van prijavljene sesije.
    return NextResponse.json({
      vrsta: "url",
      naziv: dok.naziv,
      mime,
      url: `/api/dokumenti/${encodeURIComponent(id)}/pregled?sadrzaj=1`,
    })
  }

  return NextResponse.json({ vrsta: "nedostupan", naziv: dok.naziv })
}
