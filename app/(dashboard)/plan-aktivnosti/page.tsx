import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { PlanViewSwitcher } from "@/components/domain/PlanViewSwitcher"
import { jeValidanView, type PlanView } from "@/lib/plan-view"
import { ListaView } from "./_views/lista"
import { KalendarView } from "./_views/kalendar"
import { MatricaView } from "./_views/matrica"

/** Lightweight fallback rendered while the client view hydrates. */
function ViewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}

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
      {view === "lista" && (
        <Suspense fallback={<ViewSkeleton />}>
          <ListaView />
        </Suspense>
      )}
      {view === "kalendar" && (
        <Suspense fallback={<ViewSkeleton />}>
          <KalendarView />
        </Suspense>
      )}
      {view === "matrica" && (
        <Suspense fallback={<ViewSkeleton />}>
          <MatricaView />
        </Suspense>
      )}
    </div>
  )
}
