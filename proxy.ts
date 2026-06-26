// proxy.ts — auth gate (Next.js 16: "middleware" renamed to "proxy")
import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { env } from "@/lib/env"

const PUBLIC = ["/prijava", "/zaboravljena-lozinka", "/auth"]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
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

    if (!profil?.aktivan) {
      await supabase.auth.signOut()

      const url = new URL("/prijava", request.url)
      url.searchParams.set("greska", "deaktiviran")

      // Copy session-clearing cookies set by signOut() onto the redirect response.
      // (signOut writes to `response` via setAll; without this copy the cookies
      // would not be included in the redirect and the session would not be cleared.)
      const redirectRes = NextResponse.redirect(url)
      response.cookies.getAll().forEach(({ name, value, ...attrs }) =>
        redirectRes.cookies.set(name, value, attrs),
      )
      return redirectRes
    }
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)",
  ],
}
