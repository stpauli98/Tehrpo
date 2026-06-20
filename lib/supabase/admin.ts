import { createClient } from "@supabase/supabase-js"
import { env } from "@/lib/env"

/**
 * Service role klijent — bypass-uje RLS.
 * SAMO za scripts/, cron handler-e. NIKAD u app/ ili components/.
 */
export function createAdminSupabaseClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nije postavljen")
  }
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
