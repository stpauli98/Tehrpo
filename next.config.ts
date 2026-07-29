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

const nextConfig: NextConfig = {
  // Dozvoljava HMR/dev-resource zahtjeve preko lokalnog preview proxy-ja
  // (browser mu pristupa sa "127.0.0.1", drugačiji host od next dev servera).
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Default je 1 MB; dokumenti/fotografije lako pređu. Klijent dodatno ograničava na 10 MB.
    serverActions: {
      bodySizeLimit: "12mb",
      // Dopušta CSRF-provjeru Server Actions kad se dev server pristupa kroz
      // lokalni preview proxy (drugi origin/port od next dev servera). Next.js
      // poredi origin domenu SA PORTOM (npr. "127.0.0.1:59915"); wildcard "*"
      // ovdje ne pokriva port, samo pod-domene, pa je potreban tačan unos —
      // ažurirati port ako se preview proxy restartuje na drugom portu.
      allowedOrigins: ["localhost:3000", "127.0.0.1:59915", "127.0.0.1:63834", "127.0.0.1:65213", "127.0.0.1:53507"],
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
