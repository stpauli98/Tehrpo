import { createServerSupabaseClient } from "@/lib/supabase/server"
import { OpterecenjeChart, type OpterecenjeRow } from "@/components/domain/OpterecenjeChart"
import { PrikazToolbar } from "@/components/domain/PrikazToolbar"
import { currentYear, todayIso } from "@/lib/date"

export default async function PrikazPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const godina = Number(typeof sp.godina === "string" ? sp.godina : "") || currentYear()
  const klijentId = typeof sp.klijent === "string" ? sp.klijent : ""

  const supabase = await createServerSupabaseClient()
  const [opterecenjeRes, klijentiRes] = await Promise.all([
    supabase.rpc("get_opterecenje", { godina }),
    supabase.from("klijenti").select("id, naziv").order("naziv"),
  ])

  const opterecenje = (opterecenjeRes.data ?? []) as OpterecenjeRow[]
  const klijenti = (klijentiRes.data ?? []).map((k) => ({ id: k.id, naziv: k.naziv }))
  const godine = [currentYear() - 1, currentYear(), currentYear() + 1]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Prikaz</h1>

      <div className="rounded-xl border border-slate-200 p-4">
        <OpterecenjeChart data={opterecenje} currentMonth={godina === Number(todayIso().slice(0, 4)) ? Number(todayIso().slice(5, 7)) : undefined} />
      </div>

      <PrikazToolbar klijenti={klijenti} godine={godine} />

      {!klijentId ? (
        <div data-testid="prikaz-empty" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
          Izaberite klijenta za prikaz godišnje matrice.
        </div>
      ) : (
        <div data-testid="prikaz-matrix-placeholder" className="rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">
          Matrica se popunjava u Task 3.
        </div>
      )}
    </div>
  )
}
