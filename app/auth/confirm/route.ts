import { type NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { href } from "@/i18n/routes"

/**
 * GET /auth/confirm
 *
 * Razmjena PKCE koda (ili OTP token_hash) za sesiju nakon klikanja linka za
 * resetovanje lozinke (ili email potvrdu). Supabase Auth e-poruka mora imati
 * redirectTo postavljen na ovaj URL.
 *
 * NAPOMENA za konfigurisanje projekta:
 * U Supabase konzoli → Authentication → URL Configuration → "Redirect URLs"
 * mora biti dodat URL ovog endpointa (npr. https://vasa-domena.com/auth/confirm)
 * kako bi link u e-poruci bio prihvaćen. Ovo je serverska konfiguracija —
 * nije moguće postaviti putem koda.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as "recovery" | "email" | "signup" | "invite" | null

  const supabase = await createServerSupabaseClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${href("/auth/nova-lozinka")}`)
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      return NextResponse.redirect(`${origin}${href("/auth/nova-lozinka")}`)
    }
  }

  // Greška ili nedostaju parametri — vrati korisnika na formu sa porukom
  return NextResponse.redirect(`${origin}${href("/zaboravljena-lozinka")}?greska=istekao`)
}
