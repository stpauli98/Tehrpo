'use server'

import { revalidatePath } from "next/cache"
import { createTranslator } from "next-intl"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { friendlyDbError } from "@/lib/db-errors"
import { zahtijevajAdmina } from "@/lib/auth/zahtijevaj-admina"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import type { ActionResult } from "@/app/(dashboard)/klijenti/actions"

// Isti translator obrazac kao klijenti/actions.ts — poruke akcija ovog fajla
// više ne izlaze kao sirovi PG tekst (S2/S14).
const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "klijenti.actions" })

/** Per-firma: uključi/isključi slanje podsjetnika firmi. SSR → RLS klijenti_upd (operater sa pristupom smije). */
export async function updateKlijentSaljiPodsjetnik(
  klijentId: string,
  salji: boolean,
): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("klijenti")
    .update({ salji_podsjetnik_klijentu: salji })
    .eq("id", klijentId)
  if (error) return { ok: false, message: friendlyDbError(error) }
  revalidatePath(`/klijenti/${klijentId}`)
  // Isti flag se uređuje i iz Postavke → „Ko šta prima" (SaljiFirmiToggle); bez ovoga
  // tabela tamo ostane stale nakon toggle-a.
  revalidatePath("/postavke")
  return { ok: true }
}

/** Označi/odznači kontakt kao primaoca firminih podsjetnika. SSR → RLS kontakt_osobe (ima_pristup_klijentu). */
export async function updateKontaktPodsjetnikPrimalac(
  kontaktId: string,
  klijentId: string,
  primalac: boolean,
): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("kontakt_osobe")
    .update({ podsjetnik_primalac: primalac })
    .eq("id", kontaktId)
    .eq("klijent_id", klijentId)
  if (error) return { ok: false, message: friendlyDbError(error) }
  revalidatePath(`/klijenti/${klijentId}`)
  return { ok: true }
}

/** Dodaj ad-hoc „čistu" adresu (nije kontakt) u firmine primaoce. SSR → RPC dodaj_podsjetnik_email (RLS klijenti_upd). */
export async function dodajPodsjetnikEmail(klijentId: string, email: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { data: status, error } = await supabase.rpc("dodaj_podsjetnik_email", {
    p_klijent_id: klijentId, p_email: email,
  })
  if (error) return { ok: false, message: friendlyDbError(error) }
  if (status !== "ok") {
    const msg =
      status === "nevalidan" ? t("podsjetnikEmailNevalidan")
      : status === "postoji" ? t("podsjetnikEmailPostoji")
      : status === "kontakt" ? t("podsjetnikEmailKontakt")
      : t("podsjetnikEmailNijeDodat")
    return { ok: false, message: msg }
  }
  revalidatePath(`/klijenti/${klijentId}`)
  return { ok: true }
}

/** Ukloni ad-hoc adresu iz firminih primalaca. SSR → RPC ukloni_podsjetnik_email (RLS klijenti_upd). */
export async function ukloniPodsjetnikEmail(klijentId: string, email: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc("ukloni_podsjetnik_email", {
    p_klijent_id: klijentId, p_email: email,
  })
  if (error) return { ok: false, message: friendlyDbError(error) }
  revalidatePath(`/klijenti/${klijentId}`)
  return { ok: true }
}

/** Postavi tačan skup dodijeljenih radnika za firmu (zamijeni). ADMIN-ONLY (kk_wr = je_admin()). */
export async function postaviDodjeleZaKlijenta(
  klijentId: string,
  korisnikIds: string[],
): Promise<ActionResult> {
  await zahtijevajAdmina()
  // SSR (RLS) klijent: kk_wr = je_admin() prolazi za admina; auth.uid() postavljen → audit hvata aktera
  // (service-role bi upisao korisnik_id=NULL).
  const supabase = await createServerSupabaseClient()
  if (korisnikIds.length > 0) {
    const { data: valid, error: chkErr } = await supabase.from("korisnici").select("id").in("id", korisnikIds)
    if (chkErr) return { ok: false, message: friendlyDbError(chkErr) }
    if (!valid || valid.length !== korisnikIds.length) {
      return { ok: false, message: t("nepostojeciKorisnik") }
    }
  }
  const { error: delErr } = await supabase.from("korisnik_klijent").delete().eq("klijent_id", klijentId)
  if (delErr) return { ok: false, message: friendlyDbError(delErr) }
  if (korisnikIds.length > 0) {
    const rows = korisnikIds.map((korisnik_id) => ({ korisnik_id, klijent_id: klijentId }))
    const { error: insErr } = await supabase.from("korisnik_klijent").insert(rows)
    if (insErr) return { ok: false, message: friendlyDbError(insErr) }
  }
  revalidatePath(`/klijenti/${klijentId}`)
  revalidatePath("/postavke")
  return { ok: true }
}
