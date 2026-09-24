// Sigurnosna provjera: može li operater dodijeljen samo firmi A dobiti pristup
// fajlu firme B tako što UPIŠE tuđu storage_path u SVOJ dokumenti red?
// Radi ISKLJUČIVO protiv DEMO baze. Sve kreirano se briše na kraju.
import { createClient } from "@supabase/supabase-js"
import { ensureKorisnik, deleteKorisnikByEmail, assignKlijent } from "../../tests/e2e/db"
import { envVar } from "../../tests/e2e/env"
import { prepoznajCilj } from "../../lib/supabase/refs"

const URL_ = envVar("NEXT_PUBLIC_SUPABASE_URL")
const ANON = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY")
const SVC = envVar("SUPABASE_SERVICE_ROLE_KEY")
if (prepoznajCilj(URL_) !== "demo") throw new Error("ODUSTAJEM: cilj nije DEMO")

const admin = createClient(URL_, SVC, { auth: { persistSession: false } })
const EMAIL = "e2e-storage-path-provjera@example.com"
const LOZINKA = "Provjera-12345!"

let idKlijentA: string | null = null
let idDokRed: string | null = null

async function main() {
  console.log(`Cilj: DEMO (${new URL(URL_).hostname})\n`)

  // 1) Nađi POSTOJEĆI dokument neke firme B (žrtva) — ništa ne upisujemo u B.
  const { data: zrtve } = await admin
    .from("dokumenti").select("id, naziv, klijent_id, storage_path").limit(50)
  const zrtva = zrtve?.find((d) => d.storage_path)
  if (!zrtva) throw new Error("nema nijednog dokumenta na DEMO-u za provjeru")
  console.log(`Žrtva (firma B): dokument "${zrtva.naziv}"`)
  console.log(`  klijent_id: ${zrtva.klijent_id}`)
  console.log(`  storage_path: ${zrtva.storage_path}\n`)

  // 2) Napravi firmu A + operatera O dodijeljenog SAMO firmi A.
  const { data: kl, error: eKl } = await admin
    .from("klijenti").insert({ naziv: "E2E Provjera Firma A" }).select("id").single()
  if (eKl) throw new Error(`insert klijenta: ${eKl.message}`)
  idKlijentA = kl.id
  const uid = await ensureKorisnik(EMAIL, LOZINKA, "E2E Storage Provjera", "operater")
  await assignKlijent(uid, idKlijentA!)
  console.log(`Napadač (operater O): dodijeljen SAMO firmi A (${idKlijentA})\n`)

  // 3) Prijavi se kao O.
  const login = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: LOZINKA }),
  })
  const token = (await login.json()).access_token as string
  const kaoO = { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }

  // 4) KONTROLA: smije li O direktno čitati dokument firme B? Treba biti prazno.
  const prije = await fetch(
    `${URL_}/rest/v1/dokumenti?select=naziv&id=eq.${zrtva.id}`, { headers: kaoO })
  console.log(`KONTROLA — O čita dokument firme B direktno: ${prije.status} ${await prije.text()}`)

  // 5) KONTROLA: smije li O potpisati fajl firme B prije napada? Treba 4xx.
  const potpisPrije = await fetch(
    `${URL_}/storage/v1/object/sign/tehpro-dokumenti/${zrtva.storage_path}`,
    { method: "POST", headers: kaoO, body: JSON.stringify({ expiresIn: 60 }) })
  console.log(`KONTROLA — O potpisuje fajl firme B PRIJE napada: ${potpisPrije.status} ${(await potpisPrije.text()).slice(0, 160)}\n`)

  // 6) NAPAD: O upisuje SVOJ red (firma A) ali sa TUĐOM storage_path (firma B).
  const napad = await fetch(`${URL_}/rest/v1/dokumenti`, {
    method: "POST", headers: { ...kaoO, Prefer: "return=representation" },
    body: JSON.stringify({
      klijent_id: idKlijentA, naziv: "podmetnuto.pdf", tip: "ostalo",
      storage_path: zrtva.storage_path,
    }),
  })
  const napadTijelo = await napad.text()
  console.log(`NAPAD — O upisuje tuđi storage_path pod svoju firmu: ${napad.status}`)
  console.log(`  ${napadTijelo.slice(0, 200)}\n`)
  if (napad.ok) idDokRed = JSON.parse(napadTijelo)[0]?.id

  // 7) ISHOD: sad probaj potpisati fajl firme B.
  const potpisPoslije = await fetch(
    `${URL_}/storage/v1/object/sign/tehpro-dokumenti/${zrtva.storage_path}`,
    { method: "POST", headers: kaoO, body: JSON.stringify({ expiresIn: 60 }) })
  const potpisTijelo = await potpisPoslije.text()
  console.log(`ISHOD — O potpisuje fajl firme B POSLIJE napada: ${potpisPoslije.status}`)
  console.log(`  ${potpisTijelo.slice(0, 200)}\n`)

  if (potpisPoslije.ok) {
    const signed = JSON.parse(potpisTijelo).signedURL as string
    const fajl = await fetch(`${URL_}/storage/v1${signed}`)
    const buf = await fajl.arrayBuffer()
    console.log(`  PREUZIMANJE fajla firme B: ${fajl.status}, ${buf.byteLength} bajtova`)
    console.log(`  >>> POTVRĐENO: unakrsni pristup fajlu druge firme.`)
  } else {
    console.log(`  >>> NIJE POTVRĐENO: storage je odbio pristup.`)
  }
}

async function ocisti() {
  if (idDokRed) await admin.from("dokumenti").delete().eq("id", idDokRed)
  await deleteKorisnikByEmail(EMAIL).catch(() => {})
  if (idKlijentA) await admin.from("klijenti").delete().eq("id", idKlijentA)
  console.log("\nČišćenje završeno (obrisan podmetnuti red, nalog i test firma).")
}

main().catch((e) => { console.error("GREŠKA:", e.message); process.exitCode = 1 }).finally(ocisti)
