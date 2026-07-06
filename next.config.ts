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
