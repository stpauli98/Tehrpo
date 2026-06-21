import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runReminders } from "@/lib/reminders/runReminders"
import { drySend } from "@/lib/email/resend"

const DRY = process.argv.includes("--dry")

async function main() {
  const supabase = createAdminSupabaseClient()
  const result = await runReminders(supabase, DRY ? { send: drySend } : {})
  console.log(JSON.stringify(result, null, 2))
  console.log(`\n✅ Poslato: ${result.sent.length} | Preskočeno: ${result.skipped.length} | Greške: ${result.errors.length}`)
}

main().catch((err) => {
  console.error("❌ send-reminders:", err)
  process.exit(1)
})
