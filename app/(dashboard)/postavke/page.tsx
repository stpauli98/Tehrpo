import { createServerSupabaseClient } from "@/lib/supabase/server"
import { ReminderForm } from "@/components/domain/ReminderForm"
import { IntervaliForm } from "@/components/domain/IntervaliForm"

export default async function PostavkePage() {
  const supabase = await createServerSupabaseClient()
  const [postRes, vrsteRes] = await Promise.all([
    supabase.from("postavke").select("dana_prije").eq("id", 1).maybeSingle(),
    supabase
      .from("vrste_provjera")
      .select("id, naziv, podrazumevani_interval_mjeseci")
      .eq("aktivna", true)
      .order("naziv"),
  ])
  const danaPrije = postRes.data?.dana_prije ?? [30, 14, 7, 1]
  const vrste = (vrsteRes.data ?? []).map((v) => ({
    id: v.id,
    naziv: v.naziv,
    interval: v.podrazumevani_interval_mjeseci,
  }))

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

      <section className="rounded-xl border border-slate-200 p-4">
        <h2 className="mb-1 text-base font-medium">Intervali po vrsti pregleda</h2>
        <p className="mb-4 text-sm text-slate-500">
          Interval (mjeseci) koji sistem koristi da po izvršenju automatski zakaže sljedeći termin
          u ciklusu. Prazno = bez auto-zakazivanja.
        </p>
        <IntervaliForm vrste={vrste} />
      </section>
    </div>
  )
}
