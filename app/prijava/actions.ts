"use server"
import { z } from "zod"
import { createTranslator } from "next-intl"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import { href } from "@/i18n/routes"

export type ActionResult = { ok: false; message?: string } | { ok: true }

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "auth" })

const schema = z.object({
  email: z.string().email(t("prijava.greske.email")),
  lozinka: z.string().min(1, t("prijava.greske.lozinka")),
})

export async function prijaviSe(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, message: t("prijava.greske.nepotpunoUnijeto") }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.lozinka,
  })
  if (error) return { ok: false, message: t("prijava.greske.pogresnoUneseno") }
  revalidatePath("/", "layout")
  redirect(href("/pregled"))
}
