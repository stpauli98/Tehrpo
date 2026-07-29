import { Suspense } from "react"
import { getTranslations } from "next-intl/server"
import { Skeleton } from "@/components/ui/skeleton"
import { PlanViewSwitcher } from "@/components/domain/PlanViewSwitcher"
import { PlanIzvozModal } from "@/components/domain/PlanIzvozModal"
import { jeValidanView, type PlanView } from "@/lib/plan-view"
import { dohvatiGodineTermina } from "@/lib/queries/godine"
import { dohvatiZaduzeniPrijedlogeByFirma } from "@/lib/queries/aktivni-korisnici"
import { ListaView } from "./_views/lista"
import { KalendarView } from "./_views/kalendar"
import { MatricaView } from "./_views/matrica"

/**
 * Skeleton dok se klijentski view hidrira. S16: raspored prati STVARNI sadržaj
 * ekrana (naslov je već renderovan iznad → ovdje samo toolbar traka + redovi);
 * stat-kartice su odavno uklonjene sa Plana i više se ne skeletoniraju.
 */
function ViewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
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

  // S8.1/S8.6: godine i prijedlozi zaduženih dolaze iz baze i to iz JEDNOG mjesta —
  // server komponenta ih dohvati jednom i proslijedi svim potrošačima (filteri,
  // PlanNav, PrikazToolbar, izvoz modal, forme), umjesto pet nezavisnih izvora.
  // Oba helpera na grešku vraćaju fallback/prazno i nikad ne obaraju ekran.
  const [godine, zaduzeniPrijedloziByFirma] = await Promise.all([
    dohvatiGodineTermina(),
    dohvatiZaduzeniPrijedlogeByFirma(),
  ])

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("naslov")}</h1>
        <div className="flex items-center gap-3">
          <Suspense fallback={null}><PlanIzvozModal godine={godine} /></Suspense>
          <PlanViewSwitcher current={view} />
        </div>
      </div>
      {view === "lista" && (
        <Suspense fallback={<ViewSkeleton />}>
          <ListaView godine={godine} zaduzeniPrijedloziByFirma={zaduzeniPrijedloziByFirma} />
        </Suspense>
      )}
      {view === "kalendar" && (
        <Suspense fallback={<ViewSkeleton />}>
          <KalendarView godine={godine} zaduzeniPrijedloziByFirma={zaduzeniPrijedloziByFirma} />
        </Suspense>
      )}
      {view === "matrica" && (
        <Suspense fallback={<ViewSkeleton />}>
          <MatricaView godine={godine} zaduzeniPrijedloziByFirma={zaduzeniPrijedloziByFirma} />
        </Suspense>
      )}
    </div>
  )
}
