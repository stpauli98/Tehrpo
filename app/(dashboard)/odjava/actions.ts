"use server"
import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { href } from "@/i18n/routes"

export async function odjaviSe() {
  const supabase = await createServerSupabaseClient()
  await supabase.rpc("zabiljezi_dogadjaje", {
    p_dogadjaji: [{ akcija: "LOGOUT", entitet: null, entitet_id: null, detalji: null }],
  })
  await supabase.auth.signOut()
  redirect(href("/prijava"))
}
