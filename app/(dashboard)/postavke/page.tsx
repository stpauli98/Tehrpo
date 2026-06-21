import { createServerSupabaseClient } from "@/lib/supabase/server"
import { ReminderForm } from "@/components/domain/ReminderForm"

export default async function PostavkePage() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from("postavke").select("dana_prije").eq("id", 1).maybeSingle()
  const danaPrije = data?.dana_prije ?? [30, 14, 7, 1]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Postavke</h1>
      <section className="rounded-xl border border-slate-200 p-4">
        <h2 className="mb-1 text-base font-medium">Email podsjetnici</h2>
        <p className="mb-4 text-sm text-slate-500">
          Koliko dana prije roka dospijeća se šalje podsjetnik. Sistem dnevno provjerava termine.
        </p>
        <ReminderForm danaPrije={danaPrije} />
      </section>
    </div>
  )
}
