// proxy.ts — auth gate (Next.js 16: "middleware" renamed to "proxy")
import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { env } from "@/lib/env"

// /api/cron je Bearer-authed (CRON_SECRET) i nema Supabase user cookie → mora
// zaobići auth gate, inače getUser()=null → redirect /prijava (gasi podsjetnike).
const PUBLIC = ["/prijava", "/zaboravljena-lozinka", "/auth", "/api/cron"]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Official @supabase/ssr Next.js proxy pattern: the supabaseResponse must
  // be recreated whenever setAll() fires (token refresh) so that:
  //   a) subsequent getAll() calls in the same request see the updated cookies
  //      (via request.cookies.set), and
  //   b) the refreshed cookies are forwarded to the browser in the response.
  // Using `let` allows the closure inside setAll() to swap supabaseResponse.
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Step 1: propagate new/refreshed cookies to the request so any
          //         subsequent getAll() in this same invocation sees them.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          // Step 2: recreate the response carrying the updated request so that
          //         Next.js forwards the refreshed cookies downstream.
          supabaseResponse = NextResponse.next({ request })
          // Step 3: stamp the same cookies onto the new response headers so
          //         the browser receives Set-Cookie for the refreshed session.
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Refreshes the session and returns the current user (server-validated).
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isPublic = PUBLIC.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  )

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/prijava", request.url))
  }

  if (user && !isPublic) {
    // Read own profile with the user-scoped client. Works with RLS off (current)
    // and under RLS once the korisnici self-select policy (id = auth.uid()) lands
    // in the RLS migration. No service-role key in the request path.
    const { data: profil } = await supabase
      .from("korisnici")
      .select("aktivan")
      .eq("id", user.id)
      .maybeSingle()

    // Fail-OPEN: sign out ONLY a confirmed-deactivated user. A missing row or a
    // read hiccup must NOT revoke the session (signOut deletes it server-side and
    // would cascade to all requests). Deaktivacija = eksplicitno aktivan === false.
    if (profil && profil.aktivan === false) {
      await supabase.auth.signOut()

      const url = new URL("/prijava", request.url)
      url.searchParams.set("greska", "deaktiviran")

      // Copy session-clearing cookies set by signOut() onto the redirect response.
      // signOut() writes to supabaseResponse via setAll(); without this copy the
      // cookies would not be included in the redirect and the session would not
      // be cleared.
      const redirectRes = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach(({ name, value, ...attrs }) =>
        redirectRes.cookies.set(name, value, attrs),
      )
      return redirectRes
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)",
  ],
}
