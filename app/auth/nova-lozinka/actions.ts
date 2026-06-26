"use server"
import { z } from "zod"
import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ActionResult = { ok: false; message: string } | { ok: true }

export async function postaviLozinku(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.string().min(8, "Lozinka mora imati bar 8 znakova").safeParse(formData.get("lozinka"))
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Greška pri validaciji." }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data })
  if (error) return { ok: false, message: "Link je istekao ili je nevažeći. Zatražite novi." }
  redirect("/pregled")
}
