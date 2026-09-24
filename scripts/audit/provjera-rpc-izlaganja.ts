// Sigurnosna provjera: da li SECURITY DEFINER RPC-jevi curе podatke
// korisniku s najnižim ovlaštenjem ("pregled") i anonimnom pozivaocu.
// Radi ISKLJUČIVO protiv DEMO baze. Kreira throwaway nalog i briše ga na kraju.
import { ensureKorisnik, deleteKorisnikByEmail } from "../../tests/e2e/db"
import { envVar } from "../../tests/e2e/env"
import { prepoznajCilj, DEMO_REF } from "../../lib/supabase/refs"

const URL_ = envVar("NEXT_PUBLIC_SUPABASE_URL")
const ANON = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY")

// Ref-guard: nikad ne pokreći ovo protiv PROD-a.
const cilj = prepoznajCilj(URL_)
if (cilj !== "demo") {
  throw new Error(`ODUSTAJEM: cilj nije DEMO (${cilj}); očekivan ref ${DEMO_REF}`)
}
console.log(`Cilj: DEMO (${new global.URL(URL_).hostname})\n`)

const EMAIL = "e2e-sigurnosna-provjera@example.com"
const LOZINKA = "Provjera-12345!"

async function rpc(naziv: string, token: string | null) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${naziv}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: "{}",
  })
  const tekst = await res.text()
  return { status: res.status, tijelo: tekst.slice(0, 300) }
}

async function tabela(putanja: string, token: string | null) {
  const res = await fetch(`${URL_}/rest/v1/${putanja}`, {
    headers: { apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  return { status: res.status, tijelo: (await res.text()).slice(0, 300) }
}

const RPCS = ["get_admini", "get_aktivni_korisnici", "get_zaduzeni_dodjele"]

async function main() {
  await ensureKorisnik(EMAIL, LOZINKA, "E2E Sigurnosna Provjera", "pregled")
  console.log(`Kreiran throwaway nalog: ${EMAIL} (uloga: pregled, BEZ ijedne dodjele klijenta)\n`)

  const login = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: LOZINKA }),
  })
  if (!login.ok) throw new Error(`login: ${login.status} ${await login.text()}`)
  const token = (await login.json()).access_token as string

  console.log("── A) ANONIMAN pozivalac (samo anon ključ, bez JWT) ──")
  for (const f of RPCS) console.log(`  rpc/${f}`.padEnd(32), JSON.stringify(await rpc(f, null)))
  console.log("  korisnici (tabela)".padEnd(32), JSON.stringify(await tabela("korisnici?select=ime,email", null)))
  console.log("  klijenti (tabela)".padEnd(32), JSON.stringify(await tabela("klijenti?select=naziv", null)))

  console.log("\n── B) PRIJAVLJEN kao 'pregled' bez ijedne dodjele klijenta ──")
  console.log("  RLS kontrola — tabele koje NE bi smio vidjeti:")
  console.log("  korisnici (tabela)".padEnd(32), JSON.stringify(await tabela("korisnici?select=ime,email", token)))
  console.log("  klijenti (tabela)".padEnd(32), JSON.stringify(await tabela("klijenti?select=naziv", token)))
  console.log("  klijenti_view".padEnd(32), JSON.stringify(await tabela("klijenti_view?select=naziv", token)))
  console.log("  termini (tabela)".padEnd(32), JSON.stringify(await tabela("termini?select=id", token)))
  console.log("  RPC-jevi:")
  for (const f of RPCS) console.log(`  rpc/${f}`.padEnd(32), JSON.stringify(await rpc(f, token)))

  await deleteKorisnikByEmail(EMAIL)
  console.log("\nThrowaway nalog obrisan.")
}

main().catch(async (e) => {
  console.error("GREŠKA:", e.message)
  await deleteKorisnikByEmail(EMAIL).catch(() => {})
  process.exit(1)
})
