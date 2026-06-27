"use server"
import { z } from "zod"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ActionResult = { ok: false; message?: string } | { ok: true }

const schema = z.object({
  email: z.string().email("Neispravan email"),
  lozinka: z.string().min(1, "Unesite lozinku"),
})

export async function prijaviSe(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, message: "Unesite email i lozinku." }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.lozinka,
  })
  if (error) return { ok: false, message: "Pogrešan email ili lozinka." }
  revalidatePath("/", "layout")
  redirect("/pregled")
}
