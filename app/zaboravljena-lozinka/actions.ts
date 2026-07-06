"use server"
import { z } from "zod"
import { createTranslator } from "next-intl"
import { headers } from "next/headers"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { APP_LOCALE } from "@/lib/locale"
import { getMessages } from "@/i18n/messages"

export type ActionResult = { ok: boolean; message?: string }

const t = createTranslator({ locale: APP_LOCALE, messages: getMessages(), namespace: "auth" })

export async function posaljiReset(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = z.string().email().safeParse(formData.get("email"))
  if (!email.success) return { ok: false, message: t("zaboravljenaLozinka.greske.neispravanEmail") }
  const origin = (await headers()).get("origin") ?? ""
  const supabase = await createServerSupabaseClient()
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${origin}/auth/confirm`,
  })
  // Uvijek isti odgovor (ne otkrivaj postoji li email).
  return { ok: true, message: t("zaboravljenaLozinka.poruke.linkPoslat") }
}
