import { PlanViewSwitcher } from "@/components/domain/PlanViewSwitcher"
import { jeValidanView, type PlanView } from "@/lib/plan-view"
import { ListaView } from "./_views/lista"
import { KalendarView } from "./_views/kalendar"

export default async function PlanAktivnostiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const raw = typeof sp.view === "string" ? sp.view : undefined
  const view: PlanView = jeValidanView(raw) ? raw : "lista"

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Plan aktivnosti</h1>
        <PlanViewSwitcher current={view} />
      </div>
      {view === "lista" && <ListaView searchParams={sp} />}
      {view === "kalendar" && <KalendarView searchParams={sp} />}
    </div>
  )
}
