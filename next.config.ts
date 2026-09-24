import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { ROUTE_MAP } from "./i18n/routes";
import { parseLocale } from "./lib/locale";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const locale = parseLocale(process.env.NEXT_PUBLIC_APP_LOCALE);

// "nova-lozinka" fizički živi na /auth/nova-lozinka (dva segmenta), ne na top-levelu —
// generička petlja ispod pravi top-level pravila, pa se ova ruta izuzima i dodaje eksplicitno
// sa "/auth" prefiksom.
const NESTED_ROUTES: Record<string, string> = { "nova-lozinka": "auth" };

/**
 * Empirijski provjereno na Next 16.2.9 (next build + next start, `de` build, i za
 * rewrites i za redirects): `source: "/${from}/:path*"` SAM pokriva i goli segment
 * (npr. zahtjev za samo "/kunden" bez ičega iza) — "/:path*" pokriva nula-ili-više
 * segmenata, uključujući nula. Testirano na PUBLIC rutama (/anmeldung,
 * /passwort-vergessen, /auth/neues-passwort, /prijava, /zaboravljena-lozinka) da bi se
 * izbjegao lažni pozitivan rezultat od proxy auth-gate redirekcije. Detalji u
 * task-14-report.md. Zato je DOVOLJNO jedno pravilo po ruti — bez posebnog "golog"
 * pravila.
 */
function rule(from: string, to: string): { source: string; destination: string } {
  return { source: `/${from}/:path*`, destination: `/${to}/:path*` };
}

/**
 * Sigurnosna zaglavlja. Do 31.07.2026. aplikacija nije slala NIJEDNO — ni CSP, ni
 * HSTS, ni X-Frame-Options — što je bio razlog zašto su dva nalaza iz audita bila
 * iskoristiva umjesto ublažena.
 *
 * Supabase origin mora biti eksplicitno dozvoljen: pregled dokumenta učitava PDF
 * u `<iframe>` i slike u `<img>` sa potpisanog Storage URL-a, a browser klijent
 * priča sa REST/Auth endpointima. Bez ovoga bi pregled dokumenata pukao.
 */
const supabaseOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
})();

// `script-src` NAMJERNO nosi 'unsafe-inline': Next App Router hidraciju ubacuje
// inline `<script>`-ovima (self.__next_f.push), a nonce bi tražio da svaka strana
// pređe na dinamički render. Zato CSP ovdje NIJE odbrana od XSS-a — XSS se rješava
// sanitizacijom na izvoru (v. lib/html-sanitize.ts). Ono što CSP ovdje stvarno
// donosi je `img-src`/`connect-src`, tj. gašenje tihe eksfiltracije preko
// učitavanja vanjskog resursa, i `frame-ancestors` protiv clickjackinga.
const csp = [
  `default-src 'self'`,
  `base-uri 'self'`,
  `object-src 'none'`,
  `frame-ancestors 'none'`,
  `form-action 'self'`,
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  `font-src 'self' data:`,
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}${process.env.NODE_ENV === "development" ? " ws: http://localhost:*" : ""}`,
  `frame-src 'self' blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
].join("; ");

const SIGURNOSNA_ZAGLAVLJA = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // HSTS samo u produkciji — na localhostu bi zaključao http za cijeli dev.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SIGURNOSNA_ZAGLAVLJA }];
  },
  experimental: {
    // Default je 1 MB; dokumenti/fotografije lako pređu. Klijent dodatno ograničava na 10 MB.
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  async rewrites() {
    if (locale === "sr") return [];
    const rules: { source: string; destination: string }[] = [];
    for (const [sr, tr] of Object.entries(ROUTE_MAP)) {
      const translated = tr[locale];
      if (translated === sr) continue; // no-op segment za ovaj locale
      const prefix = NESTED_ROUTES[sr];
      if (prefix) {
        rules.push(rule(`${prefix}/${translated}`, `${prefix}/${sr}`));
      } else {
        rules.push(rule(translated, sr));
      }
    }
    return rules;
  },
  async redirects() {
    if (locale === "sr") return [];
    return Object.entries(ROUTE_MAP)
      .filter(([sr, tr]) => sr !== tr[locale])
      .map(([sr, tr]) => {
        const translated = tr[locale];
        const prefix = NESTED_ROUTES[sr];
        const from = prefix ? `${prefix}/${sr}` : sr;
        const to = prefix ? `${prefix}/${translated}` : translated;
        return { ...rule(from, to), permanent: true };
      });
  },
};

export default withNextIntl(nextConfig);
