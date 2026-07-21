import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runReminders } from "@/lib/reminders/runReminders"
import { runPostDue } from "@/lib/reminders/runPostDue"
import { runDigest } from "@/lib/reminders/runDigest"
import { drySend } from "@/lib/email/resend"

const DRY = process.argv.includes("--dry")

async function main() {
  const supabase = createAdminSupabaseClient()
  const posalji = DRY ? { send: drySend, dryRun: true } : {}
  const result = await runReminders(supabase, posalji)
  const postDue = await runPostDue(supabase, posalji)
  const digest = await runDigest(supabase, posalji)
  console.log(JSON.stringify({ preDue: result, postDue, digest }, null, 2))
  console.log(
    `\n✅ Pre-due — poslato: ${result.sent.length} | preskočeno: ${result.skipped.length} | greške: ${result.errors.length}` +
    `\n✅ Post-due — poslato: ${postDue.sent.length} | preskočeno: ${postDue.skipped.length} | greške: ${postDue.errors.length}` +
    `\n✅ Digest — poslato: ${digest.sent.length} | preskočeno: ${digest.skipped.length} | greške: ${digest.errors.length}`,
  )
}

main().catch((err) => {
  console.error("❌ send-reminders:", err)
  process.exit(1)
})
