// scripts/seed-admin.ts
// Kreira (ili ažurira) admin nalog. Idempotentno: ako email postoji, samo osigura korisnici red.
// Pokretanje: pnpm seed:admin <email> <lozinka> "<ime>"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

async function main() {
  const [email, lozinka, ime] = process.argv.slice(2)
  if (!email || !lozinka || !ime) throw new Error('Upotreba: pnpm seed:admin <email> <lozinka> "<ime>"')
  const admin = createAdminSupabaseClient()

  // 1. Nađi ili kreiraj auth korisnika
  const { data: list, error: listErr } = await admin.auth.admin.listUsers()
  if (listErr) throw listErr
  let userId = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password: lozinka, email_confirm: true,
    })
    if (error) throw error
    userId = data.user.id
    console.log("✅ Kreiran auth nalog:", email)
  } else {
    console.log("ℹ️  Auth nalog već postoji:", email)
  }

  // 2. Upsert profila sa ulogom admin
  const { error: upErr } = await admin.from("korisnici").upsert(
    { id: userId, ime, email, uloga: "admin", aktivan: true },
    { onConflict: "id" },
  )
  if (upErr) throw upErr
  console.log("✅ Admin profil spreman:", ime, `<${email}>`)
}

main().catch((e) => { console.error("❌", e); process.exit(1) })
