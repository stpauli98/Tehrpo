"use server"
import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export async function odjaviSe() {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  redirect("/prijava")
}
