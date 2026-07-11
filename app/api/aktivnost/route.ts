import { NextResponse } from "next/server"
import { z } from "zod"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const AKCIJE = ["NAVIGATE", "VIEW", "LOGIN", "LOGOUT", "FILTER"] as const

const dogadjajSchema = z.object({
  akcija: z.enum(AKCIJE),
  entitet: z.string().max(100).nullable(),
  entitet_id: z.string().max(200).nullable(),
  detalji: z.record(z.string(), z.any()).nullable(),
})

const bodySchema = z.object({
  dogadjaji: z.array(dogadjajSchema).min(1).max(50),
})

export async function POST(req: Request) {
  let telo
  try {
    telo = bodySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc("zabiljezi_dogadjaje", { p_dogadjaji: telo.dogadjaji })
  if (error) return NextResponse.json({ ok: false }, { status: 500 })
  return NextResponse.json({ ok: true })
}
