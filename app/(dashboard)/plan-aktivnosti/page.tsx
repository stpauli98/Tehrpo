import { Suspense } from "react"
import { getTranslations } from "next-intl/server"
import { Skeleton } from "@/components/ui/skeleton"
import { PlanViewSwitcher } from "@/components/domain/PlanViewSwitcher"
import { PlanIzvozModal } from "@/components/domain/PlanIzvozModal"
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
  const view: PlanView = jeValidanView(raw) ? raw : "kalendar"
  const t = await getTranslations("plan")

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("naslov")}</h1>
        <div className="flex items-center gap-3">
          <Suspense fallback={null}><PlanIzvozModal /></Suspense>
          <PlanViewSwitcher current={view} />
        </div>
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
