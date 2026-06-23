/**
 * Test DB helper — radi protiv CLOUD Supabase-a (bez lokalnog Dockera).
 * Čita NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY iz process.env,
 * a kao fallback parsira .env.local (aktivni, ne-zakomentarisani red).
 *
 * ⚠️ Mutacije idu na ISTU cloud bazu koju koristi app — vidi napomenu u README/planu.
 */
import { readFileSync } from "node:fs"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

function envVar(key: string): string {
  if (process.env[key]) return process.env[key] as string
  let content = ""
  try {
    content = readFileSync(".env.local", "utf8")
  } catch {
    return ""
  }
  const line = content
    .split("\n")
    .find((l) => l.trimStart().startsWith(`${key}=`))
  return line ? line.slice(line.indexOf("=") + 1).trim() : ""
}

export const db: SupabaseClient = createClient(
  envVar("NEXT_PUBLIC_SUPABASE_URL"),
  envVar("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
)

/** Prvi termin (id) sa zadanim izvedenim statusom. */
export async function terminIdByStatus(status: string): Promise<string> {
  const { data } = await db
    .from("termini_view")
    .select("id")
    .eq("status_izvedeni", status)
    .limit(1)
  return (data?.[0]?.id as string) ?? ""
}

/** Prva aktivna vrsta provjere (id). */
export async function firstActiveVrstaId(): Promise<string> {
  const { data } = await db
    .from("vrste_provjera")
    .select("id")
    .eq("aktivna", true)
    .order("naziv")
    .limit(1)
  return (data?.[0]?.id as string) ?? ""
}

/** Postavi podrazumevani interval (mjeseci) na vrsti. */
export async function setVrstaInterval(vrstaId: string, mjeseci: number): Promise<void> {
  await db
    .from("vrste_provjera")
    .update({ podrazumevani_interval_mjeseci: mjeseci })
    .eq("id", vrstaId)
}

/** Prvi KASNI termin (id) za datu vrstu. Vraća "" ako ga nema. */
export async function kasniTerminForVrsta(vrstaId: string): Promise<string> {
  const { data } = await db
    .from("termini_view")
    .select("id")
    .eq("vrsta_provjere_id", vrstaId)
    .eq("status_izvedeni", "kasni")
    .limit(1)
  return (data?.[0]?.id as string) ?? ""
}

/** Obriši sve redove iz podsjetnici (zamjena za TRUNCATE; bez lokalnog psql-a). */
export async function clearPodsjetnici(): Promise<void> {
  await db.from("podsjetnici").delete().gte("dana_prije", 0)
}

/** Prvi klijent (id) po nazivu. */
export async function firstKlijentId(): Promise<string> {
  const { data } = await db.from("klijenti").select("id").order("naziv").limit(1)
  return (data?.[0]?.id as string) ?? ""
}

/** Ubaci planirani termin; vrati id. */
export async function insertTermin(input: {
  klijentId: string
  vrstaId: string
  rok: string
}): Promise<string> {
  const { data } = await db
    .from("termini")
    .insert({
      klijent_id: input.klijentId,
      vrsta_provjere_id: input.vrstaId,
      rok_dospijeca: input.rok,
      status: "planirano",
    })
    .select("id")
    .single()
  return (data?.id as string) ?? ""
}

/** Obriši termin po id-u (čišćenje nakon testa). */
export async function deleteTermin(id: string): Promise<void> {
  if (id) await db.from("termini").delete().eq("id", id)
}
