"use server"
import { z } from "zod"
import { headers } from "next/headers"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ActionResult = { ok: boolean; message?: string }

export async function posaljiReset(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = z.string().email().safeParse(formData.get("email"))
  if (!email.success) return { ok: false, message: "Neispravan email." }
  const origin = (await headers()).get("origin") ?? ""
  const supabase = await createServerSupabaseClient()
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${origin}/auth/nova-lozinka`,
  })
  // Uvijek isti odgovor (ne otkrivaj postoji li email).
  return { ok: true, message: "Ako nalog postoji, poslali smo link za reset." }
}
