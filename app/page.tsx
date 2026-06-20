import { createServerSupabaseClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export default async function Home() {
  const supabase = await createServerSupabaseClient()
  // jednostavan ping — Supabase auth check (radi i bez tabela)
  const { error } = await supabase.auth.getSession()
  const connected = !error

  return (
    <main className="min-h-screen p-12">
      <h1 className="text-3xl font-semibold text-brand">Tehpro</h1>
      <p className="mt-2 text-slate-600">
        Sistem za termine i provjere — temelji postavljeni.
      </p>

      <Card className="mt-6 max-w-md">
        <CardHeader>
          <CardTitle>
            Supabase: {connected ? "✓ konektovan" : "✗ greška"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {connected ? (
            <p className="text-sm text-slate-600">Server klijent radi.</p>
          ) : (
            <p className="text-sm text-status-kasni">Provjeri .env.local</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4 max-w-md">
        <CardHeader>
          <CardTitle>shadcn/ui radi</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
        </CardContent>
      </Card>
    </main>
  )
}
