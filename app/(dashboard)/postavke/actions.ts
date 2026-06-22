'use server'

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export type ActionResult =
  | { ok: true; danaPrije?: number[] }
  | { ok: false; errors?: Record<string, string[] | undefined>; message?: string }

const schema = z.object({
  // "30, 14, 7, 1" → niz brojeva
  dana_prije: z
    .string()
    .min(1, "Unesite barem jedan prag")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
        .map((x) => Number(x)),
    )
    .refine((arr) => arr.length > 0 && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 365), {
      message: "Pragovi moraju biti cijeli brojevi 0–365, odvojeni zarezom",
    }),
})

export async function updatePostavke(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { ok: false, errors: parsed.error.flatten().fieldErrors }
  // dedupe + sort opadajuće (30,14,7,1)
  const dana = Array.from(new Set(parsed.data.dana_prije)).sort((a, b) => b - a)
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("postavke")
    .update({ dana_prije: dana, updated_at: new Date().toISOString() })
    .eq("id", 1)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/postavke")
  return { ok: true, danaPrije: dana }
}

// ─── Intervali po vrsti (podrazumevani_interval_mjeseci) ─────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function updateIntervali(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  // Forma šalje polja "interval_<vrsta_uuid>" = "" | "1".."120"
  const updates: { id: string; val: number | null }[] = []
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("interval_")) continue
    const id = key.slice("interval_".length)
    if (!UUID_RE.test(id)) continue
    const s = String(raw).trim()
    if (s === "") {
      updates.push({ id, val: null })
      continue
    }
    const n = Number(s)
    if (!Number.isInteger(n) || n < 1 || n > 120) {
      return { ok: false, message: `Interval mora biti cijeli broj 1–120 ili prazno (greška: "${s}")` }
    }
    updates.push({ id, val: n })
  }
  if (updates.length === 0) return { ok: true }

  const supabase = await createServerSupabaseClient()
  // Bez await-in-loop: svi update-ovi konkurentno
  const results = await Promise.all(
    updates.map((u) =>
      supabase.from("vrste_provjera").update({ podrazumevani_interval_mjeseci: u.val }).eq("id", u.id),
    ),
  )
  const errored = results.find((r) => r.error)
  if (errored?.error) return { ok: false, message: errored.error.message }
  revalidatePath("/postavke")
  return { ok: true }
}
