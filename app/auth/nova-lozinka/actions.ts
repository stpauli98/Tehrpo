"use server"
import { z } from "zod"
import { createTranslator } from "next-intl"
import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"
import { href } from "@/i18n/routes"

export type ActionResult = { ok: false; message: string } | { ok: true }

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "auth" })

export async function postaviLozinku(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z.string().min(8, t("novaLozinka.greske.minDuzina")).safeParse(formData.get("lozinka"))
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("novaLozinka.greske.validacija") }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data })
  if (error) return { ok: false, message: t("novaLozinka.greske.linkIstekao") }
  redirect(href("/pregled"))
}
