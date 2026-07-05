// Prevodive URL putanje — fizičke (srpske) rute ostaju izvor istine; ovaj modul
// mapira segmente na jezik deploymenta za linkove/redirekcije koje app generiše.
//
// VAŽNO: ovaj fajl se importuje iz next.config.ts (rewrites/redirects) — NE SMIJE
// vući React ni bilo šta van lib/locale.ts (mora raditi u Node kontekstu bez JSX/DOM-a).
// Relativan import (ne "@/...") — next.config.ts transpajlacija ne rješava
// tsconfig "paths" alias, samo je webpack/Turbopack build aplikacije rješava.
import { APP_LOCALE, type Locale } from "../lib/locale"

// Fizičke (srpske) putanje → prevodi. Segment koji nije u mapi ostaje isti.
export const ROUTE_MAP: Record<string, { en: string; de: string }> = {
  "klijenti": { en: "clients", de: "kunden" },
  "termini": { en: "appointments", de: "termine" },
  "obilasci": { en: "visits", de: "begehungen" },
  "plan-aktivnosti": { en: "activity-plan", de: "aktivitaetsplan" },
  "zapisnici": { en: "records", de: "protokolle" },
  "dokumenti": { en: "documents", de: "dokumente" },
  "pregled": { en: "overview", de: "uebersicht" },
  "prikaz": { en: "view", de: "ansicht" },
  "postavke": { en: "settings", de: "einstellungen" },
  "prijava": { en: "login", de: "anmeldung" },
  "zaboravljena-lozinka": { en: "forgotten-password", de: "passwort-vergessen" },
  "nova-lozinka": { en: "new-password", de: "neues-passwort" },
  "odjava": { en: "logout", de: "abmeldung" },
}

/** Prevodi svaki segment putanje nezavisno (npr. /auth/nova-lozinka → /auth/new-password: "auth" nije u mapi i ostaje). */
export function localizeHref(path: string, locale: Locale = APP_LOCALE): string {
  if (locale === "sr") return path
  const [pathname, query] = path.split("?")
  const segs = (pathname ?? "").split("/").map((s) => ROUTE_MAP[s]?.[locale] ?? s)
  return segs.join("/") + (query ? `?${query}` : "")
}

export const href = (path: string) => localizeHref(path)
