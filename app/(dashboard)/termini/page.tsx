import { createServerSupabaseClient } from "@/lib/supabase/server"

export default async function TerminiPage() {
  const supabase = await createServerSupabaseClient()
  const { count } = await supabase
    .from("termini")
    .select("*", { count: "exact", head: true })

  return (
    <div>
      <h1 className="text-2xl font-semibold">Termini</h1>
      <p className="mt-2 text-slate-600">
        Sadržaj se popunjava u Fazi 3.
      </p>
      <p className="mt-4 text-sm text-slate-500" data-testid="termini-count">
        Termina u bazi: <span className="font-medium">{count ?? 0}</span>
      </p>
    </div>
  )
}
