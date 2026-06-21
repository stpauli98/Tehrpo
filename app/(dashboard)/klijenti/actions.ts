'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ActionResult =
  | { ok: true }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const optionalText = (max: number) =>
  z.string().max(max).optional().or(z.literal("").transform(() => undefined))

const createKlijentSchema = z.object({
  naziv: z.string().min(1, "Naziv je obavezan").max(200),
  napomena: optionalText(2000),
})

export async function createKlijent(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = createKlijentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from("klijenti").insert({
    naziv: parsed.data.naziv,
    napomena: parsed.data.napomena ?? null,
  })
  if (error) {
    // UNIQUE constraint na naziv → prijateljska poruka
    const msg = /duplicate|unique/i.test(error.message)
      ? "Klijent sa tim nazivom već postoji."
      : error.message
    return { ok: false, message: msg }
  }
  revalidatePath("/klijenti")
  return { ok: true }
}
