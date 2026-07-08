'use server'

import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { zahtijevajAdmina } from "@/app/(dashboard)/postavke/actions"
import type { ActionResult } from "@/app/(dashboard)/klijenti/actions"

const EMAIL_RE_KL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Per-firma: uključi/isključi slanje firmi + adrese. SSR klijent → RLS klijenti_upd (operater sa pristupom smije). */
export async function updateKlijentPodsjetnici(
  klijentId: string,
  salji: boolean,
  emails: string[],
): Promise<ActionResult> {
  const cist = Array.from(
    new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE_KL.test(e))),
  )
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("klijenti")
    .update({ salji_podsjetnik_klijentu: salji, podsjetnik_emails: cist })
    .eq("id", klijentId)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/klijenti/${klijentId}`)
  return { ok: true }
}

/** Postavi tačan skup dodijeljenih radnika za firmu (zamijeni). ADMIN-ONLY (kk_wr = je_admin()). */
export async function postaviDodjeleZaKlijenta(
  klijentId: string,
  korisnikIds: string[],
): Promise<ActionResult> {
  await zahtijevajAdmina()
  const admin = createAdminSupabaseClient()
  if (korisnikIds.length > 0) {
    const { data: valid, error: chkErr } = await admin.from("korisnici").select("id").in("id", korisnikIds)
    if (chkErr) return { ok: false, message: chkErr.message }
    if (!valid || valid.length !== korisnikIds.length) {
      return { ok: false, message: "Nepostojeći korisnik u dodjeli." }
    }
  }
  const { error: delErr } = await admin.from("korisnik_klijent").delete().eq("klijent_id", klijentId)
  if (delErr) return { ok: false, message: delErr.message }
  if (korisnikIds.length > 0) {
    const rows = korisnikIds.map((korisnik_id) => ({ korisnik_id, klijent_id: klijentId }))
    const { error: insErr } = await admin.from("korisnik_klijent").insert(rows)
    if (insErr) return { ok: false, message: insErr.message }
  }
  revalidatePath(`/klijenti/${klijentId}`)
  revalidatePath("/postavke")
  return { ok: true }
}
