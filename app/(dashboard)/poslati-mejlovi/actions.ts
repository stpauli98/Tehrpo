"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export async function oznaciPregledanim(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient()
  await supabase.rpc("oznaci_mejl_pregledan", { p_id: id })
  revalidatePath("/poslati-mejlovi")
  revalidatePath("/", "layout") // osvježi nav bedž
}
