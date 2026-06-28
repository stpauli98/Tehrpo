// Brending aplikacije — centralizovano na jednom mjestu.
// Mijenja se ISKLJUČIVO preko env varijabli, bez izmjene koda:
//   NEXT_PUBLIC_APP_NAME     — naziv prikazan u interfejsu
//   NEXT_PUBLIC_APP_TAGLINE  — podnaslov pored naziva
// NEXT_PUBLIC_ varijable se ugrađuju u build, pa rade i na serveru i u klijentu.
// Ako varijabla nije postavljena, default je "Tehpro" → Tehpro instanca ostaje nepromijenjena.

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Tehpro"

export const APP_TAGLINE =
  process.env.NEXT_PUBLIC_APP_TAGLINE?.trim() || "Sistem za termine i provjere"

// Inicijal za logo-bedž (prvo slovo naziva).
export const APP_INITIAL = (APP_NAME[0] ?? "T").toUpperCase()
